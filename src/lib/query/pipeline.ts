import { Converter } from "opencc-js";
import { toHiragana, toRomaji } from "wanakana";
import type { InputInterpretation, Language, QueryTelemetry, QueryType, TargetLanguage, TranslationResult } from "@/lib/types";
import { applyCuratedEnrichment } from "@/lib/language/dictionary";
import { lookupDictionary, resolveJapaneseInput, type DictionaryMatch, type JapaneseResolution } from "@/lib/language/jmdict";
import { normalizeInput, resolveTarget, segmentScripts } from "@/lib/language/preprocess";

const simplifiedToJapanese = Converter({ from: "cn", to: "jp" });
const traditionalToJapanese = Converter({ from: "t", to: "jp" });
const simplifiedToTraditional = Converter({ from: "cn", to: "t" });

export type QueryPlan = {
  input: string;
  normalizedInput: string;
  inputMode: InputInterpretation;
  detectedLanguage: Language;
  targetLanguage: Exclude<TargetLanguage, "auto">;
  type: QueryType;
  resolution?: JapaneseResolution;
  dictionaryMatches: DictionaryMatch[];
  baseResult: TranslationResult;
  needsAI: boolean;
  telemetry: QueryTelemetry;
};

function now() {
  return performance.now();
}

function likelySentence(input: string, kinds: Set<string>) {
  if (/[。！？!?\n]/u.test(input)) return true;
  if (kinds.size === 1 && kinds.has("latin")) return input.trim().split(/\s+/u).length >= 4;
  if (kinds.has("hiragana") || kinds.has("katakana")) return input.length >= 7 && /[はがをにでへとも]|です|ます|ない|ました|だった/u.test(input);
  return input.length >= 5 && /[我你他她它是有在要想会能可不没吗呢了过着]/u.test(input);
}

function classifyType(input: string, kinds: Set<string>, segmented: boolean): QueryType {
  if (likelySentence(input, kinds)) return "sentence";
  if (![...kinds].some((kind) => ["han", "hiragana", "katakana", "latin"].includes(kind))) return "symbol";
  if (segmented || kinds.size > 1) return "mixed";
  return "word";
}

function uniqueMatches(matches: DictionaryMatch[], limit = 8) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.surface}\0${match.reading}\0${match.baseForm ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

async function lookupHanVariants(input: string) {
  const variants = [...new Set([simplifiedToJapanese(input), traditionalToJapanese(input), input, simplifiedToTraditional(input)])];
  const matches = (await Promise.all(variants.map((variant) => lookupDictionary(variant, { allowFuzzy: false, limit: 6 })))).flat();
  return uniqueMatches(matches);
}

function determineLanguage(input: string, kinds: Set<string>, direct: DictionaryMatch[], resolution?: JapaneseResolution): Language {
  if (kinds.has("hiragana") || kinds.has("katakana")) return "ja";
  if (kinds.has("han") && !kinds.has("latin")) return "zh";
  if (kinds.has("han") && kinds.has("latin")) return "unknown";
  if (kinds.size === 1 && kinds.has("latin")) {
    if (likelySentence(input, kinds)) return "en";
    if (direct[0]?.matchType === "english") return "en";
    if (resolution?.resolved && resolution.confidence >= 0.72) return "romaji";
    return "en";
  }
  return "unknown";
}

function candidateMeanings(matches: DictionaryMatch[]) {
  const seen = new Set<string>();
  return matches.flatMap((match) => {
    const key = `${match.surface}\0${match.reading}\0${match.englishMeanings.slice(0, 3).join(";")}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
    japanese: match.surface,
    english: match.englishMeanings.slice(0, 3).join("; "),
    label: match.reading,
    }];
  }).slice(0, 5);
}

function makeDictionaryResult(
  input: string,
  normalizedInput: string,
  detectedLanguage: Language,
  targetLanguage: Exclude<TargetLanguage, "auto">,
  type: QueryType,
  matches: DictionaryMatch[],
  resolution?: JapaneseResolution,
): TranslationResult {
  const combined = Boolean(resolution?.segmented && resolution.resolved);
  const primary = combined
    ? undefined
    : resolution?.resolved
      ? matches.find((match) => match.surface === resolution.resolved
        || (resolution.resolved !== resolution.reading && match.reading === resolution.resolved))
      : matches[0];
  const surface = resolution?.resolved ?? primary?.surface ?? normalizedInput;
  const reading = resolution?.reading ?? primary?.reading;
  const english = combined
    ? [...new Set(matches.slice(0, 4).flatMap((match) => match.englishMeanings.slice(0, 1)))].join(" + ")
    : primary?.englishMeanings.slice(0, 3).join("; ");
  const suggestions = uniqueMatches(matches, 5).map((match) => ({ query: match.surface, label: match.surface, reading: match.reading }));
  const compactOriginal = normalizedInput.replace(/\s/gu, "");
  const recognized = surface && compactOriginal !== surface;
  const confidence = combined ? resolution?.confidence : primary?.confidence ?? resolution?.confidence;
  const result: TranslationResult = {
    type,
    detectedLanguage,
    targetLanguage,
    original: input,
    normalizedInput,
    primary: surface,
    translation: surface || normalizedInput,
    dictionary: primary || combined ? {
      surface,
      reading,
      romaji: reading ? toRomaji(reading) : primary?.romaji,
      partOfSpeech: combined ? "组合表达" : primary?.partOfSpeech,
      englishMeaning: english,
    } : undefined,
    meanings: matches.length > 1 || combined ? candidateMeanings(matches) : undefined,
    correction: recognized && detectedLanguage === "romaji" && (primary?.matchType === "fuzzy" || resolution?.segmented)
      ? { input: normalizedInput, normalized: surface, note: primary?.matchType === "fuzzy" ? "已根据读音与词典相似度进行宽松匹配。" : "已按词典词边界分段解析。" }
      : undefined,
    suggestions: suggestions.length > 1 ? suggestions : resolution?.recognition?.alternatives,
    recognition: resolution?.recognition,
    source: primary || combined ? "dictionary" : "fallback",
    confidence,
  };
  return applyCuratedEnrichment(result);
}

export async function prepareQuery(input: string, requestedTarget: TargetLanguage, inputMode: InputInterpretation = "auto"): Promise<QueryPlan> {
  const started = now();
  const normalizedInput = normalizeInput(input);
  const normalizeEnded = now();
  const segments = segmentScripts(normalizedInput);
  const lexicalSegments = segments.filter((segment) => !["space", "punctuation", "number", "other"].includes(segment.kind));
  const kinds = new Set(lexicalSegments.map((segment) => segment.kind));
  const sentence = likelySentence(normalizedInput, kinds);
  let direct = sentence ? [] : await lookupDictionary(normalizedInput, { allowFuzzy: false, limit: 8 });
  let resolution: JapaneseResolution | undefined;

  if (!sentence && kinds.has("han") && !kinds.has("latin") && !kinds.has("hiragana") && !kinds.has("katakana")) {
    direct = uniqueMatches([...await lookupHanVariants(normalizedInput), ...direct]);
  }

  const shouldResolveJapanese = !sentence && (
    kinds.has("hiragana")
    || kinds.has("katakana")
    || (kinds.has("han") && kinds.has("latin"))
    || (kinds.size === 1 && kinds.has("latin") && direct[0]?.matchType !== "english")
  );
  if (shouldResolveJapanese) {
    resolution = await resolveJapaneseInput(normalizedInput);
    direct = uniqueMatches([...resolution.matches, ...direct]);
  }

  const detectedLanguage = determineLanguage(normalizedInput, kinds, direct, resolution);
  const targetLanguage = resolveTarget(detectedLanguage, requestedTarget);
  const type = classifyType(normalizedInput, kinds, Boolean(resolution?.segmented));
  const dictionaryEnded = now();
  const baseResult = makeDictionaryResult(input, normalizedInput, detectedLanguage, targetLanguage, type, direct, resolution);
  const needsAI = type !== "symbol";
  return {
    input,
    normalizedInput,
    inputMode,
    detectedLanguage,
    targetLanguage,
    type,
    resolution,
    dictionaryMatches: direct,
    baseResult,
    needsAI,
    telemetry: {
      normalizeMs: normalizeEnded - started,
      dictionaryMs: dictionaryEnded - normalizeEnded,
      totalMs: dictionaryEnded - started,
      aiCalls: 0,
    },
  };
}

function mergeUniqueStrings(...lists: Array<string[] | undefined>) {
  return [...new Set(lists.flatMap((list) => list ?? []).filter(Boolean))];
}

function semanticTokens(value?: string) {
  return new Set((value?.toLocaleLowerCase("en-US").match(/[a-z]{3,}/gu) ?? []).filter((token) => !["the", "and", "for", "with", "from"].includes(token)));
}

function rankMeanings(meanings: TranslationResult["meanings"], dictionary: TranslationResult["dictionary"]) {
  if (!meanings?.length) return undefined;
  const reference = semanticTokens(dictionary?.englishMeaning);
  const seen = new Set<string>();
  return meanings
    .filter((meaning) => {
      const key = `${meaning.japanese ?? ""}\0${meaning.label ?? ""}\0${meaning.english ?? ""}\0${meaning.chinese ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((meaning, index) => ({ meaning, index, relevance: [...semanticTokens(meaning.english)].filter((token) => reference.has(token)).length }))
    .sort((left, right) => right.relevance - left.relevance || left.index - right.index)
    .map(({ meaning }) => meaning)
    .slice(0, 5);
}

function rankSuggestions(suggestions: TranslationResult["suggestions"], dictionary: TranslationResult["dictionary"]) {
  const primary = dictionary?.surface ? { query: dictionary.surface, label: dictionary.surface, reading: dictionary.reading } : undefined;
  const values = primary ? [primary, ...(suggestions ?? [])] : suggestions ?? [];
  const seen = new Set<string>();
  const ranked = values.filter((suggestion) => {
    const key = suggestion.query;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
  return ranked.length > 1 ? ranked : undefined;
}

export function mergeAIResult(base: TranslationResult, ai: Partial<TranslationResult>): TranslationResult {
  const preserveDictionaryFacts = (base.detectedLanguage === "ja" || base.detectedLanguage === "romaji" || base.type === "mixed")
    && (base.confidence ?? 0) >= 0.8;
  const composedExpression = base.dictionary?.partOfSpeech === "组合表达";
  // A concatenation is not an exact headword. Permit an orthographic repair
  // only when AI supplies the same pronunciation; never replace exact entries.
  const readingKey = (value: string) => toHiragana(value.normalize("NFKC")).replace(/[\s・]/gu, "");
  const repairedComposition = Boolean(composedExpression && ai.dictionary?.surface && ai.dictionary?.reading && base.dictionary?.reading
    && ai.dictionary.surface !== base.dictionary.surface
    && readingKey(ai.dictionary.reading) === readingKey(base.dictionary.reading));
  const chineseFromText = [
    ai.meanings?.find((meaning) => meaning.chinese)?.chinese,
    ai.naturalTranslation,
    ai.translation,
    ai.literalTranslation,
  ].find((value) => typeof value === "string"
    && value.trim().length <= 80
    && /\p{Script=Han}/u.test(value)
    && !/[\u3040-\u30ff]/u.test(value)
    && value.trim() !== base.dictionary?.surface);
  const enrichedChinese = ai.dictionary?.chineseMeaning ?? chineseFromText ?? base.dictionary?.chineseMeaning;
  let dictionary = preserveDictionaryFacts && base.dictionary
    ? {
        ...ai.dictionary,
        ...base.dictionary,
        ...(repairedComposition ? { surface: ai.dictionary!.surface, reading: ai.dictionary!.reading } : {}),
        chineseMeaning: enrichedChinese,
        englishMeaning: composedExpression
          ? ai.dictionary?.englishMeaning ?? base.dictionary?.englishMeaning
          : base.dictionary?.englishMeaning ?? ai.dictionary?.englishMeaning,
      }
    : ai.dictionary
      ? { ...ai.dictionary, chineseMeaning: ai.dictionary.chineseMeaning ?? chineseFromText }
      : base.dictionary
        ? { ...base.dictionary, chineseMeaning: chineseFromText ?? base.dictionary.chineseMeaning }
        : undefined;
  const aiTranslation = ai.translation?.trim() || ai.naturalTranslation?.trim();
  if (
    dictionary
    && base.targetLanguage === "ja"
    && (base.detectedLanguage === "zh" || base.detectedLanguage === "en")
    && aiTranslation
    && aiTranslation !== base.normalizedInput
    && dictionary.surface === base.normalizedInput
  ) {
    dictionary = { ...dictionary, surface: aiTranslation };
  }
  const sentenceTranslation = ai.sentenceAnalysis
    ? base.targetLanguage === "ja"
      ? ai.sentenceAnalysis.japanese
      : base.targetLanguage === "zh"
        ? ai.sentenceAnalysis.chinese
        : ai.sentenceAnalysis.english
    : undefined;
  const meanings = rankMeanings(ai.meanings?.length ? ai.meanings : repairedComposition ? undefined : base.meanings, dictionary);
  const selectedOrthography = meanings?.[0]?.japanese;
  if (
    dictionary
    && base.source === "fallback"
    && base.detectedLanguage === "romaji"
    && selectedOrthography
    && /\p{Script=Han}/u.test(selectedOrthography)
    && !/\p{Script=Han}/u.test(dictionary.surface)
  ) dictionary = { ...dictionary, surface: selectedOrthography };
  const preserveResolvedJapanese = base.targetLanguage === "ja"
    && base.type !== "sentence"
    && ["romaji", "unknown"].includes(base.detectedLanguage)
    && Boolean(dictionary?.surface);
  const translation = preserveResolvedJapanese
    ? dictionary!.surface
    : ai.translation?.trim() || ai.naturalTranslation?.trim() || sentenceTranslation?.trim() || dictionary?.surface || base.translation || base.normalizedInput || base.original;
  const suggestions = rankSuggestions(ai.suggestions?.length ? ai.suggestions : repairedComposition ? undefined : base.suggestions, dictionary);
  const result: TranslationResult = {
    ...base,
    ...ai,
    detectedLanguage: base.detectedLanguage,
    targetLanguage: base.targetLanguage,
    original: base.original,
    normalizedInput: base.normalizedInput,
    type: base.type,
    primary: dictionary?.surface ?? ai.primary ?? translation,
    translation,
    dictionary,
    meanings,
    examples: ai.examples?.length ? ai.examples.slice(0, 3) : base.examples,
    usageNotes: mergeUniqueStrings(base.usageNotes, ai.usageNotes).slice(0, 5),
    alternatives: mergeUniqueStrings(ai.alternatives, base.alternatives).slice(0, 6),
    suggestions,
    recognition: repairedComposition && base.recognition ? { ...base.recognition, resolved: dictionary!.surface, segments: [{ source: base.original, kind: "romaji", reading: dictionary!.reading, resolved: dictionary!.surface }] } : base.recognition,
    correction: repairedComposition ? { input: base.original, normalized: dictionary!.surface, note: "保留读音，采用自然的日语表记。" } : ai.correction ?? base.correction,
    source: base.source === "dictionary" ? "hybrid" : "ai",
    confidence: Math.max(base.confidence ?? 0, 0.85),
  };
  if (!result.usageNotes?.length) result.usageNotes = undefined;
  if (!result.alternatives?.length) result.alternatives = undefined;
  return applyCuratedEnrichment(result);
}

export function finalizeWithoutAI(base: TranslationResult, warning?: string) {
  const result: TranslationResult = {
    ...base,
    translation: base.translation || base.dictionary?.surface || base.normalizedInput || base.original,
    primary: base.primary || base.dictionary?.surface || base.translation || base.original,
    warnings: warning ? mergeUniqueStrings(base.warnings, [warning]) : base.warnings,
  };
  return applyCuratedEnrichment(result);
}

import { readFile } from "node:fs/promises";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { join } from "node:path";
import { distance } from "fastest-levenshtein";
import { adjDeconjugate, verbDeconjugate } from "kamiya-codec";
import { toHiragana, toRomaji } from "wanakana";
import type { InputRecognition, RecognitionSegment, SearchSuggestion } from "@/lib/types";
import { normalizeInput, normalizedLookupKey, romajiForms, segmentScripts, type ScriptSegment } from "./preprocess";

const gunzipAsync = promisify(gunzip);

type CompactEntry = {
  i: string;
  k: string[];
  kc?: string[];
  r: string[];
  rc?: string[];
  p: string[];
  g: string[];
  c: boolean;
};

type CompactDictionary = {
  version: string;
  dictDate: string;
  source: string;
  license: string;
  entries: CompactEntry[];
};

export type DictionaryMatchType = "surface" | "reading" | "romaji" | "english" | "morphology" | "fuzzy" | "segmented";

export type DictionaryMatch = {
  id: string;
  surface: string;
  reading: string;
  romaji: string;
  partOfSpeech: string;
  englishMeanings: string[];
  common: boolean;
  score: number;
  confidence: number;
  matchType: DictionaryMatchType;
  editDistance?: number;
  correctionCost?: number;
  baseForm?: string;
};

type DictionaryIndex = {
  dictionary: CompactDictionary;
  surface: Map<string, CompactEntry[]>;
  reading: Map<string, CompactEntry[]>;
  romaji: Map<string, CompactEntry[]>;
  english: Map<string, CompactEntry[]>;
  romanKeys: string[];
};

export type JapaneseResolution = {
  normalized: string;
  resolved?: string;
  reading?: string;
  matches: DictionaryMatch[];
  recognition?: InputRecognition;
  confidence: number;
  segmented: boolean;
};

const posLabels: Record<string, string> = {
  n: "名词",
  "n-adv": "副词性名词",
  "n-pr": "专有名词",
  "n-t": "时间名词",
  pn: "代词",
  adj: "形容词",
  "adj-i": "い形容词",
  "adj-na": "な形容词",
  adv: "副词",
  exp: "固定表达",
  int: "感叹词",
  conj: "接续词",
  pref: "前缀",
  suf: "后缀",
  prt: "助词",
  aux: "助动词",
  "aux-v": "助动词",
  "v1": "一段动词",
  "v5r": "五段动词",
  "v5u": "五段动词",
  "v5k": "五段动词",
  "v5s": "五段动词",
  "vs": "サ变动词",
  "vs-i": "サ变动词",
  vi: "自动词",
  vt: "他动词",
};

let indexPromise: Promise<DictionaryIndex> | undefined;

function addIndex(map: Map<string, CompactEntry[]>, key: string, entry: CompactEntry) {
  if (!key) return;
  const values = map.get(key);
  if (values) {
    if (!values.includes(entry)) values.push(entry);
  } else {
    map.set(key, [entry]);
  }
}

function japaneseKey(value: string) {
  return normalizeInput(value).replace(/[\s・·]/gu, "");
}

function readingKey(value: string) {
  return toHiragana(japaneseKey(value));
}

function englishKey(value: string) {
  return normalizeInput(value)
    .toLocaleLowerCase("en-US")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function entrySurface(entry: CompactEntry, preferred?: string) {
  if (preferred && entry.k.includes(preferred)) return preferred;
  if (entry.p.includes("prt") || entry.p.includes("aux-v")) return entry.r[0] ?? entry.k[0] ?? "";
  return entry.kc?.[0] ?? entry.k[0] ?? entry.rc?.[0] ?? entry.r[0] ?? "";
}

function entryPos(entry: CompactEntry) {
  const labels = [...new Set(entry.p.map((code) => posLabels[code] ?? (/^v/u.test(code) ? "动词" : undefined)).filter(Boolean))];
  return labels.slice(0, 3).join("・") || "词语";
}

function makeMatch(entry: CompactEntry, matchType: DictionaryMatchType, score: number, preferred?: string, editDistance?: number): DictionaryMatch {
  const normalizedPreferred = preferred ? readingKey(preferred) : undefined;
  const preferredRomaji = preferred && /^[\p{Script=Latin}'’\-]+$/u.test(preferred) ? normalizedLookupKey(preferred) : undefined;
  const matchedReading = normalizedPreferred
    ? entry.r.find((candidate) => readingKey(candidate) === normalizedPreferred)
      ?? (preferredRomaji ? entry.r.find((candidate) => normalizedLookupKey(toRomaji(candidate)) === preferredRomaji) : undefined)
      ?? entry.rc?.[0] ?? entry.r[0] ?? preferred ?? ""
    : entry.rc?.[0] ?? entry.r[0] ?? preferred ?? "";
  // Kana-only entries often list obsolete or uncommon spelling variants. Keep the
  // match exact, but present JMdict's common orthography so omitted long vowels do
  // not outrank the normal modern form (e.g. サラリマン → サラリーマン).
  const canonicalReading = entry.rc?.[0];
  const promoteCanonicalKana = entry.k.length === 0
    && canonicalReading
    && [...canonicalReading].filter((character) => character === "ー").length
      > [...matchedReading].filter((character) => character === "ー").length;
  const reading = promoteCanonicalKana ? canonicalReading : matchedReading;
  const confidence = Math.max(0.35, Math.min(1, score / 100));
  return {
    id: entry.i,
    surface: entry.k.length === 0 ? reading : entrySurface(entry, preferred),
    reading,
    romaji: toRomaji(reading),
    partOfSpeech: entryPos(entry),
    englishMeanings: entry.g.slice(0, 5),
    common: entry.c,
    score,
    confidence,
    matchType,
    editDistance,
  };
}

function uniqueMatches(matches: DictionaryMatch[], limit = 5) {
  const seen = new Set<string>();
  return matches
    .sort((a, b) => b.score - a.score || Number(b.common) - Number(a.common) || a.surface.length - b.surface.length)
    .filter((match) => {
      const key = `${match.surface}\0${match.reading}\0${match.baseForm ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

async function buildIndex(): Promise<DictionaryIndex> {
  const file = join(process.cwd(), "public", "dictionary", "jmdict-common.json.gz");
  const dictionary = JSON.parse((await gunzipAsync(await readFile(file))).toString("utf8")) as CompactDictionary;
  const surface = new Map<string, CompactEntry[]>();
  const reading = new Map<string, CompactEntry[]>();
  const romaji = new Map<string, CompactEntry[]>();
  const english = new Map<string, CompactEntry[]>();

  for (const entry of dictionary.entries) {
    for (const value of entry.k) {
      addIndex(surface, japaneseKey(value), entry);
      addIndex(reading, readingKey(value), entry);
    }
    for (const value of entry.r) {
      addIndex(surface, japaneseKey(value), entry);
      addIndex(reading, readingKey(value), entry);
      addIndex(romaji, normalizedLookupKey(toRomaji(value)), entry);
    }
    for (const gloss of entry.g) {
      const key = englishKey(gloss);
      if (key && key.length <= 80) addIndex(english, key, entry);
    }
  }
  return { dictionary, surface, reading, romaji, english, romanKeys: [...romaji.keys()] };
}

export function getDictionaryIndex() {
  indexPromise ??= buildIndex();
  return indexPromise;
}

export function resetDictionaryForTests() {
  indexPromise = undefined;
}

function entriesToMatches(entries: CompactEntry[] | undefined, matchType: DictionaryMatchType, score: number, preferred?: string, limit = 8, query?: string) {
  return uniqueMatches((entries ?? []).map((entry, index) => {
    const exactGlossBonus = query && entry.g.some((gloss) => englishKey(gloss) === englishKey(query)) ? 9 : 0;
    const particleBonus = query && query.length <= 3 && entry.p.includes("prt") ? 6 : 0;
    const writtenFormBonus = matchType === "romaji" && entry.k.length > 0 ? 0.6 : 0;
    return makeMatch(entry, matchType, score - index * 0.4 + (entry.c ? 3 : 0) + exactGlossBonus + particleBonus + writtenFormBonus, preferred);
  }), limit);
}

function fuzzyLimit(length: number) {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  return Math.min(3, Math.floor(length * 0.22));
}

function repeatedImeCost(text: string, index: number) {
  const char = text[index];
  const repeated = text[index - 1] === char || text[index + 1] === char;
  const previous = text[index - 1];
  if ((char === "u" && previous === "o") || (char === "i" && previous === "e")) return 0.45;
  if (!repeated) return char === "-" ? 0.35 : 1;
  if (char === "n") return 0.2;
  if (/[bcdfghjklmpqrstvwxyz]/u.test(char)) return 0.25;
  if (/[aeiou]/u.test(char)) return 0.4;
  return 0.65;
}

/** Weighted edit cost for common phone/IME omissions without favoring arbitrary spelling changes. */
export function imeRomajiDistance(source: string, target: string) {
  const previous = [0];
  for (let index = 0; index < target.length; index += 1) previous[index + 1] = previous[index] + repeatedImeCost(target, index);
  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    const current = [previous[0] + repeatedImeCost(source, sourceIndex - 1)];
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const substitution = previous[targetIndex - 1] + (source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1);
      const deletion = previous[targetIndex] + repeatedImeCost(source, sourceIndex - 1);
      const insertion = current[targetIndex - 1] + repeatedImeCost(target, targetIndex - 1);
      current[targetIndex] = Math.min(substitution, deletion, insertion);
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
  }
  return previous[target.length];
}

type MorphologyCandidate = { lemma: string; label: string; kind: "verb" | "i-adjective" };

function reverseMasuStem(stem: string) {
  const map: Record<string, string> = { "い": "う", "き": "く", "ぎ": "ぐ", "し": "す", "ち": "つ", "に": "ぬ", "び": "ぶ", "み": "む", "り": "る" };
  const tail = stem.slice(-1);
  const sahen = tail === "し" ? stem.slice(0, -1) + "する" : "";
  return [...new Set([sahen, stem + "る", map[tail] ? stem.slice(0, -1) + map[tail] : ""].filter(Boolean))];
}

function reverseNegativeStem(stem: string) {
  const map: Record<string, string> = { "わ": "う", "か": "く", "が": "ぐ", "さ": "す", "た": "つ", "な": "ぬ", "ば": "ぶ", "ま": "む", "ら": "る" };
  const tail = stem.slice(-1);
  const sahen = tail === "し" ? stem.slice(0, -1) + "する" : "";
  return [...new Set([sahen, stem + "る", map[tail] ? stem.slice(0, -1) + map[tail] : ""].filter(Boolean))];
}

function reverseTeTaForm(form: string) {
  const candidates: string[] = [];
  const add = (ending: string, replacements: string[]) => {
    if (!form.endsWith(ending)) return;
    const stem = form.slice(0, -ending.length);
    for (const replacement of replacements) candidates.push(stem + replacement);
  };
  add("して", ["する", "す"]);
  add("した", ["する", "す"]);
  add("って", ["う", "つ", "る"]);
  add("った", ["う", "つ", "る"]);
  add("いて", ["く"]);
  add("いた", ["く"]);
  add("いで", ["ぐ"]);
  add("いだ", ["ぐ"]);
  add("んで", ["ぬ", "ぶ", "む"]);
  add("んだ", ["ぬ", "ぶ", "む"]);
  add("て", ["る"]);
  add("た", ["る"]);
  if (form === "いって" || form === "いった") candidates.push("いく");
  if (form === "きて" || form === "きた") candidates.push("くる");
  return [...new Set(candidates)];
}

function morphologyCandidates(reading: string) {
  const candidates: MorphologyCandidate[] = [];
  const add = (lemmas: string[], label: string, kind: MorphologyCandidate["kind"] = "verb") => {
    for (const lemma of lemmas) if (lemma && lemma !== reading) candidates.push({ lemma, label, kind });
  };

  for (const suffix of ["ている", "てる", "でいる", "でる"] as const) {
    if (!reading.endsWith(suffix)) continue;
    const teForm = reading.slice(0, -suffix.length) + (suffix.startsWith("で") ? "で" : "て");
    add(reverseTeTaForm(teForm), suffix.endsWith("てる") || suffix.endsWith("でる") ? "口语进行/状态形" : "进行/状态形");
  }
  if (reading.endsWith("ました")) add(reverseMasuStem(reading.slice(0, -3)), "礼貌过去形");
  if (reading.endsWith("ません")) add(reverseMasuStem(reading.slice(0, -3)), "礼貌否定形");
  if (reading.endsWith("ます")) add(reverseMasuStem(reading.slice(0, -2)), "礼貌形");
  if (reading.endsWith("なかった")) add(reverseNegativeStem(reading.slice(0, -4)), "否定过去形");
  if (reading.endsWith("ない")) add(reverseNegativeStem(reading.slice(0, -2)), "否定形");
  if (reading.endsWith("たかった")) add(reverseMasuStem(reading.slice(0, -4)), "愿望过去形");
  if (reading.endsWith("たい")) add(reverseMasuStem(reading.slice(0, -2)), "愿望形");
  if (reading.endsWith("くなかった")) add([reading.slice(0, -5) + "い"], "形容词否定过去形", "i-adjective");
  if (reading.endsWith("くない")) add([reading.slice(0, -3) + "い"], "形容词否定形", "i-adjective");
  if (reading.endsWith("かった")) add([reading.slice(0, -3) + "い"], "形容词过去形", "i-adjective");
  add(reverseTeTaForm(reading), reading.endsWith("て") || reading.endsWith("で") ? "て形" : "过去形");
  return candidates;
}

function inflectedSurface(surface: string, baseReading: string, inflectedReading: string) {
  let sharedSuffix = 0;
  while (
    sharedSuffix < surface.length
    && sharedSuffix < baseReading.length
    && surface[surface.length - sharedSuffix - 1] === baseReading[baseReading.length - sharedSuffix - 1]
  ) sharedSuffix += 1;
  if (sharedSuffix === 0) return inflectedReading;
  const readingPrefixLength = baseReading.length - sharedSuffix;
  return surface.slice(0, surface.length - sharedSuffix) + inflectedReading.slice(readingPrefixLength);
}

function validatesMorphology(reading: string, candidate: MorphologyCandidate, entry: CompactEntry) {
  if (candidate.kind === "i-adjective") {
    if (!entry.p.includes("adj-i")) return false;
    return adjDeconjugate(reading, candidate.lemma, true).length > 0;
  }
  if (!entry.p.some((code) => code.startsWith("v") || code === "vs")) return false;
  const typeII = entry.p.includes("v1");
  if (candidate.lemma.endsWith("する")) {
    const prefix = candidate.lemma.slice(0, -2);
    return reading.startsWith(prefix) && verbDeconjugate(reading.slice(prefix.length), "する", false, 2).length > 0;
  }
  return verbDeconjugate(reading, candidate.lemma, typeII, 2).length > 0;
}

async function lookupMorphology(reading: string, limit = 8) {
  const index = await getDictionaryIndex();
  const matches: DictionaryMatch[] = [];
  for (const candidate of morphologyCandidates(reading)) {
    for (const entry of index.reading.get(readingKey(candidate.lemma)) ?? []) {
      if (!validatesMorphology(reading, candidate, entry)) continue;
      const grammarBonus = (entry.p.includes("aux-v") ? 2 : 0) + (candidate.lemma.endsWith("する") ? 2 : 0);
      const base = makeMatch(entry, "morphology", 96 + (entry.c ? 2 : 0) + grammarBonus, candidate.lemma);
      const surface = entry.kc?.[0] ?? entry.k[0] ?? base.surface;
      matches.push({
        ...base,
        surface: inflectedSurface(surface, candidate.lemma, reading),
        reading,
        romaji: toRomaji(reading),
        partOfSpeech: `${base.partOfSpeech}（${base.surface}的${candidate.label}）`,
        matchType: "morphology",
        baseForm: surface,
        confidence: Math.min(0.98, base.confidence),
      });
    }
  }
  return uniqueMatches(matches, limit);
}

function fuzzyRomaji(index: DictionaryIndex, inputs: string[], limit = 5) {
  const matches: DictionaryMatch[] = [];
  for (const input of inputs) {
    const allowed = fuzzyLimit(input.length);
    if (allowed === 0) continue;
    for (const key of index.romanKeys) {
      if (Math.abs(key.length - input.length) > allowed) continue;
      const editDistance = distance(input, key);
      if (editDistance > allowed) continue;
      const weightedDistance = imeRomajiDistance(input, key);
      for (const entry of index.romaji.get(key) ?? []) {
        const match = makeMatch(entry, "fuzzy", 90 - weightedDistance * 15 + (entry.c ? 2 : 0), undefined, editDistance);
        matches.push({ ...match, correctionCost: weightedDistance });
      }
    }
  }
  return uniqueMatches(matches, limit);
}

export async function lookupDictionary(input: string, options: { allowFuzzy?: boolean; limit?: number } = {}) {
  const index = await getDictionaryIndex();
  const normalized = normalizeInput(input);
  const limit = options.limit ?? 5;
  const results: DictionaryMatch[] = [];

  results.push(...entriesToMatches(index.surface.get(japaneseKey(normalized)), "surface", 100, normalized, limit));
  results.push(...entriesToMatches(index.reading.get(readingKey(normalized)), "reading", 96, undefined, limit));

  if (/^[\p{Script=Latin}\s._'’\-]+$/u.test(normalized)) {
    const forms = romajiForms(normalized);
    for (const [formIndex, key] of forms.lookupKeys.entries()) results.push(...entriesToMatches(index.romaji.get(key), "romaji", 98 - formIndex * 0.5, key, limit, normalized));
    for (const [formIndex, kana] of [...forms.hiraganaCandidates, ...forms.katakanaCandidates].entries()) {
      results.push(...entriesToMatches(index.reading.get(readingKey(kana)), "romaji", 96 - formIndex * 0.1, kana, limit));
    }
    const english = index.english.get(englishKey(normalized));
    results.push(...entriesToMatches(english, "english", normalized.includes(" ") ? 101 : 91, undefined, limit));
    if (options.allowFuzzy !== false && results.length === 0) results.push(...fuzzyRomaji(index, forms.lookupKeys, limit));
  }

  return uniqueMatches(results, limit);
}

type TokenOption = {
  source: string;
  surface: string;
  reading: string;
  matches: DictionaryMatch[];
  score: number;
  confidence: number;
  kind: RecognitionSegment["kind"];
  correctionCost: number;
};

type RomanPath = {
  position: number;
  options: TokenOption[];
  score: number;
  matched: number;
  corrections: number;
};

function romanEntryOptions(index: DictionaryIndex, source: string, key: string) {
  return entriesToMatches(index.romaji.get(key), "romaji", 98, undefined, 12, source).map((match) => ({
    source,
    surface: match.surface,
    reading: match.reading,
    matches: [match],
    score: source.length * 5 + source.length * source.length * 0.85 + (match.common ? 2 : 0) + (match.partOfSpeech === "助词" ? 5 : 0),
    confidence: match.confidence,
    kind: "romaji" as const,
    correctionCost: 0,
  }));
}

function pruneRomanPaths(paths: RomanPath[], width = 20) {
  return paths.sort((a, b) => b.score - a.score || b.matched - a.matched || a.options.length - b.options.length).slice(0, width);
}

async function segmentRomanRun(raw: string, limit = 8): Promise<TokenOption[][]> {
  const index = await getDictionaryIndex();
  const variants = romajiForms(raw).lookupKeys;
  const completed: RomanPath[] = [];

  for (const text of variants) {
    const states = new Map<number, RomanPath[]>();
    states.set(0, [{ position: 0, options: [], score: 0, matched: 0, corrections: 0 }]);
    for (let position = 0; position < text.length; position += 1) {
      const paths = states.get(position) ?? [];
      for (const path of paths) {
        let found = false;
        const maximum = Math.min(text.length, position + 24);
        for (let end = position + 1; end <= maximum; end += 1) {
          const part = text.slice(position, end);
          const options = romanEntryOptions(index, part, part);
          if (options.length === 0) continue;
          found = true;
          for (const option of options) {
            const tokenPenalty = path.options.length > 0 ? 13 : 0;
            const next: RomanPath = {
              position: end,
              options: [...path.options, option],
              score: path.score + option.score - tokenPenalty,
              matched: path.matched + part.length,
              corrections: path.corrections,
            };
            states.set(end, pruneRomanPaths([...(states.get(end) ?? []), next]));
          }
        }
        if (!found || position + 1 < text.length) {
          const unknown = text[position];
          const previous = path.options.at(-1);
          const unknownOption: TokenOption = previous?.kind === "other"
            ? { ...previous, source: previous.source + unknown, surface: previous.surface + unknown, reading: previous.reading + unknown, score: previous.score - 7, correctionCost: previous.correctionCost + 1 }
            : { source: unknown, surface: unknown, reading: unknown, matches: [], score: -10, confidence: 0.1, kind: "other", correctionCost: 1 };
          const nextOptions = previous?.kind === "other" ? [...path.options.slice(0, -1), unknownOption] : [...path.options, unknownOption];
          const next: RomanPath = {
            position: position + 1,
            options: nextOptions,
            score: path.score - 10,
            matched: path.matched,
            corrections: path.corrections + 1,
          };
          states.set(position + 1, pruneRomanPaths([...(states.get(position + 1) ?? []), next]));
        }
      }
    }
    completed.push(...(states.get(text.length) ?? []));
  }

  const exact = completed.filter((path) => path.matched / Math.max(1, path.position) >= 0.72);
  const ranked = pruneRomanPaths(exact.length > 0 ? exact : completed, limit * 3);
  const seen = new Set<string>();
  return ranked.flatMap((path) => {
    const key = path.options.map((option) => option.surface).join("|");
    if (seen.has(key)) return [];
    seen.add(key);
    return [path.options];
  }).slice(0, limit);
}

async function optionsForSegment(segment: ScriptSegment, mixed: boolean): Promise<TokenOption[][]> {
  if (segment.kind === "latin") {
    const direct = await lookupDictionary(segment.text, { allowFuzzy: false, limit: mixed ? 12 : 8 });
    const directPaths = direct
      .filter((match) => match.matchType === "romaji")
      .map((match) => [{
        source: segment.text,
        surface: match.surface,
        reading: match.reading,
        matches: [match],
        score: segment.text.length * 5 + segment.text.length * segment.text.length * 0.85 + 24 + (match.common ? 2 : 0),
        confidence: match.confidence,
        kind: "romaji" as const,
        correctionCost: 0,
      }]);
    const segmented = await segmentRomanRun(segment.text, mixed ? 10 : 8);
    const combined = [...directPaths, ...segmented];
    const seen = new Set<string>();
    return combined.filter((path) => {
      const key = path.map((option) => option.surface).join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, mixed ? 12 : 8);
  }

  if (segment.kind === "hiragana" || segment.kind === "katakana") {
    const matches = await lookupDictionary(segment.text, { allowFuzzy: false, limit: 8 });
    const options = matches.map((match) => [{
      source: segment.text,
      surface: match.surface,
      reading: match.reading,
      matches: [match],
      score: segment.text.length * 4 + 6 + (match.common ? 3 : 0),
      confidence: match.confidence,
      kind: segment.kind as "hiragana" | "katakana",
      correctionCost: 0,
    }]);
    options.push([{ source: segment.text, surface: segment.text, reading: segment.text, matches: [], score: segment.text.length * 3, confidence: 0.7, kind: segment.kind, correctionCost: 0 }]);
    return options;
  }

  if (segment.kind === "han") {
    const matches = await lookupDictionary(segment.text, { allowFuzzy: false, limit: 5 });
    const primary = matches[0];
    return [[{
      source: segment.text,
      surface: segment.text,
      reading: primary?.reading ?? segment.text,
      matches,
      score: segment.text.length * 5 + (primary ? 8 : 0),
      confidence: primary?.confidence ?? 0.65,
      kind: "han",
      correctionCost: 0,
    }]];
  }

  const mappedKind: RecognitionSegment["kind"] = segment.kind === "space" ? "space" : segment.kind === "punctuation" ? "punctuation" : "other";
  return [[{
    source: segment.text,
    surface: segment.kind === "space" ? "" : segment.text,
    reading: segment.kind === "space" ? "" : segment.text,
    matches: [],
    score: 0,
    confidence: 1,
    kind: mappedKind,
    correctionCost: 0,
  }]];
}

type CombinedPath = { tokens: TokenOption[]; score: number };

async function combinationBonus(tokens: TokenOption[]) {
  const index = await getDictionaryIndex();
  const surface = tokens.map((token) => token.surface).join("");
  const reading = tokens.map((token) => token.reading).join("");
  let bonus = index.surface.has(japaneseKey(surface)) || index.reading.has(readingKey(reading)) ? 36 : 0;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const pair = `${tokens[i]?.surface ?? ""}${tokens[i + 1]?.surface ?? ""}`;
    if (pair && index.surface.has(japaneseKey(pair))) bonus += 11;
  }
  return bonus;
}

/** Resolves mixed Japanese/romaji input with per-script parsing and bounded beam search. */
export async function resolveJapaneseInput(input: string): Promise<JapaneseResolution> {
  const normalized = normalizeInput(input);
  const segments = segmentScripts(normalized);
  const meaningful = segments.filter((segment) => !["space", "punctuation", "number", "other"].includes(segment.kind));
  const mixed = new Set(meaningful.map((segment) => segment.kind)).size > 1 || meaningful.length > 1;
  const singlePhonetic = meaningful.length === 1 && ["latin", "hiragana", "katakana"].includes(meaningful[0]?.kind ?? "");
  const exactReading = singlePhonetic
    ? meaningful[0]?.kind === "latin"
      ? romajiForms(meaningful[0].text).hiraganaCandidates[0]
      : toHiragana(meaningful[0]?.text ?? "")
    : undefined;
  if (exactReading) {
    const directPhonetic = meaningful[0]?.kind === "latin"
      ? (await lookupDictionary(normalized, { allowFuzzy: false, limit: 8 })).filter((match) => match.matchType === "romaji")
      : [];
    const exactMatches = directPhonetic.length > 0 ? directPhonetic : await lookupDictionary(exactReading, { allowFuzzy: false, limit: 8 });
    const morphologyMatches = exactMatches.length === 0 ? await lookupMorphology(exactReading, 8) : [];
    const morphologyIsDecisive = morphologyMatches.length === 1
      || (morphologyMatches[0]?.score ?? 0) - (morphologyMatches[1]?.score ?? 0) >= 1.5;
    const exact = exactMatches[0] ?? (morphologyIsDecisive ? morphologyMatches[0] : undefined);
    if (exact) {
      const matches = uniqueMatches([...exactMatches, ...morphologyMatches], 8);
      return {
        normalized,
        resolved: exact.surface,
        reading: exact.reading,
        matches,
        recognition: meaningful[0]?.kind === "latin" ? {
          input,
          normalized,
          segments: [{ source: normalized, kind: "romaji", reading: exact.reading, resolved: exact.surface, confidence: exact.confidence }],
          reading: exact.reading,
          resolved: exact.surface,
          alternatives: matches.slice(0, 4).map((match) => ({ query: match.surface, label: match.surface, reading: match.reading })),
        } : undefined,
        confidence: exact.confidence,
        segmented: false,
      };
    }
    if (morphologyMatches.length > 0) {
      const alternatives = morphologyMatches.slice(0, 4).map((match) => ({ query: match.surface, label: match.surface, reading: match.reading }));
      return {
        normalized,
        resolved: exactReading,
        reading: exactReading,
        matches: morphologyMatches,
        recognition: meaningful[0]?.kind === "latin" ? {
          input,
          normalized,
          segments: [{ source: normalized, kind: "romaji", reading: exactReading, resolved: exactReading, confidence: 0.78 }],
          reading: exactReading,
          resolved: exactReading,
          alternatives,
        } : undefined,
        confidence: 0.78,
        segmented: false,
      };
    }
  }
  let beam: CombinedPath[] = [{ tokens: [], score: 0 }];

  for (const segment of segments) {
    const segmentPaths = await optionsForSegment(segment, mixed);
    const next: CombinedPath[] = [];
    for (const base of beam) {
      for (const optionPath of segmentPaths) {
        const tokens = [...base.tokens, ...optionPath];
        const baseScore = base.score + optionPath.reduce((sum, option) => sum + option.score, 0);
        next.push({ tokens, score: baseScore + await combinationBonus(tokens) });
      }
    }
    beam = next.sort((a, b) => b.score - a.score).slice(0, 24);
  }

  const best = beam[0];
  const direct = await lookupDictionary(normalized, { allowFuzzy: true, limit: 6 });
  if (!best) return { normalized, matches: direct, confidence: direct[0]?.confidence ?? 0, segmented: false };

  const resolved = best.tokens.map((token) => token.surface).join("");
  const reading = best.tokens.map((token) => token.reading).join("");
  const segmented = best.tokens.filter((token) => token.kind !== "space" && token.kind !== "punctuation").length > 1;
  const lexicalTokens = best.tokens.filter((token) => !["space", "punctuation"].includes(token.kind));
  const primaryDirect = direct[0];
  const latinOnly = meaningful.length === 1 && meaningful[0]?.kind === "latin";
  const preferDirect = Boolean(primaryDirect && (
    (latinOnly && primaryDirect.matchType === "english")
    || (primaryDirect.matchType === "fuzzy" && (primaryDirect.correctionCost ?? Infinity) <= 0.55)
  ));
  if (preferDirect && primaryDirect) {
    const alternatives = direct.slice(0, 4).map((match) => ({ query: match.surface, label: match.surface, reading: match.reading }));
    const isEnglish = primaryDirect.matchType === "english";
    return {
      normalized,
      resolved: primaryDirect.surface,
      reading: primaryDirect.reading,
      matches: direct,
      recognition: isEnglish ? undefined : {
        input,
        normalized,
        segments: [{ source: normalized, kind: "romaji", reading: primaryDirect.reading, resolved: primaryDirect.surface, confidence: primaryDirect.confidence }],
        reading: primaryDirect.reading,
        resolved: primaryDirect.surface,
        alternatives,
      },
      confidence: primaryDirect.confidence,
      segmented: false,
    };
  }
  const reliableSegmentation = segmented
    && lexicalTokens.length <= 4
    && (latinOnly
      ? romajiForms(normalized).lookupKeys.includes(normalizedLookupKey(toRomaji(reading)))
      : toHiragana(reading) === exactReading)
    && lexicalTokens.every((token) => token.kind !== "other"
      && token.matches.length > 0
      && (token.source.length >= 2 || token.matches.some((match) => match.partOfSpeech === "助词")));
  if (latinOnly && exactReading && !reliableSegmentation) {
    const alternatives = direct.slice(0, 4).map((match) => ({ query: match.surface, label: match.surface, reading: match.reading }));
    return {
      normalized,
      resolved: exactReading,
      reading: exactReading,
      matches: direct,
      recognition: {
        input,
        normalized,
        segments: [{ source: normalized, kind: "romaji", reading: exactReading, resolved: exactReading, confidence: 0.78 }],
        reading: exactReading,
        resolved: exactReading,
        alternatives,
      },
      confidence: 0.78,
      segmented: false,
    };
  }
  const tokenMatches = best.tokens.flatMap((token) => token.matches);
  const exactCombined = await lookupDictionary(resolved, { allowFuzzy: false, limit: 5 });
  const matches = uniqueMatches([...exactCombined, ...direct, ...tokenMatches.map((match) => ({ ...match, matchType: segmented ? "segmented" as const : match.matchType }))], 8);
  const resolvedTokens = lexicalTokens;
  const confidence = resolvedTokens.length > 0
    ? resolvedTokens.reduce((sum, token) => sum + token.confidence, 0) / resolvedTokens.length
    : direct[0]?.confidence ?? 0;

  const recognitionSegments: RecognitionSegment[] = best.tokens.map((token) => ({
    source: token.source,
    kind: token.kind,
    reading: token.reading || undefined,
    resolved: token.surface || undefined,
    confidence: token.confidence,
  }));
  const alternatives: SearchSuggestion[] = uniqueMatches(matches, 4).map((match) => ({ query: match.surface, label: match.surface, reading: match.reading }));
  const changed = normalized.replace(/\s/gu, "") !== resolved || segmented || segments.some((segment) => segment.kind === "latin");

  return {
    normalized,
    resolved: resolved || direct[0]?.surface,
    reading: reading || direct[0]?.reading,
    matches,
    recognition: changed ? { input, normalized, segments: recognitionSegments, reading, resolved, alternatives } : undefined,
    confidence: Math.min(1, confidence),
    segmented,
  };
}

export function dictionaryMetadata(index: DictionaryIndex) {
  return {
    version: index.dictionary.version,
    date: index.dictionary.dictDate,
    entries: index.dictionary.entries.length,
    license: index.dictionary.license,
  };
}

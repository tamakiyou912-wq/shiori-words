import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import type { CredentialConfig } from "@/lib/credentials";
import type { InputInterpretation, ProviderUsage, TargetLanguage, TranslationResult } from "@/lib/types";
import { detectLanguage, normalizeInput, resolveTarget } from "@/lib/language/preprocess";
import { isKatakanaWord, normalizeKatakanaInfo } from "@/lib/language/katakana";

const sectionNames = [
  "translation",
  "naturalTranslation",
  "literalTranslation",
  "dictionary",
  "meanings",
  "examples",
  "usageNotes",
  "katakanaOrigin",
  "katakanaInfo",
  "correction",
  "alternatives",
  "suggestions",
  "sentenceAnalysis",
] as const;

const providerSectionSchema = z.object({
  section: z.enum(sectionNames),
  data: z.unknown(),
});

export type ProviderSection = z.infer<typeof providerSectionSchema>;

export class AIProviderError extends Error {
  constructor(
    public code: "INVALID_KEY" | "RATE_LIMITED" | "UNAVAILABLE" | "INVALID_RESPONSE" | "CONFIGURATION",
    message: string,
  ) {
    super(message);
  }
}

export type AIRequest = {
  input: string;
  targetLanguage: TargetLanguage;
  followUp?: string;
  context?: TranslationResult;
  inputMode?: InputInterpretation;
  seed?: Partial<TranslationResult>;
  signal?: AbortSignal;
};

export type AICompletion = {
  result: Partial<TranslationResult>;
  sections: ProviderSection[];
  usage?: ProviderUsage;
  repaired: boolean;
  textFallback: boolean;
};

export interface AIProvider {
  complete(request: AIRequest): Promise<AICompletion>;
  listModels(): Promise<string[]>;
  testConnection(): Promise<void>;
}

function providerUrl(baseUrl: string, path: string) {
  const url = new URL(baseUrl);
  const allowInsecure = process.env.ALLOW_INSECURE_PROVIDER_URLS === "true";
  if (url.username || url.password) throw new AIProviderError("CONFIGURATION", "API Base URL 不能包含账号信息。");
  if (url.protocol !== "https:" && !allowInsecure) throw new AIProviderError("CONFIGURATION", "API Base URL 必须使用 HTTPS。");
  return `${url.toString().replace(/\/$/, "")}${path}`;
}

/** Stable prefix: keep dynamic data out so provider prompt caching can match it. */
export function systemPrompt() {
  return `SHIORI: Japanese/Chinese/English learning. Return only the output object as JSON, not the task/input/known envelope. Preserve known dictionary facts. Every word needs dictionary.chineseMeaning and 1-2 short examples. Translate naturally, not phonetically. All notes in Simplified Chinese. Add 2-3 meanings only if genuinely ambiguous. Never invent origins; omit uncertain provenance. Source/construction is NOT necessarily natural English. No redundant literal translations.`;
}

/** Local decision only: routine lookups never spend tokens on reasoning. */
export function reasoningPolicy(request: AIRequest): "disabled" | "low" {
  const text = request.followUp ?? request.input;
  const nuancedFollowUp = Boolean(request.followUp && request.context && /为什么|为何|区别|差别|语法|不自然|ニュアンス|違い|なぜ|why|difference|nuance/iu.test(text));
  return nuancedFollowUp || text.length > 240 ? "low" : "disabled";
}

function isLikelySentence(input: string) {
  const normalized = normalizeInput(input);
  if (/[。！？!?\n]/u.test(normalized)) return true;
  if (/^[\p{Script=Latin}\s'’-]+$/u.test(normalized)) return normalized.trim().split(/\s+/u).length >= 4;
  if (/[぀-ヿ]/u.test(normalized)) return normalized.length >= 7 && /[はがをにでへとも]|です|ます|ない|ました|だった/u.test(normalized);
  return normalized.length >= 5 && /[我你他她它是有在要想会能可不没吗呢了过着]/u.test(normalized);
}

function compactSeed(seed?: Partial<TranslationResult>) {
  if (!seed) return undefined;
  const composed = seed.dictionary?.partOfSpeech === "组合表达";
  const ambiguousSource = seed.detectedLanguage === "zh" || seed.detectedLanguage === "en";
  return {
    dictionary: seed.dictionary && !ambiguousSource ? {
      surface: composed ? undefined : seed.dictionary.surface,
      reading: seed.dictionary.reading,
      partOfSpeech: composed ? undefined : seed.dictionary.partOfSpeech,
      englishMeaning: composed ? undefined : seed.dictionary.englishMeaning,
    } : undefined,
    tentativeSegments: composed ? seed.recognition?.segments.map(({ resolved }) => resolved).filter(Boolean) : undefined,
    candidateMeanings: composed ? undefined : seed.meanings?.slice(0, 3),
  };
}

export function userPrompt(request: AIRequest) {
  const detected = request.seed?.detectedLanguage ?? detectLanguage(request.input);
  const target = resolveTarget(detected, request.targetLanguage);
  if (request.followUp && request.context) {
    const context = {
      original: request.context.original,
      primary: request.context.primary ?? request.context.translation,
      dictionary: request.context.dictionary,
      katakana: request.context.katakanaInfo ?? request.context.katakanaOrigin,
      meanings: request.context.meanings?.slice(0, 4),
      notes: request.context.usageNotes?.slice(0, 3),
      sentence: request.context.sentenceAnalysis ? {
        japanese: request.context.sentenceAnalysis.japanese,
        chinese: request.context.sentenceAnalysis.chinese,
        english: request.context.sentenceAnalysis.english,
      } : undefined,
    };
    return JSON.stringify({
      task: "follow-up",
      question: request.followUp,
      target,
      instruction: "Explain in Simplified Chinese; quote examples/revised wording in the target language. Answer the question itself. Preserve the supplied katakana source/modern-English distinction; do not reclassify it. For a requested direct message, address the recipient directly, not 'please tell them'.",
      output: { translation: "Chinese answer/explanation, with target-language wording when useful; no request envelope" },
      context,
    });
  }
  const sentence = isLikelySentence(request.input);
  const composed = request.seed?.dictionary?.partOfSpeech === "组合表达";
  const katakana = isKatakanaWord(request.input) || isKatakanaWord(request.seed?.dictionary?.surface ?? "")
    || (detected === "romaji" && (!request.seed?.dictionary || composed));
  const known = compactSeed(request.seed);
  return JSON.stringify({
    task: sentence ? "sentence" : "word",
    input: normalizeInput(request.input),
    detected,
    target,
    interpretation: request.inputMode !== "auto" ? request.inputMode : undefined,
    known,
    segmentation: composed ? "Tentative segmentation, not a dictionary headword. Fix unnatural orthography while preserving the known pronunciation." : undefined,
    output: sentence
      ? { translation: "target language", sentenceAnalysis: { japanese: "", reading: "", romaji: "", chinese: "", english: "", tokens: [{surface:"",reading:"",romaji:"",meaning:""}], variants: [{label:"",japanese:"",reading:"",chinese:"",english:""}] } }
      : { dictionary: {surface:"Japanese headword",reading:"kana",chineseMeaning:"Chinese meaning (required)",englishMeaning:katakana ? undefined : "natural English"}, examples:[{japanese:"Japanese sentence",reading:"kana",chinese:"natural Chinese translation"}], ...(katakana ? {katakanaInfo:{sourceExpression:"foreign construction, not romaji",sourceLanguage:"only if certain",naturalEnglish:["English for the JAPANESE meaning, not the source word"],kind:"loan|abbreviation|wasei|shift|nonEnglish",usageNote:"short Chinese note if needed"}} : {}) },
    katakana: katakana ? "abbreviation=Japanese shortening; shift=changed meaning; nonEnglish=non-English source (name language). English construction not normally used for this meaning MUST be wasei, NOT loan. loan=unchanged English borrowing. Expand abbreviations. Briefly explain meaning shifts; naturalEnglish must retain the Japanese sense." : undefined,
  });
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeStringList(value: unknown) {
  const candidates = Array.isArray(value) ? value : [value];
  return [...new Set(candidates.map(nonEmptyString).filter((item): item is string => Boolean(item)))];
}

function normalizeObjectList(value: unknown, keys: readonly string[], stringKey: string) {
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.flatMap((candidate) => {
    if (typeof candidate === "string") {
      const text = candidate.trim();
      return text ? [{ [stringKey]: text }] : [];
    }
    const source = objectValue(candidate);
    if (!source) return [];
    const item = Object.fromEntries(keys.flatMap((key) => {
      const text = nonEmptyString(source[key]);
      return text ? [[key, text]] : [];
    }));
    return Object.keys(item).length > 0 ? [item] : [];
  });
}

/** Normalizes every field independently, so one malformed optional field cannot drop the result. */
export function normalizeProviderSection(section: ProviderSection): ProviderSection | null {
  const value = section.data;
  if (section.section === "katakanaInfo") {
    const data = normalizeKatakanaInfo(value);
    return data ? { ...section, data } : null;
  }
  if (["translation", "naturalTranslation", "literalTranslation"].includes(section.section)) {
    const content = nonEmptyString(value);
    return content ? { ...section, data: content } : null;
  }
  if (section.section === "meanings") {
    const meanings = normalizeObjectList(value, ["label", "japanese", "chinese", "english", "pattern"], "chinese");
    return meanings.length ? { ...section, data: meanings } : null;
  }
  if (section.section === "examples") {
    const examples = normalizeObjectList(value, ["japanese", "reading", "chinese", "english", "register"], "japanese");
    return examples.length ? { ...section, data: examples.slice(0, 3) } : null;
  }
  if (section.section === "usageNotes" || section.section === "alternatives") {
    const items = normalizeStringList(value);
    return items.length ? { ...section, data: items.slice(0, section.section === "alternatives" ? 5 : 4) } : null;
  }
  if (section.section === "suggestions") {
    const suggestions = normalizeObjectList(value, ["query", "label", "reading"], "query")
      .filter((item) => nonEmptyString(item.query))
      .map((item) => ({ ...item, label: item.label ?? item.query }));
    return suggestions.length ? { ...section, data: suggestions.slice(0, 5) } : null;
  }

  const source = objectValue(value);
  if (!source) return null;
  if (section.section === "sentenceAnalysis") {
    const japanese = nonEmptyString(source.japanese);
    const chinese = nonEmptyString(source.chinese);
    const english = nonEmptyString(source.english);
    if (!japanese && !chinese && !english) return null;
    const tokens = normalizeObjectList(source.tokens, ["surface", "reading", "romaji", "meaning"], "surface").filter((item) => nonEmptyString(item.surface));
    const variants = normalizeObjectList(source.variants, ["label", "japanese", "reading", "romaji", "chinese", "english"], "japanese").filter((item) => nonEmptyString(item.japanese));
    return { ...section, data: { japanese: japanese ?? "", reading: nonEmptyString(source.reading), romaji: nonEmptyString(source.romaji), chinese, english, tokens, variants: variants.slice(0, 4) } };
  }
  if (section.section === "dictionary") {
    const surface = nonEmptyString(source.surface);
    const reading = nonEmptyString(source.reading);
    const chineseMeaning = nonEmptyString(source.chineseMeaning);
    const englishMeaning = nonEmptyString(source.englishMeaning);
    if (!surface && !reading && !chineseMeaning && !englishMeaning) return null;
    return { ...section, data: {
      surface: surface ?? reading ?? chineseMeaning ?? englishMeaning ?? "",
      reading,
      romaji: nonEmptyString(source.romaji),
      partOfSpeech: nonEmptyString(source.partOfSpeech),
      chineseMeaning,
      englishMeaning,
    } };
  }
  if (section.section === "katakanaOrigin") {
    const origin = nonEmptyString(source.source);
    const actualEnglish = nonEmptyString(source.actualEnglish);
    const explanation = nonEmptyString(source.explanation);
    if (!origin && !actualEnglish && !explanation) return null;
    return { ...section, data: { source: origin, actualEnglish, explanation: explanation ?? "", waseiEigo: typeof source.waseiEigo === "boolean" ? source.waseiEigo : undefined } };
  }
  if (section.section === "correction") {
    const normalized = nonEmptyString(source.normalized);
    if (!normalized) return null;
    return { ...section, data: { input: nonEmptyString(source.input) ?? "", normalized, note: nonEmptyString(source.note) } };
  }
  return null;
}

function extractSections(value: unknown, depth = 0): ProviderSection[] {
  const sections: ProviderSection[] = [];
  if (depth > 4) return sections;
  if (Array.isArray(value)) {
    for (const candidate of value.slice(0, 32)) {
      const parsed = providerSectionSchema.safeParse(candidate);
      if (parsed.success) sections.push(parsed.data);
      else sections.push(...extractSections(candidate, depth + 1));
    }
    return sections;
  }
  const object = objectValue(value);
  if (!object) return sections;
  if (Array.isArray(object.sections)) return extractSections(object.sections, depth + 1);
  for (const section of sectionNames) {
    if (object[section] !== undefined) sections.push({ section, data: object[section] });
  }
  if (!object.translation && nonEmptyString(object.primary)) sections.push({ section: "translation", data: object.primary });
  if (!sections.some((section) => section.section === "translation") && nonEmptyString(object.answer)) {
    sections.push({ section: "translation", data: object.answer });
  }
  if (!object.usageNotes && nonEmptyString(object.explanation)) sections.push({ section: "usageNotes", data: [object.explanation] });
  // Some providers mix root fields with a wrapper, or nest enrichment under
  // dictionary. Recover missing siblings without replacing valid root fields.
  for (const wrapper of ["output", "result", "data", "dictionary"]) {
    if (objectValue(object[wrapper])) {
      for (const nested of extractSections(object[wrapper], depth + 1)) {
        if (!sections.some((section) => section.section === nested.section)) sections.push(nested);
      }
    }
  }
  return sections;
}

export function parseProviderContent(content: string): Omit<AICompletion, "usage"> {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  let parsed: unknown;
  let repaired = false;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    try {
      parsed = JSON.parse(jsonrepair(cleaned));
      repaired = true;
    } catch {
      const fallback = cleaned || "AI 服务没有返回可显示的内容。";
      const section: ProviderSection = { section: "translation", data: fallback };
      return { result: { translation: fallback }, sections: [section], repaired: false, textFallback: true };
    }
  }

  const sections = extractSections(parsed).map(normalizeProviderSection).filter((section): section is ProviderSection => Boolean(section));
  if (sections.length === 0) {
    const fallback = nonEmptyString(objectValue(parsed)?.message) ?? cleaned;
    const section: ProviderSection = { section: "translation", data: fallback };
    return { result: { translation: fallback }, sections: [section], repaired, textFallback: true };
  }
  const result = Object.fromEntries(sections.map((section) => [section.section, section.data])) as Partial<TranslationResult>;
  return { result, sections, repaired, textFallback: false };
}

async function friendlyProviderError(response: Response) {
  const status = response.status;
  if (status === 401 || status === 403) return new AIProviderError("INVALID_KEY", "API Key 无效或没有权限。");
  if (status === 402) return new AIProviderError("UNAVAILABLE", "AI 账户余额不足，请先检查 Provider 余额。");
  if (status === 429) return new AIProviderError("RATE_LIMITED", "AI 服务请求过于频繁，请稍后再试。");
  if (status === 400 || status === 404) {
    const body = await response.text().catch(() => "");
    if (/model|模型/iu.test(body)) return new AIProviderError("CONFIGURATION", "当前模型不可用，请获取模型列表后重新选择。");
    return new AIProviderError("CONFIGURATION", "AI 请求配置不被 Provider 接受，请检查 Base URL 和模型名。");
  }
  return new AIProviderError("UNAVAILABLE", "AI 服务暂时不可用。");
}

type CompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

export class OpenAICompatibleProvider implements AIProvider {
  constructor(private config: CredentialConfig) {}

  private async request(path: string, init?: RequestInit) {
    const url = providerUrl(this.config.baseUrl, path);
    if (!this.config.apiKey || !/^[\x21-\x7e]+$/u.test(this.config.apiKey)) throw new AIProviderError("INVALID_KEY", "API Key 格式不正确，请从 Provider 控制台重新复制完整密钥。");
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(path === "/models" ? 12_000 : 25_000);
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      response = await fetch(url, {
        ...init,
        redirect: "error",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", ...init?.headers },
        signal,
        cache: "no-store",
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "UnknownError";
      if (name === "TimeoutError" || name === "AbortError") throw new AIProviderError("UNAVAILABLE", "连接 AI 服务超时，请稍后再试。");
      throw new AIProviderError("UNAVAILABLE", "无法连接 AI 服务，请检查网络或 API Base URL。");
    }
    if (!response.ok) throw await friendlyProviderError(response);
    return response;
  }

  private async readJson<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T;
    } catch (error) {
      const name = error instanceof Error ? error.name : "UnknownError";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new AIProviderError("UNAVAILABLE", "连接 AI 服务超时，请稍后再试。");
      }
      throw new AIProviderError("INVALID_RESPONSE", "AI 服务返回了无法解析的内容。");
    }
  }

  async complete(request: AIRequest): Promise<AICompletion> {
    if (!this.config.model) throw new AIProviderError("CONFIGURATION", "请先选择或填写模型名。");
    const reasoning = reasoningPolicy(request);
    const response = await this.request("/chat/completions", {
      method: "POST",
      signal: request.signal,
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.1,
        max_tokens: isLikelySentence(request.input) || request.followUp || reasoning !== "disabled" ? 1500 : 700,
        stream: false,
        response_format: { type: "json_object" },
        ...(this.config.provider === "deepseek" ? reasoning === "disabled"
          ? { thinking: { type: "disabled" } }
          : { thinking: { type: "enabled" }, reasoning_effort: "low" } : {}),
        messages: [
          { role: "system", content: systemPrompt() },
          { role: "user", content: userPrompt(request) },
        ],
      }),
    });
    const payload = await this.readJson<CompletionResponse>(response);
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new AIProviderError("INVALID_RESPONSE", "AI 服务没有返回内容。");
    const parsed = parseProviderContent(content);
    return {
      ...parsed,
      usage: payload.usage ? {
        inputTokens: payload.usage.prompt_tokens,
        cachedInputTokens: payload.usage.prompt_cache_hit_tokens ?? payload.usage.prompt_tokens_details?.cached_tokens,
        outputTokens: payload.usage.completion_tokens,
      } : undefined,
    };
  }

  async listModels() {
    const response = await this.request("/models");
    const payload = await this.readJson<{ data?: Array<{ id?: string }> }>(response);
    return (payload.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id)).sort();
  }

  async testConnection() {
    const models = await this.listModels();
    if (models.length === 0) throw new AIProviderError("CONFIGURATION", "连接成功，但没有可用模型。");
    if (this.config.model && !models.includes(this.config.model)) throw new AIProviderError("CONFIGURATION", `连接成功，但模型 ${this.config.model} 当前不可用。`);
  }
}

export function createProvider(config: CredentialConfig): AIProvider {
  if (config.provider === "deepseek" || config.provider === "openai-compatible") return new OpenAICompatibleProvider(config);
  throw new AIProviderError("CONFIGURATION", "暂不支持这个 API Provider。");
}

export function assembleResult(input: string, targetLanguage: TargetLanguage, sections: ProviderSection[]): TranslationResult {
  const detectedLanguage = detectLanguage(input);
  const target = resolveTarget(detectedLanguage, targetLanguage);
  const normalizedSections = sections.map(normalizeProviderSection).filter((section): section is ProviderSection => Boolean(section));
  const values = Object.fromEntries(normalizedSections.map((item) => [item.section, item.data])) as Partial<TranslationResult>;
  const fallback = values.dictionary?.surface ?? normalizeInput(input);
  return {
    detectedLanguage,
    targetLanguage: target,
    original: normalizeInput(input),
    normalizedInput: normalizeInput(input),
    primary: typeof values.translation === "string" ? values.translation : fallback,
    translation: typeof values.translation === "string" ? values.translation : fallback,
    naturalTranslation: typeof values.naturalTranslation === "string" ? values.naturalTranslation : undefined,
    literalTranslation: typeof values.literalTranslation === "string" ? values.literalTranslation : undefined,
    dictionary: values.dictionary,
    meanings: values.meanings,
    examples: values.examples,
    usageNotes: values.usageNotes,
    katakanaOrigin: values.katakanaOrigin,
    katakanaInfo: values.katakanaInfo,
    correction: values.correction,
    alternatives: values.alternatives,
    suggestions: values.suggestions,
    sentenceAnalysis: values.sentenceAnalysis,
    source: "ai",
  };
}

import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import type { CredentialConfig } from "@/lib/credentials";
import type { InputInterpretation, ProviderUsage, TargetLanguage, TranslationResult } from "@/lib/types";
import { detectLanguage, normalizeInput, resolveTarget } from "@/lib/language/preprocess";

const sectionNames = [
  "translation",
  "naturalTranslation",
  "literalTranslation",
  "dictionary",
  "meanings",
  "examples",
  "usageNotes",
  "katakanaOrigin",
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
  return `You are SHIORI, a concise Chinese-Japanese-English language assistant. Output one JSON object only, no markdown.
Use only relevant optional fields: translation,naturalTranslation,literalTranslation,dictionary,meanings,examples,usageNotes,katakanaOrigin,correction,alternatives,sentenceAnalysis.
Keep supplied reading facts. For target ja, use natural Japanese, not blind transliteration. A word needs dictionary.surface, natural chineseMeaning, englishMeaning, brief context, and at most 3 examples. For an ambiguous isolated word, include 2-3 common senses instead of silently choosing a niche one. A sentence needs sentenceAnalysis with japanese,reading,romaji,chinese,english,tokens and 2-4 register variants; do not stack redundant equivalents. For katakana, explain its Japanese meaning, source, actual modern English, and wasei-eigo status. Be brief; preserve partial facts when uncertain and never invent. Use Simplified Chinese for learning notes.`;
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
    type: seed.type,
    normalizedInput: seed.normalizedInput,
    primary: seed.primary,
    dictionary: seed.dictionary && !ambiguousSource ? {
      ...seed.dictionary,
      englishMeaning: composed ? undefined : seed.dictionary.englishMeaning,
      chineseMeaning: undefined,
    } : undefined,
    recognition: seed.recognition ? {
      normalized: seed.recognition.normalized,
      reading: seed.recognition.reading,
      resolved: seed.recognition.resolved,
      segments: seed.recognition.segments.map(({ source, kind, reading, resolved }) => ({ source, kind, reading, resolved })),
    } : undefined,
    candidateMeanings: seed.meanings?.slice(0, 5),
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
      instruction: "Answer the follow-up itself and return the revised wording or explanation. If the user asks for a direct message, write the message addressed directly to that person; do not keep third-person wording such as 'please tell them'.",
      context,
    });
  }
  return JSON.stringify({
    task: isLikelySentence(request.input) ? "sentence" : "lookup-or-translation",
    input: normalizeInput(request.input),
    detected,
    target,
    interpretation: request.inputMode ?? "auto",
    known: compactSeed(request.seed),
    required: isLikelySentence(request.input)
      ? ["sentenceAnalysis.japanese", "sentenceAnalysis.chinese", "sentenceAnalysis.english", "sentenceAnalysis.tokens", "sentenceAnalysis.variants"]
      : ["dictionary.chineseMeaning", "dictionary.englishMeaning", "examples"],
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

function extractSections(value: unknown) {
  const sections: ProviderSection[] = [];
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const parsed = providerSectionSchema.safeParse(candidate);
      if (parsed.success) sections.push(parsed.data);
    }
    return sections;
  }
  const object = objectValue(value);
  if (!object) return sections;
  if (Array.isArray(object.sections)) return extractSections(object.sections);
  for (const section of sectionNames) {
    if (object[section] !== undefined) sections.push({ section, data: object[section] });
  }
  if (!object.translation && nonEmptyString(object.primary)) sections.push({ section: "translation", data: object.primary });
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
      const timeout = AbortSignal.timeout(path === "/models" ? 15_000 : 45_000);
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

  async complete(request: AIRequest): Promise<AICompletion> {
    if (!this.config.model) throw new AIProviderError("CONFIGURATION", "请先选择或填写模型名。");
    const response = await this.request("/chat/completions", {
      method: "POST",
      signal: request.signal,
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.1,
        max_tokens: isLikelySentence(request.input) || request.followUp ? 1500 : 900,
        stream: false,
        response_format: { type: "json_object" },
        ...(this.config.provider === "deepseek" ? { thinking: { type: "disabled" } } : {}),
        messages: [
          { role: "system", content: systemPrompt() },
          { role: "user", content: userPrompt(request) },
        ],
      }),
    });
    const payload = await response.json() as CompletionResponse;
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
    const payload = await response.json() as { data?: Array<{ id?: string }> };
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
    correction: values.correction,
    alternatives: values.alternatives,
    suggestions: values.suggestions,
    sentenceAnalysis: values.sentenceAnalysis,
    source: "ai",
  };
}

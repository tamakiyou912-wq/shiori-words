export type Language = "zh" | "ja" | "en" | "romaji" | "unknown";
export type TargetLanguage = "auto" | "zh" | "ja" | "en";
export type InputInterpretation = "auto" | "hiragana" | "katakana" | "kanji";

export type DictionaryEntry = {
  surface: string;
  reading?: string;
  romaji?: string;
  partOfSpeech?: string;
  chineseMeaning?: string;
  englishMeaning?: string;
};

export type Meaning = {
  label?: string;
  japanese?: string;
  chinese?: string;
  english?: string;
  pattern?: string;
};

export type Example = {
  japanese?: string;
  reading?: string;
  chinese?: string;
  english?: string;
  register?: string;
};

export type KatakanaOrigin = {
  source?: string;
  actualEnglish?: string;
  explanation: string;
  waseiEigo?: boolean;
};

export type SearchSuggestion = {
  query: string;
  label: string;
  reading?: string;
};

export type SentenceToken = {
  surface: string;
  reading?: string;
  romaji?: string;
  meaning?: string;
};

export type ContextVariant = {
  label: string;
  japanese: string;
  reading?: string;
  romaji?: string;
  chinese?: string;
  english?: string;
};

export type SentenceAnalysis = {
  japanese: string;
  reading?: string;
  romaji?: string;
  chinese?: string;
  english?: string;
  tokens?: SentenceToken[];
  variants?: ContextVariant[];
};

export type QueryType = "word" | "sentence" | "mixed" | "symbol";

export type RecognitionSegment = {
  source: string;
  kind: "han" | "hiragana" | "katakana" | "romaji" | "english" | "space" | "punctuation" | "other";
  reading?: string;
  resolved?: string;
  confidence?: number;
};

export type InputRecognition = {
  input: string;
  normalized: string;
  segments: RecognitionSegment[];
  reading?: string;
  resolved?: string;
  alternatives?: SearchSuggestion[];
};

export type ProviderUsage = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
};

export type QueryTelemetry = {
  normalizeMs: number;
  dictionaryMs: number;
  aiMs?: number;
  totalMs: number;
  aiCalls: number;
  cacheHit?: boolean;
  usage?: ProviderUsage;
};

export type TranslationResult = {
  type?: QueryType;
  detectedLanguage: Language;
  targetLanguage: Exclude<TargetLanguage, "auto">;
  original: string;
  normalizedInput?: string;
  primary?: string;
  translation: string;
  naturalTranslation?: string;
  literalTranslation?: string;
  dictionary?: DictionaryEntry;
  meanings?: Meaning[];
  examples?: Example[];
  usageNotes?: string[];
  katakanaOrigin?: KatakanaOrigin;
  correction?: { input: string; normalized: string; note?: string };
  alternatives?: string[];
  suggestions?: SearchSuggestion[];
  sentenceAnalysis?: SentenceAnalysis;
  recognition?: InputRecognition;
  source?: "dictionary" | "ai" | "hybrid" | "cache" | "fallback";
  confidence?: number;
  warnings?: string[];
};

export type StreamEvent =
  | { type: "meta"; data: { detectedLanguage: Language; targetLanguage: string; source: "dictionary" | "ai" | "hybrid" | "cache" | "fallback" } }
  | { type: "section"; data: { key: keyof TranslationResult; value: unknown } }
  | { type: "done"; data: { result: TranslationResult; conversationId?: string; remainingUses?: number; telemetry?: QueryTelemetry } }
  | { type: "error"; message: string; code?: string };

export type ConversationContext = {
  original: string;
  result: TranslationResult;
  followUps: Array<{ question: string; answer: string }>;
};

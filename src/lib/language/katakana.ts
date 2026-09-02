import type { KatakanaInfo, TranslationResult } from "@/lib/types";

export const katakanaKinds = {
  loan: "直接借词", abbreviation: "日语缩略形式", wasei: "和制英语",
  shift: "语义发生变化", nonEnglish: "非英语来源",
} as const;

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : undefined;
const expressionKey = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en")
  .replace(/\([^()]*[\p{Script=Han}ぁ-ゖァ-ヶ][^()]*\)/gu, "")
  .replace(/[\p{P}\p{Z}]/gu, "");

/** Field-level recovery: optional etymology must never invalidate the translation. */
export function normalizeKatakanaInfo(value: unknown): KatakanaInfo | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  const naturalEnglish = (Array.isArray(raw.naturalEnglish) ? raw.naturalEnglish : [raw.naturalEnglish])
    .flatMap((item) => text(item)?.split(/\s*[\/;；·]\s*/u) ?? [])
    .filter((item, index, list) => item && list.findIndex((other) => expressionKey(other) === expressionKey(item)) === index).slice(0, 3);
  const info: KatakanaInfo = {
    kind: typeof raw.kind === "string" && Object.hasOwn(katakanaKinds, raw.kind) ? raw.kind as KatakanaInfo["kind"] : undefined,
    sourceLanguage: text(raw.sourceLanguage), sourceExpression: text(raw.sourceExpression),
    naturalEnglish: naturalEnglish.length ? naturalEnglish : undefined,
    formationNote: text(raw.formationNote), usageNote: text(raw.usageNote),
    isWaseiEigo: typeof raw.isWaseiEigo === "boolean" ? raw.isWaseiEigo : undefined,
  };
  // A Japanese expansion belongs in formationNote, not in foreign provenance.
  // Keep the English meaning even when the provider fills this field wrongly.
  if (info.sourceExpression && /^[ぁ-ゖァ-ヶー・\s]+$/u.test(info.sourceExpression)) info.sourceExpression = undefined;
  // "Unchanged borrowing" cannot simultaneously claim a multi-word English
  // construction and only different modern equivalents. Leave taxonomy open
  // rather than inventing a wasei/semantic-shift verdict locally.
  if (info.kind === "loan" && info.sourceExpression?.trim().includes(" ") && naturalEnglish.length
    && !naturalEnglish.some((item) => expressionKey(item) === expressionKey(info.sourceExpression!))) {
    info.kind = undefined;
    info.formationNote = undefined;
    info.usageNote = [info.usageNote, "来源或构成表达不一定是日常英语说法，请参考上面的自然英语。"].filter(Boolean).join(" ");
  }
  return Object.values(info).some((item) => item !== undefined) ? info : undefined;
}

export function isKatakanaWord(surface: string) {
  return /[ァ-ヶ]/u.test(surface) && /^[ァ-ヶー・･\s]+$/u.test(surface);
}

/** Old history remains readable; don't guess a source language from Latin spelling. */
export function katakanaPresentation(result: Partial<TranslationResult>) {
  const legacy = result.katakanaOrigin;
  const info = normalizeKatakanaInfo(result.katakanaInfo) ?? normalizeKatakanaInfo(legacy && {
    sourceExpression: legacy.source, naturalEnglish: legacy.actualEnglish,
    usageNote: legacy.explanation, isWaseiEigo: legacy.waseiEigo,
  });
  if (!info && !isKatakanaWord(result.dictionary?.surface ?? "") && !isKatakanaWord(result.original ?? "")) return;
  const natural = info?.naturalEnglish?.length ? info.naturalEnglish : result.dictionary?.englishMeaning?.split(/\s*[\/;；·]\s*/u) ?? [];
  return {
    ...info,
    naturalEnglish: natural.filter((item, index) => expressionKey(item) !== expressionKey(info?.sourceExpression ?? "")
      && natural.findIndex((other) => expressionKey(other) === expressionKey(item)) === index),
    label: info?.kind ? katakanaKinds[info.kind] : info?.isWaseiEigo ? "和制英语" : undefined,
  };
}

/** Display-only sizing; no word-specific rules or changes to query normalization. */
export function titleLengthClass(value: string) {
  const length = [...value.normalize("NFC")].length;
  return length <= 4 ? "title-short" : length <= 8 ? "title-medium" : "title-long";
}

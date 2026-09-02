import type { TranslationResult } from "@/lib/types";

export const CACHE_SCHEMA_VERSION = "query-v12-katakana";
const MAX_ENTRIES = 256;
const TTL_MS = 24 * 60 * 60 * 1000;

type CacheEntry = { expiresAt: number; result: TranslationResult };

const globalCache = globalThis as typeof globalThis & { __shioriQueryCache?: Map<string, CacheEntry> };
const cache = globalCache.__shioriQueryCache ??= new Map<string, CacheEntry>();

export function isPublicCacheable(result: Pick<TranslationResult, "type" | "normalizedInput">) {
  const input = result.normalizedInput ?? "";
  return (result.type === "word" || result.type === "mixed")
    && input.length > 0
    && input.length <= 36
    && !/[\n。！？!?]/u.test(input)
    && !/\b(?:my|mine|i|me|我的|我叫|姓名)\b/iu.test(input);
}

export function queryCacheKey(input: string, target: string, provider: string, model: string) {
  return [CACHE_SCHEMA_VERSION, input, target, provider, model].join("\0");
}

export function getCachedQuery(key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return structuredClone(entry.result);
}

export function setCachedQuery(key: string, result: TranslationResult) {
  cache.set(key, { expiresAt: Date.now() + TTL_MS, result: structuredClone(result) });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export function clearQueryCache() {
  cache.clear();
}

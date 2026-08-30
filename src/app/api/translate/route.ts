import { z } from "zod";
import { randomBytes } from "node:crypto";
import { assembleResult, createProvider, AIProviderError } from "@/lib/ai/provider";
import { createConversation, getConversation, addFollowUp, saveHistory } from "@/lib/conversations";
import { getCredential } from "@/lib/credentials";
import { reserveGuestUse, releaseGuestUse } from "@/lib/guest-usage";
import { publicError } from "@/lib/http";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { getPrincipal } from "@/lib/principal";
import { finalizeWithoutAI, mergeAIResult, prepareQuery } from "@/lib/query/pipeline";
import { getCachedQuery, isPublicCacheable, queryCacheKey, setCachedQuery } from "@/lib/query/cache";
import type { QueryTelemetry, StreamEvent, TranslationResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 40;

const requestSchema = z.object({
  input: z.string().trim().min(1).max(2000),
  targetLanguage: z.enum(["auto", "zh", "ja", "en"]).default("auto"),
  conversationId: z.string().uuid().optional(),
  followUp: z.string().trim().min(1).max(500).optional(),
  inputMode: z.enum(["auto", "hiragana", "katakana", "kanji"]).default("auto"),
});

export function streamResponse(run: (send: (event: StreamEvent) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      let open = true;
      const send = (event: StreamEvent) => {
        if (open) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      // Returning the async task from start() keeps the stream in its starting
      // state, so browsers cannot read local sections until AI work finishes.
      // Run it in the background and return immediately to expose each chunk.
      void run(send)
        .catch((error) => {
          const friendly = publicError(error);
          send({ type: "error", message: friendly.message, code: friendly.code });
        })
        .finally(() => {
          open = false;
          controller.close();
        });
    },
  }), { headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}

const progressiveKeys: Array<keyof TranslationResult> = [
  "primary", "translation", "naturalTranslation", "literalTranslation", "dictionary", "recognition", "correction",
  "meanings", "examples", "suggestions", "alternatives", "sentenceAnalysis", "katakanaOrigin", "usageNotes", "warnings",
];

function sendInitialResult(send: (event: StreamEvent) => void, result: TranslationResult) {
  for (const key of progressiveKeys) {
    if (result[key] !== undefined) send({ type: "section", data: { key, value: result[key] } });
  }
}

function hasDictionaryFallback(result: TranslationResult) {
  return Boolean(result.dictionary?.surface || (result.recognition?.resolved && result.recognition.resolved !== result.normalizedInput));
}

function providerWarning(error: AIProviderError) {
  if (error.code === "INVALID_KEY") return "基础词典结果已显示；API Key 无效，请在设置中替换后再试。";
  if (error.code === "RATE_LIMITED") return "基础词典结果已显示；AI 请求过于频繁，请稍后再试。";
  return `基础词典结果已显示；${error.message}`;
}

function logTelemetry(telemetry: QueryTelemetry) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[query]", {
    totalMs: Math.round(telemetry.totalMs),
    dictionaryMs: Math.round(telemetry.dictionaryMs),
    aiMs: telemetry.aiMs === undefined ? undefined : Math.round(telemetry.aiMs),
    aiCalls: telemetry.aiCalls,
    cacheHit: telemetry.cacheHit ?? false,
    inputTokens: telemetry.usage?.inputTokens,
    cachedInputTokens: telemetry.usage?.cachedInputTokens,
    outputTokens: telemetry.usage?.outputTokens,
  });
}

function diagnosticCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if (current instanceof AIProviderError) return current.code;
    if ("code" in current && typeof current.code === "string") return current.code;
    if (current instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(current.message)) return current.message;
    current = "cause" in current ? current.cause : undefined;
  }
  return error instanceof Error ? error.name : "UNKNOWN";
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return streamResponse(async (send) => send({ type: "error", message: "请输入有效的查询内容。", code: "INVALID_INPUT" }));

  const principal = await getPrincipal();
  if (!principal) return streamResponse(async (send) => send({ type: "error", message: "请先登录或输入体验码。", code: "UNAUTHORIZED" }));

  return streamResponse(async (send) => {
    let guestReserved = false;
    let remainingUses: number | undefined;
    let stage = "rate-limit";
    const started = performance.now();
    try {
      await enforceRateLimit(`ip:${clientIp(request)}`, 30);
      const payload = parsed.data;
      stage = "conversation";
      let conversation = payload.conversationId ? await getConversation(principal, payload.conversationId) : null;
      if (payload.followUp && !conversation) throw new Error("CONVERSATION_NOT_FOUND");

      if (payload.followUp && conversation) {
        stage = "credential";
        const credential = await getCredential(principal.credentialOwnerId);
        if (!credential) throw new Error("API_CREDENTIAL_REQUIRED");
        if (principal.kind === "guest") {
          await enforceRateLimit(`guest-code:${principal.guestCodeId}`, 12);
          const reservation = await reserveGuestUse(principal.guestCodeId);
          guestReserved = true;
          remainingUses = reservation.remaining;
        }
        send({ type: "meta", data: {
          detectedLanguage: conversation.context.result.detectedLanguage,
          targetLanguage: conversation.context.result.targetLanguage,
          source: "ai",
        } });
        const aiStarted = performance.now();
        stage = "provider";
        const completion = await createProvider(credential).complete({
          input: conversation.context.original,
          targetLanguage: payload.targetLanguage,
          followUp: payload.followUp,
          context: conversation.context.result,
          inputMode: payload.inputMode,
          signal: request.signal,
        });
        const result = assembleResult(conversation.context.original, payload.targetLanguage, completion.sections);
        const answer = result.translation || result.naturalTranslation || result.primary || "";
        stage = "follow-up-persist";
        await addFollowUp(conversation.id, conversation.context, payload.followUp, answer);
        const telemetry: QueryTelemetry = {
          normalizeMs: 0,
          dictionaryMs: 0,
          aiMs: performance.now() - aiStarted,
          totalMs: performance.now() - started,
          aiCalls: 1,
          usage: completion.usage,
        };
        logTelemetry(telemetry);
        send({ type: "done", data: { result, conversationId: conversation.id, remainingUses, telemetry: process.env.NODE_ENV === "development" ? telemetry : undefined } });
        return;
      }

      stage = "prepare-query";
      const plan = await prepareQuery(payload.input, payload.targetLanguage, payload.inputMode);
      send({ type: "meta", data: {
        detectedLanguage: plan.detectedLanguage,
        targetLanguage: plan.targetLanguage,
        source: plan.baseResult.source ?? "fallback",
      } });
      sendInitialResult(send, plan.baseResult);
      if (plan.needsAI && hasDictionaryFallback(plan.baseResult)) {
        // The stream is live at this point; cross Vercel's small-chunk buffering
        // threshold so mobile browsers receive the local sections immediately.
        send({ type: "progress", padding: randomBytes(6_144).toString("base64") });
      }
      let result = plan.baseResult;

      if (plan.needsAI) {
        stage = "credential";
        const credential = await getCredential(principal.credentialOwnerId);
        if (!credential) {
          if (!hasDictionaryFallback(result)) throw new Error("API_CREDENTIAL_REQUIRED");
          result = finalizeWithoutAI(result, "当前只显示基础词典结果；配置 AI API 后可获得中文解释、例句和语境。 ");
        } else {
          const cacheKey = queryCacheKey(plan.normalizedInput, plan.targetLanguage, credential.provider, credential.model);
          const cached = isPublicCacheable(plan.baseResult) ? getCachedQuery(cacheKey) : null;
          if (cached) {
            result = {
              ...cached,
              original: payload.input,
              normalizedInput: plan.normalizedInput,
              recognition: plan.baseResult.recognition ?? cached.recognition,
              source: "cache",
            };
            plan.telemetry.cacheHit = true;
          } else {
            if (principal.kind === "guest") {
              await enforceRateLimit(`guest-code:${principal.guestCodeId}`, 12);
              const reservation = await reserveGuestUse(principal.guestCodeId);
              guestReserved = true;
              remainingUses = reservation.remaining;
            }
            const aiStarted = performance.now();
            try {
              stage = "provider";
              const completion = await createProvider(credential).complete({
                input: payload.input,
                targetLanguage: payload.targetLanguage,
                inputMode: payload.inputMode,
                seed: plan.baseResult,
                signal: request.signal,
              });
              plan.telemetry.aiMs = performance.now() - aiStarted;
              plan.telemetry.aiCalls = 1;
              plan.telemetry.usage = completion.usage;
              result = mergeAIResult(plan.baseResult, completion.result);
              if (isPublicCacheable(result)) setCachedQuery(cacheKey, result);
            } catch (error) {
              if (guestReserved && principal.kind === "guest") {
                await releaseGuestUse(principal.guestCodeId).catch(() => undefined);
                guestReserved = false;
                if (remainingUses !== undefined) remainingUses += 1;
              }
              if (error instanceof AIProviderError && hasDictionaryFallback(plan.baseResult)) {
                result = finalizeWithoutAI(plan.baseResult, providerWarning(error));
              } else {
                throw error;
              }
            }
          }
        }
      } else {
        result = finalizeWithoutAI(result, result.type === "symbol" ? "请输入一个词、句子或可识别的日语罗马字。" : undefined);
      }

      if (request.signal.aborted) throw new DOMException("Request aborted", "AbortError");
      stage = "conversation-persist";
      const conversationId = await createConversation(principal, result);
      conversation = await getConversation(principal, conversationId);
      if (principal.kind === "user") {
        stage = "history-persist";
        await saveHistory(principal.userId, conversationId, result);
      }
      plan.telemetry.totalMs = performance.now() - started;
      logTelemetry(plan.telemetry);
      send({ type: "done", data: { result, conversationId: conversation?.id ?? conversationId, remainingUses, telemetry: process.env.NODE_ENV === "development" ? plan.telemetry : undefined } });
    } catch (error) {
      console.error("[translate] request failed", { stage, code: diagnosticCode(error) });
      if (guestReserved && principal.kind === "guest") await releaseGuestUse(principal.guestCodeId).catch(() => undefined);
      if (request.signal.aborted) return;
      if (error instanceof AIProviderError) {
        send({ type: "error", message: error.message, code: error.code });
        return;
      }
      const code = error instanceof Error ? error.message : "UNKNOWN";
      if (code === "API_CREDENTIAL_REQUIRED") send({ type: "error", message: "请先在设置中配置自己的 AI API。", code });
      else if (code === "CONVERSATION_NOT_FOUND") send({ type: "error", message: "这段对话已过期，请重新查询。", code });
      else {
        const friendly = publicError(error);
        send({ type: "error", message: friendly.message, code: friendly.code });
      }
    }
  });
}

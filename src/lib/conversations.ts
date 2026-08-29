import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversations, translationHistory } from "@/db/schema";
import type { ConversationContext, TranslationResult } from "./types";
import type { Principal } from "./principal";

export async function createConversation(principal: Principal, result: TranslationResult) {
  const id = crypto.randomUUID();
  const context: ConversationContext = { original: result.original, result, followUps: [] };
  const isGuest = principal.kind === "guest";
  await getDb().insert(conversations).values({
    id,
    userId: principal.kind === "user" ? principal.userId : null,
    guestSessionId: isGuest ? principal.guestSessionId : null,
    context,
    expiresAt: isGuest ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
  });
  return id;
}

export async function getConversation(principal: Principal, id: string) {
  const ownership = principal.kind === "user" ? eq(conversations.userId, principal.userId) : eq(conversations.guestSessionId, principal.guestSessionId);
  return getDb().query.conversations.findFirst({ where: and(eq(conversations.id, id), ownership) });
}

export async function addFollowUp(id: string, context: ConversationContext, question: string, answer: string) {
  const next: ConversationContext = {
    ...context,
    followUps: [...context.followUps, { question, answer }].slice(-6),
  };
  await getDb().update(conversations).set({ context: next, updatedAt: new Date() }).where(eq(conversations.id, id));
}

export async function saveHistory(userId: string, conversationId: string, result: TranslationResult) {
  const summary = result.dictionary?.surface || result.translation.slice(0, 120);
  await getDb().insert(translationHistory).values({
    id: crypto.randomUUID(),
    userId,
    conversationId,
    input: result.original,
    summary,
    detectedLanguage: result.detectedLanguage,
    targetLanguage: result.targetLanguage,
    result,
  });
}

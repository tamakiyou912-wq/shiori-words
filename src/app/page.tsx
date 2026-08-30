import { getDb } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { guestCodes, translationHistory } from "@/db/schema";
import { TranslatorApp } from "@/components/translator-app";
import { getPrincipal } from "@/lib/principal";
import { getPublicSiteState } from "@/lib/site";

export default async function Home({ searchParams }: { searchParams: Promise<{ history?: string }> }) {
  const [principal, site] = await Promise.all([getPrincipal(), getPublicSiteState()]);
  const params = await searchParams;
  let guest: { code: string; remainingUses: number } | null = null;
  if (principal?.kind === "guest") {
    const code = await getDb().query.guestCodes.findFirst({ where: eq(guestCodes.id, principal.guestCodeId) });
    if (code) guest = { code: code.code, remainingUses: Math.max(0, code.maxUses - code.usedUses) };
  }
  let historyResult = null;
  let historyConversationId: string | undefined;
  if (params.history && principal?.kind === "user") {
    const item = await getDb().query.translationHistory.findFirst({ where: and(eq(translationHistory.id, params.history), eq(translationHistory.userId, principal.userId)) });
    if (item) {
      historyResult = item.result;
      historyConversationId = item.conversationId ?? undefined;
    }
  }
  return <TranslatorApp hasAccess={Boolean(principal)} allowGuestCodes={site.allowGuestCodes} guest={guest} initialResult={historyResult} initialConversationId={historyConversationId} />;
}

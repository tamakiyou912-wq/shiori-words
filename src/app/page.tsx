import { getDb } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { Suspense } from "react";
import { guestCodes, translationHistory } from "@/db/schema";
import { TranslatorApp } from "@/components/translator-app";
import { getPrincipal } from "@/lib/principal";
import { getHomeSiteState } from "@/lib/site";

function TranslatorShell() {
  return (
    <main className="main-content" aria-busy="true" aria-label="正在准备翻译器">
      <section className="translator translator-shell">
        <div className="translation-field">
          <div className="translator-shell-input">输入中文、日语、英语或罗马字……</div>
          <div className="translation-controls">
            <span>目标语言　自动判断</span>
            <span className="button primary translate-button" aria-hidden="true">翻译　→</span>
          </div>
        </div>
      </section>
    </main>
  );
}

async function HomeContent({ searchParams }: { searchParams: Promise<{ history?: string }> }) {
  const [principal, site] = await Promise.all([getPrincipal(), getHomeSiteState()]);
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

export default function Home({ searchParams }: { searchParams: Promise<{ history?: string }> }) {
  return (
    <Suspense fallback={<TranslatorShell />}>
      <HomeContent searchParams={searchParams} />
    </Suspense>
  );
}

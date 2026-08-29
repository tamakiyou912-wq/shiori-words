import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { translationHistory } from "@/db/schema";
import { HistoryClient } from "@/components/history-client";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "历史" };

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const items = await getDb().query.translationHistory.findMany({ where: eq(translationHistory.userId, user.id), orderBy: [desc(translationHistory.createdAt)], limit: 100 });
  return <HistoryClient initialItems={items.map((item) => ({ id: item.id, input: item.input, summary: item.summary, detectedLanguage: item.detectedLanguage, targetLanguage: item.targetLanguage, createdAt: item.createdAt.toISOString() }))} />;
}

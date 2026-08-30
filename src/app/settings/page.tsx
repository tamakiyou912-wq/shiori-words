import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { guestCodes } from "@/db/schema";
import { SettingsClient } from "@/components/settings-client";
import { getCurrentUser } from "@/lib/auth";
import { getCredentialSummary } from "@/lib/credentials";
import { getOwnerSnapshot } from "@/lib/owner";
import { ensureSiteSettings } from "@/lib/site";

export const metadata: Metadata = { title: "设置" };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [credential, codes, settings, owner] = await Promise.all([
    getCredentialSummary(user.id),
    getDb().query.guestCodes.findMany({ where: eq(guestCodes.ownerUserId, user.id), orderBy: [desc(guestCodes.createdAt)] }),
    ensureSiteSettings(),
    user.role === "OWNER" ? getOwnerSnapshot() : Promise.resolve(null),
  ]);
  return <SettingsClient username={user.username} defaultConfig={{ provider: process.env.DEFAULT_AI_PROVIDER || "deepseek", baseUrl: process.env.DEFAULT_AI_BASE_URL || "https://api.deepseek.com", model: process.env.DEFAULT_AI_MODEL || "deepseek-v4-flash" }} initialCredential={credential ? { provider: credential.provider, baseUrl: credential.baseUrl, model: credential.model, hasKey: true } : null} initialCodes={codes.map((code) => ({ ...code, createdAt: code.createdAt.toISOString(), expiresAt: code.expiresAt?.toISOString() ?? null }))} allowGuestCodes={settings.allowGuestCodes} owner={owner} />;
}

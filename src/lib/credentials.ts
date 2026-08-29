import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { apiCredentials } from "@/db/schema";
import { decryptSecret } from "./security";

export type CredentialConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export function normalizeProviderModel(provider: string, model: string) {
  if (provider === "deepseek") {
    if (model === "deepseek-chat") return "deepseek-v4-flash";
    if (model === "deepseek-reasoner") return "deepseek-v4-pro";
  }
  return model;
}

export async function getCredential(userId: string): Promise<CredentialConfig | null> {
  const row = await getDb().query.apiCredentials.findFirst({ where: eq(apiCredentials.userId, userId) });
  if (!row) return null;
  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: normalizeProviderModel(row.provider, row.model),
    apiKey: decryptSecret(row.encryptedKey),
  };
}

export async function getCredentialSummary(userId: string) {
  const row = await getDb().query.apiCredentials.findFirst({
    columns: { provider: true, baseUrl: true, model: true, updatedAt: true },
    where: eq(apiCredentials.userId, userId),
  });
  return row ? { ...row, model: normalizeProviderModel(row.provider, row.model), hasKey: true as const } : null;
}

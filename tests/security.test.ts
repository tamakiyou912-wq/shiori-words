import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { apiCredentials, users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { getCredentialSummary } from "@/lib/credentials";
import { decryptSecret, encryptSecret } from "@/lib/security";

describe("credential security", () => {
  it("encrypts API keys with authenticated encryption", () => {
    const secret = "test-private-never-leak";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("hashes passwords with bcrypt", async () => {
    const passwordHash = await hashPassword("correct horse battery staple");
    expect(passwordHash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery staple", passwordHash)).toBe(true);
    expect(await verifyPassword("wrong password", passwordHash)).toBe(false);
  });

  it("returns only masked credential metadata to the browser-facing summary", async () => {
    const userId = crypto.randomUUID();
    await getDb().insert(users).values({ id: userId, username: `secure-${userId}`, passwordHash: "hash" });
    await getDb().insert(apiCredentials).values({ id: crypto.randomUUID(), userId, provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "test-model", encryptedKey: encryptSecret("sk-secret") });
    const summary = await getCredentialSummary(userId);
    expect(summary).toMatchObject({ provider: "deepseek", hasKey: true });
    expect(JSON.stringify(summary)).not.toContain("sk-secret");
    expect(JSON.stringify(summary)).not.toContain("encryptedKey");
    const stored = await getDb().query.apiCredentials.findFirst({ where: eq(apiCredentials.userId, userId) });
    expect(stored?.encryptedKey).not.toContain("sk-secret");
  });
});

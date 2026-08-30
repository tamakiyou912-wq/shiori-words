import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { apiCredentials, sessions, users } from "@/db/schema";
import { createSession, hashPassword, SESSION_MAX_AGE_SECONDS, verifyPassword } from "@/lib/auth";
import { getCredentialSummary } from "@/lib/credentials";
import { clearRateLimit, enforceRateLimit } from "@/lib/rate-limit";
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

  it("keeps independent sessions for simultaneous devices", async () => {
    const userId = crypto.randomUUID();
    await getDb().insert(users).values({ id: userId, username: `sessions-${userId}`, passwordHash: "hash" });
    const [phoneSession, desktopSession] = await Promise.all([createSession(userId), createSession(userId)]);
    const storedSessions = await getDb().query.sessions.findMany({ where: eq(sessions.userId, userId) });

    expect(phoneSession.token).not.toBe(desktopSession.token);
    expect(storedSessions).toHaveLength(2);
  });

  it("creates a fixed thirty-day persistent server session", async () => {
    const userId = crypto.randomUUID();
    await getDb().insert(users).values({ id: userId, username: `expiry-${userId}`, passwordHash: "hash" });
    const before = Date.now();
    const session = await createSession(userId);
    const after = Date.now();
    const expectedMs = SESSION_MAX_AGE_SECONDS * 1000;

    expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs);
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs);
    expect(SESSION_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("updates the persistent rate-limit window and rejects only over-limit attempts", async () => {
    const key = `test-rate-limit:${crypto.randomUUID()}`;
    await expect(enforceRateLimit(key, 1)).resolves.toBeUndefined();
    await expect(enforceRateLimit(key, 1)).rejects.toThrow("RATE_LIMITED");
    await clearRateLimit(key);
  });
});

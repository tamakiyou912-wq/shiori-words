import { mkdir, unlink, writeFile } from "node:fs/promises";

process.loadEnvFile(".env");

const { eq, like } = await import("drizzle-orm");
const { getDb, closeDb } = await import("../src/db/client");
const { users, sessions, apiCredentials } = await import("../src/db/schema");
const { hashToken, randomToken } = await import("../src/lib/security");

const db = getDb();
const prefix = "qa-blackbox-";
const mode = process.argv[2];

async function cleanup() {
  const qaUsers = await db.select({ id: users.id }).from(users).where(like(users.username, `${prefix}%`));
  for (const user of qaUsers) await db.delete(users).where(eq(users.id, user.id));
  await unlink(new URL("../work/qa-blackbox-session.json", import.meta.url)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

if (mode === "setup") {
  await cleanup();
  const source = (await db.select().from(apiCredentials).limit(1))[0];
  if (!source) throw new Error("No saved API credential is available for the real QA run.");
  const userId = crypto.randomUUID();
  const username = `${prefix}${Date.now()}`;
  const token = randomToken();
  await db.insert(users).values({ id: userId, username, passwordHash: "qa-not-a-login-account" });
  await db.insert(apiCredentials).values({
    id: crypto.randomUUID(), userId, provider: source.provider, baseUrl: source.baseUrl, model: source.model, encryptedKey: source.encryptedKey,
  });
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000) });
  await mkdir(new URL("../work", import.meta.url), { recursive: true });
  await writeFile(new URL("../work/qa-blackbox-session.json", import.meta.url), JSON.stringify({ username, token }), { mode: 0o600 });
  console.log(`QA fixture created for ${username}; credential remained encrypted.`);
} else if (mode === "cleanup") {
  await cleanup();
  console.log("QA fixture database rows removed.");
} else {
  throw new Error("Usage: tsx scripts/qa-fixture.ts setup|cleanup");
}

await closeDb();

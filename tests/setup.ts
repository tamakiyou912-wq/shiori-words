import { beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

process.env.DATABASE_URL = "memory://";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

beforeAll(async () => {
  const { getDb, getEmbeddedClient } = await import("@/db/client");
  getDb();
  const migration = await readFile(resolve(process.cwd(), "drizzle/0000_initial.sql"), "utf8");
  await getEmbeddedClient()!.exec(migration);
});

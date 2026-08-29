import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type AppDatabase = PgliteDatabase<typeof schema>;

const globalDatabase = globalThis as typeof globalThis & {
  shioriDatabase?: AppDatabase;
  shioriPglite?: PGlite;
  shioriPostgres?: ReturnType<typeof postgres>;
  shioriShutdownRegistered?: boolean;
};

function registerEmbeddedShutdown() {
  if (globalDatabase.shioriShutdownRegistered) return;
  globalDatabase.shioriShutdownRegistered = true;
  const shutdown = () => {
    const forceExit = setTimeout(() => process.exit(1), 2_000);
    forceExit.unref();
    void closeDb().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function localDataPath(url: string) {
  if (url === "memory://") return "memory://";
  if (url.startsWith("file:")) return url.slice("file:".length);
  return url;
}

export function isPostgresDatabase() {
  return /^(postgres|postgresql):\/\//.test(process.env.DATABASE_URL ?? "");
}

export function getDb(): AppDatabase {
  if (globalDatabase.shioriDatabase) return globalDatabase.shioriDatabase;

  const url = process.env.DATABASE_URL || "file:./data/shiori";
  if (process.env.VERCEL && !/^(postgres|postgresql):\/\//.test(url)) {
    throw new Error("DATABASE_URL_POSTGRES_REQUIRED");
  }
  if (isPostgresDatabase()) {
    // One pooled connection per warm Serverless instance is enough for this app.
    // A module-global client is reused across requests instead of reconnecting.
    const client = postgres(url, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      max_lifetime: 60 * 30,
    });
    globalDatabase.shioriPostgres = client;
    globalDatabase.shioriDatabase = drizzlePostgres(client, { schema }) as unknown as AppDatabase;
  } else {
    const dataPath = localDataPath(url);
    if (dataPath !== "memory://") mkdirSync(dirname(dataPath), { recursive: true });
    const client = new PGlite(dataPath);
    globalDatabase.shioriPglite = client;
    globalDatabase.shioriDatabase = drizzlePglite(client, { schema });
    registerEmbeddedShutdown();
  }

  return globalDatabase.shioriDatabase;
}

export function getEmbeddedClient() {
  return globalDatabase.shioriPglite;
}

export async function closeDb() {
  await globalDatabase.shioriPglite?.close();
  await globalDatabase.shioriPostgres?.end();
  delete globalDatabase.shioriDatabase;
  delete globalDatabase.shioriPglite;
  delete globalDatabase.shioriPostgres;
}

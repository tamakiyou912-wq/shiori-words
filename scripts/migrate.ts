import { mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import nextEnv from "@next/env";
import postgres from "postgres";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || "file:./data/shiori";
if (process.env.VERCEL && !/^(postgres|postgresql):\/\//.test(databaseUrl)) {
  throw new Error("Vercel deployment requires a PostgreSQL DATABASE_URL.");
}
const migration = await readFile(resolve(process.cwd(), "drizzle/0000_initial.sql"), "utf8");

if (/^(postgres|postgresql):\/\//.test(databaseUrl)) {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  await client.unsafe(migration);
  await client.end();
} else {
  const path = databaseUrl === "memory://" ? "memory://" : databaseUrl.replace(/^file:/, "");
  if (path !== "memory://") await mkdir(dirname(resolve(path)), { recursive: true });
  const client = new PGlite(path);
  await client.exec(migration);
  await client.close();
}

process.stdout.write("Database is ready.\n");

import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve(process.cwd(), ".env");

function upsert(lines: string[], name: string, value: string) {
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (index === -1) lines.push(`${name}=${value}`);
  else if (!lines[index]!.slice(name.length + 1).trim()) lines[index] = `${name}=${value}`;
}

let source = "";
try {
  source = await readFile(target, "utf8");
} catch {
  source = [
    "# Local development. Production values belong in the hosting provider's secret store.",
    "DATABASE_URL=file:./data/shiori",
    "ENCRYPTION_KEY=",
    "OWNER_SETUP_TOKEN=",
    "DEFAULT_AI_PROVIDER=deepseek",
    "DEFAULT_AI_BASE_URL=https://api.deepseek.com",
    "DEFAULT_AI_MODEL=deepseek-v4-flash",
    "",
  ].join("\n");
}

const lines = source.split(/\r?\n/u);
upsert(lines, "DATABASE_URL", "file:./data/shiori");
upsert(lines, "ENCRYPTION_KEY", randomBytes(32).toString("base64"));
upsert(lines, "OWNER_SETUP_TOKEN", randomBytes(32).toString("base64url"));

await writeFile(target, `${lines.join("\n").replace(/\n+$/u, "")}\n`, { mode: 0o600 });
await chmod(target, 0o600);

process.stdout.write([
  "Local environment is ready in .env (file permissions: 600).",
  "Missing ENCRYPTION_KEY and OWNER_SETUP_TOKEN values were generated securely.",
  "Secrets were not printed. Copy them directly from .env into your hosting provider's encrypted environment-variable form when deploying.",
  "Next: npm run db:migrate && npm run dev, then open /setup.",
  "",
].join("\n"));

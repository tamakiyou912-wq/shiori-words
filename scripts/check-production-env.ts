function validEncryptionKey(value: string | undefined) {
  if (!value?.trim()) return false;
  const raw = value.trim();
  if (/^[a-f\d]{64}$/iu.test(raw)) return true;
  try {
    return Buffer.from(raw, "base64").length === 32;
  } catch {
    return false;
  }
}

if (process.env.VERCEL) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl || !/^(postgres|postgresql):\/\//u.test(databaseUrl)) {
    throw new Error("Set DATABASE_URL to a production PostgreSQL connection string before deploying.");
  }
  if (!validEncryptionKey(process.env.ENCRYPTION_KEY)) {
    throw new Error("Set ENCRYPTION_KEY to a 32-byte Base64 or 64-character hex value before deploying.");
  }
}

process.stdout.write("Production environment check passed.\n");

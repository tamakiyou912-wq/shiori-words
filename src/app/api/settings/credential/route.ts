import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { apiCredentials } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getCredentialSummary, normalizeProviderModel } from "@/lib/credentials";
import { jsonError, publicError } from "@/lib/http";
import { encryptSecret } from "@/lib/security";

const schema = z.object({
  provider: z.enum(["deepseek", "openai-compatible"]),
  baseUrl: z.url().max(500),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().max(1000).optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录。", 401);
  return Response.json({ credential: await getCredentialSummary(user.id), maskedKey: "••••••••••" });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录。", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("请检查 Provider、Base URL 和模型名。");

  const existing = await getDb().query.apiCredentials.findFirst({ where: eq(apiCredentials.userId, user.id) });
  if (!existing && !parsed.data.apiKey) return jsonError("请输入 API Key。");
  try {
    const model = normalizeProviderModel(parsed.data.provider, parsed.data.model);
    const encryptedKey = parsed.data.apiKey ? encryptSecret(parsed.data.apiKey) : existing!.encryptedKey;
    await getDb()
      .insert(apiCredentials)
      .values({ id: existing?.id ?? crypto.randomUUID(), userId: user.id, provider: parsed.data.provider, baseUrl: parsed.data.baseUrl.replace(/\/$/, ""), model, encryptedKey })
      .onConflictDoUpdate({
        target: apiCredentials.userId,
        set: { provider: parsed.data.provider, baseUrl: parsed.data.baseUrl.replace(/\/$/, ""), model, encryptedKey, updatedAt: new Date() },
      });
    return Response.json({ ok: true, credential: await getCredentialSummary(user.id), maskedKey: "••••••••••" });
  } catch (error) {
    const friendly = publicError(error);
    return jsonError(friendly.message, friendly.status, friendly.code);
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录。", 401);
  await getDb().delete(apiCredentials).where(eq(apiCredentials.userId, user.id));
  return Response.json({ ok: true });
}

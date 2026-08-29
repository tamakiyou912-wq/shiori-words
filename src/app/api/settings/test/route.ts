import { createProvider, AIProviderError } from "@/lib/ai/provider";
import { getCurrentUser } from "@/lib/auth";
import { getCredential } from "@/lib/credentials";
import { jsonError } from "@/lib/http";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录。", 401);
  const credential = await getCredential(user.id);
  if (!credential) return jsonError("请先保存 API 设置。", 400);
  try {
    await createProvider(credential).testConnection();
    return Response.json({ ok: true, message: "连接成功。" });
  } catch (error) {
    const message = error instanceof AIProviderError ? error.message : "连接失败，请检查设置。";
    return jsonError(message, 502);
  }
}

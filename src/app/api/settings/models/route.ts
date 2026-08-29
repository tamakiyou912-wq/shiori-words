import { getCurrentUser } from "@/lib/auth";
import { getCredential } from "@/lib/credentials";
import { createProvider, AIProviderError } from "@/lib/ai/provider";
import { jsonError } from "@/lib/http";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录。", 401);
  const credential = await getCredential(user.id);
  if (!credential) return jsonError("请先保存 API 设置。", 400);
  try {
    return Response.json({ models: await createProvider(credential).listModels() });
  } catch (error) {
    const message = error instanceof AIProviderError ? error.message : "无法获取模型列表。";
    return jsonError(message, 502);
  }
}

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { translationHistory } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录。", 401);
  const { id } = await context.params;
  await getDb().delete(translationHistory).where(and(eq(translationHistory.id, id), eq(translationHistory.userId, user.id)));
  return Response.json({ ok: true });
}

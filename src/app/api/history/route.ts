import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { translationHistory } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录。", 401);
  const items = await getDb().query.translationHistory.findMany({
    where: eq(translationHistory.userId, user.id),
    orderBy: [desc(translationHistory.createdAt)],
    limit: 100,
  });
  return Response.json({ items });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录。", 401);
  await getDb().delete(translationHistory).where(eq(translationHistory.userId, user.id));
  return Response.json({ ok: true });
}

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { guestCodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

const updateSchema = z.object({ enabled: z.boolean().optional(), name: z.string().trim().max(50).nullable().optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录。", 401);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("设置无效。");
  const { id } = await context.params;
  const [updated] = await getDb().update(guestCodes).set(parsed.data).where(and(eq(guestCodes.id, id), eq(guestCodes.ownerUserId, user.id))).returning();
  if (!updated) return jsonError("体验码不存在。", 404);
  return Response.json({ code: updated });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录。", 401);
  const { id } = await context.params;
  await getDb().delete(guestCodes).where(and(eq(guestCodes.id, id), eq(guestCodes.ownerUserId, user.id)));
  return Response.json({ ok: true });
}

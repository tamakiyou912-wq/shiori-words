import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { getCurrentUser, hashPassword, verifyPassword, validPassword } from "@/lib/auth";
import { jsonError } from "@/lib/http";

const schema = z.object({ currentPassword: z.string(), newPassword: z.string() });

export async function PUT(request: Request) {
  const current = await getCurrentUser();
  if (!current) return jsonError("请先登录。", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !validPassword(parsed.data.newPassword)) return jsonError("新密码需为 8–128 个字符。");
  const user = await getDb().query.users.findFirst({ where: eq(users.id, current.id) });
  if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) return jsonError("当前密码不正确。", 400);

  await getDb().update(users).set({ passwordHash: await hashPassword(parsed.data.newPassword), updatedAt: new Date() }).where(eq(users.id, current.id));
  await getDb().delete(sessions).where(and(eq(sessions.userId, current.id), ne(sessions.tokenHash, "")));
  return Response.json({ ok: true, reauthenticate: true });
}

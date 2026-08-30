import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { createSession, normalizeUsername, setSessionCookie, verifyPassword } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

const schema = z.object({ username: z.string(), password: z.string() });

export async function POST(request: Request) {
  try {
    await enforceRateLimit(`login:${clientIp(request)}`, 12, 15 * 60_000);
  } catch {
    return jsonError("登录尝试过于频繁，请稍后再试。", 429);
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("请输入用户名和密码。");
  const username = normalizeUsername(parsed.data.username);
  try {
    await enforceRateLimit(`login-account:${clientIp(request)}:${username}`, 8, 15 * 60_000);
  } catch {
    return jsonError("登录尝试过于频繁，请稍后再试。", 429);
  }
  const user = await getDb().query.users.findFirst({ where: eq(users.username, username) });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return jsonError("用户名或密码不正确。", 401);
  }
  if (user.status !== "ACTIVE") return jsonError("账号已停用，请联系站点 Owner。", 403);
  await getDb().update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
  const session = await createSession(user.id);
  await setSessionCookie(session.token, session.expiresAt);
  return Response.json({ ok: true, user: { id: user.id, username: user.username } });
}

import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { createSession, normalizeUsername, setSessionCookie, verifyPassword } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { clearRateLimit, clientIp, enforceRateLimit } from "@/lib/rate-limit";

const schema = z.object({ username: z.string(), password: z.string() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("请输入用户名和密码。");
  const username = normalizeUsername(parsed.data.username);
  const ip = clientIp(request);
  const invalidIpKey = `login-invalid:${ip}`;
  const invalidAccountKey = `login-invalid-account:${ip}:${username}`;
  const user = await getDb().query.users.findFirst({ where: eq(users.username, username) });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    try {
      await Promise.all([
        enforceRateLimit(invalidIpKey, 20, 15 * 60_000),
        enforceRateLimit(invalidAccountKey, 8, 15 * 60_000),
      ]);
    } catch {
      return jsonError("登录尝试过于频繁，请稍后再试。", 429);
    }
    return jsonError("用户名或密码不正确。", 401);
  }
  await Promise.all([
    clearRateLimit(invalidIpKey).catch(() => undefined),
    clearRateLimit(invalidAccountKey).catch(() => undefined),
  ]);
  if (user.status !== "ACTIVE") return jsonError("账号已停用，请联系站点 Owner。", 403);
  await getDb().update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
  const session = await createSession(user.id);
  await setSessionCookie(session.token, session.expiresAt);
  return Response.json({ ok: true, user: { id: user.id, username: user.username } });
}

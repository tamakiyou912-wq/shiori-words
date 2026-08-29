import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { createSession, hashPassword, normalizeUsername, setSessionCookie, validPassword, validUsername } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

const schema = z.object({ username: z.string(), password: z.string() });

export async function POST(request: Request) {
  try {
    await enforceRateLimit(`register:${clientIp(request)}`, 8, 15 * 60_000);
  } catch {
    return jsonError("注册尝试过于频繁，请稍后再试。", 429);
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("请输入用户名和密码。");

  const username = normalizeUsername(parsed.data.username);
  if (!validUsername(username)) return jsonError("用户名需为 3–32 个字，可使用文字、数字、下划线或短横线。");
  if (!validPassword(parsed.data.password)) return jsonError("密码需为 8–128 个字符。");

  const existing = await getDb().query.users.findFirst({ columns: { id: true }, where: eq(users.username, username) });
  if (existing) return jsonError("这个用户名已经被使用。", 409);

  const userId = crypto.randomUUID();
  await getDb().insert(users).values({ id: userId, username, passwordHash: await hashPassword(parsed.data.password) });
  const session = await createSession(userId);
  await setSessionCookie(session.token, session.expiresAt);
  return Response.json({ ok: true, user: { id: userId, username } }, { status: 201 });
}

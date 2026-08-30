import { z } from "zod";
import { createSession, setSessionCookie } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { normalizeRegistrationInvite, registerUser, siteErrorResponse } from "@/lib/site";

const schema = z.object({ username: z.string(), password: z.string(), inviteCode: z.string().max(64).optional() });

export async function POST(request: Request) {
  try {
    await enforceRateLimit(`register:${clientIp(request)}`, 8, 15 * 60_000);
  } catch {
    return jsonError("注册尝试过于频繁，请稍后再试。", 429);
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("请输入用户名和密码。");

  if (parsed.data.inviteCode) {
    try {
      await enforceRateLimit(`registration-invite:${clientIp(request)}:${normalizeRegistrationInvite(parsed.data.inviteCode)}`, 8, 30 * 60_000);
    } catch {
      return jsonError("邀请码尝试过于频繁，请稍后再试。", 429);
    }
  }

  try {
    const user = await registerUser(parsed.data);
    const session = await createSession(user.id);
    await setSessionCookie(session.token, session.expiresAt);
    return Response.json({ ok: true, user: { id: user.id, username: user.username } }, { status: 201 });
  } catch (error) {
    const response = siteErrorResponse(error);
    return jsonError(response.error, response.status, error instanceof Error ? error.message : undefined);
  }
}

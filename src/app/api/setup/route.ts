import { z } from "zod";
import { createSession, setSessionCookie } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { createInitialOwner, isValidSetupToken, siteErrorResponse } from "@/lib/site";

const schema = z.object({
  setupToken: z.string().min(1).max(512),
  username: z.string(),
  password: z.string(),
  confirmPassword: z.string(),
}).refine((value) => value.password === value.confirmPassword, {
  message: "两次输入的密码不一致。",
  path: ["confirmPassword"],
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message || "请检查初始化信息。");
  }

  try {
    if (!isValidSetupToken(parsed.data.setupToken)) {
      try {
        await enforceRateLimit(`owner-setup-invalid:${clientIp(request)}`, 6, 30 * 60_000);
      } catch {
        return jsonError("初始化尝试过于频繁，请稍后再试。", 429);
      }
      return jsonError("初始化令牌不正确。", 403);
    }

    const owner = await createInitialOwner(parsed.data);
    const session = await createSession(owner.id);
    await setSessionCookie(session.token, session.expiresAt);
    return Response.json({ ok: true, user: { id: owner.id, username: owner.username, role: "OWNER" } }, { status: 201 });
  } catch (error) {
    const response = siteErrorResponse(error);
    return jsonError(response.error, response.status, error instanceof Error ? error.message : undefined);
  }
}

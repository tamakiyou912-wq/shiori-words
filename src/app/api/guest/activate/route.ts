import { and, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { apiCredentials, guestCodes, guestSessions } from "@/db/schema";
import { clearGuestCookie, setGuestCookie } from "@/lib/principal";
import { jsonError } from "@/lib/http";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { hashToken, randomToken } from "@/lib/security";

const schema = z.object({ code: z.string().trim().min(6).max(32) });

export async function POST(request: Request) {
  try {
    await enforceRateLimit(`guest-activate:${clientIp(request)}`, 10, 15 * 60_000);
  } catch {
    return jsonError("尝试次数过多，请稍后再试。", 429);
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("请输入有效的体验码。");
  const normalized = parsed.data.code.toUpperCase().replace(/\s/g, "");
  const rows = await getDb()
    .select({ id: guestCodes.id, ownerUserId: guestCodes.ownerUserId, maxUses: guestCodes.maxUses, usedUses: guestCodes.usedUses })
    .from(guestCodes)
    .innerJoin(apiCredentials, eq(apiCredentials.userId, guestCodes.ownerUserId))
    .where(and(eq(guestCodes.code, normalized), eq(guestCodes.enabled, true), gt(guestCodes.maxUses, guestCodes.usedUses), or(isNull(guestCodes.expiresAt), gt(guestCodes.expiresAt, new Date()))))
    .limit(1);
  const code = rows[0];
  if (!code) return jsonError("体验码无效、已禁用或次数已用完。", 404);

  const token = randomToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await getDb().insert(guestSessions).values({ id: crypto.randomUUID(), codeId: code.id, tokenHash: hashToken(token), expiresAt });
  await setGuestCookie(token, expiresAt);
  return Response.json({ ok: true, code: normalized, remainingUses: code.maxUses - code.usedUses });
}

export async function DELETE() {
  await clearGuestCookie();
  return Response.json({ ok: true });
}

import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { guestCodes, guestSessions } from "@/db/schema";
import { getCurrentUser } from "./auth";
import { hashToken } from "./security";

export const guestCookieName = () => process.env.GUEST_COOKIE_NAME || "shiori_guest";

export type Principal =
  | { kind: "user"; userId: string; credentialOwnerId: string }
  | { kind: "guest"; guestSessionId: string; guestCodeId: string; credentialOwnerId: string };

export async function getPrincipal(): Promise<Principal | null> {
  const user = await getCurrentUser();
  if (user) return { kind: "user", userId: user.id, credentialOwnerId: user.id };

  const token = (await cookies()).get(guestCookieName())?.value;
  if (!token) return null;

  try {
    const rows = await getDb()
      .select({ guestSessionId: guestSessions.id, guestCodeId: guestCodes.id, ownerUserId: guestCodes.ownerUserId })
      .from(guestSessions)
      .innerJoin(guestCodes, eq(guestSessions.codeId, guestCodes.id))
      .where(and(eq(guestSessions.tokenHash, hashToken(token)), gt(guestSessions.expiresAt, new Date()), eq(guestCodes.enabled, true)))
      .limit(1);
    const row = rows[0];
    return row
      ? { kind: "guest", guestSessionId: row.guestSessionId, guestCodeId: row.guestCodeId, credentialOwnerId: row.ownerUserId }
      : null;
  } catch {
    console.error("Database unavailable while restoring the guest session.");
    return null;
  }
}

export async function setGuestCookie(token: string, expiresAt: Date) {
  (await cookies()).set(guestCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearGuestCookie() {
  (await cookies()).set(guestCookieName(), "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

import { compare, hash } from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { hashToken, randomToken } from "./security";

const SESSION_DAYS = 30;

export const sessionCookieName = () => process.env.SESSION_COOKIE_NAME || "shiori_session";

export function normalizeUsername(username: string) {
  return username.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

export function validUsername(username: string) {
  return /^[\p{L}\p{N}_-]{3,32}$/u.test(username);
}

export function validPassword(password: string) {
  return password.length >= 8 && password.length <= 128;
}

export async function hashPassword(password: string) {
  return hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await getDb().insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(sessionCookieName(), "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

export async function getCurrentUser() {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;

  try {
    const rows = await getDb()
      .select({ id: users.id, username: users.username, role: users.role, status: users.status, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), eq(users.status, "ACTIVE")))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    console.error("Database unavailable while restoring the user session.");
    return null;
  }
}

export async function getCurrentOwner() {
  const user = await getCurrentUser();
  return user?.role === "OWNER" ? user : null;
}

export async function revokeCurrentSession() {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (token) await getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  await clearSessionCookie();
}

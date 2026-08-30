import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { apiCredentials, guestCodes, registrationInvites, sessions, siteSettings, translationHistory, users } from "@/db/schema";
import type { RegistrationMode, UserStatus } from "./site";

const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `SHIORI-JOIN-${[...bytes].map((byte) => inviteAlphabet[byte % inviteAlphabet.length]).join("")}`;
}

export async function getOwnerSnapshot() {
  const db = getDb();
  const [settingsRows, userRows, inviteRows, credentialRows, guestCounts, historyCounts] = await Promise.all([
    db.select().from(siteSettings).where(eq(siteSettings.id, "default")).limit(1),
    db.select({
      id: users.id,
      username: users.username,
      status: users.status,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    }).from(users).where(eq(users.role, "USER")).orderBy(desc(users.createdAt)),
    db.select().from(registrationInvites).orderBy(desc(registrationInvites.createdAt)),
    db.select({ userId: apiCredentials.userId }).from(apiCredentials),
    db.select({ userId: guestCodes.ownerUserId, value: count() }).from(guestCodes).groupBy(guestCodes.ownerUserId),
    db.select({ userId: translationHistory.userId, value: count() }).from(translationHistory).groupBy(translationHistory.userId),
  ]);
  const settings = settingsRows[0];
  if (!settings) throw new Error("SITE_SETTINGS_UNAVAILABLE");
  const credentialUserIds = new Set(credentialRows.map((row) => row.userId));
  const guestCodeCounts = new Map(guestCounts.map((row) => [row.userId, Number(row.value)]));
  const queryCounts = new Map(historyCounts.map((row) => [row.userId, Number(row.value)]));

  return {
    settings: {
      registrationMode: settings.registrationMode as RegistrationMode,
      maxUsers: settings.maxUsers,
      siteName: settings.siteName,
      allowGuestCodes: settings.allowGuestCodes,
    },
    users: userRows.map((user) => ({
      ...user,
      status: user.status as UserStatus,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      apiConfigured: credentialUserIds.has(user.id),
      guestCodeCount: guestCodeCounts.get(user.id) ?? 0,
      historyCount: queryCounts.get(user.id) ?? 0,
    })),
    invites: inviteRows.map((invite) => ({
      ...invite,
      createdAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    })),
  };
}

export async function updateSiteSettings(input: { registrationMode?: RegistrationMode; maxUsers?: number; siteName?: string; allowGuestCodes?: boolean }) {
  const [updated] = await getDb().update(siteSettings).set({ ...input, updatedAt: new Date() }).where(eq(siteSettings.id, "default")).returning();
  if (!updated) throw new Error("SITE_SETTINGS_UNAVAILABLE");
  return updated;
}

export async function createRegistrationInvite(ownerId: string, input: { name?: string; maxUses: number; expiresAt?: Date | null }) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [created] = await getDb().insert(registrationInvites).values({
        id: crypto.randomUUID(),
        code: generateInviteCode(),
        createdByUserId: ownerId,
        name: input.name || null,
        maxUses: input.maxUses,
        expiresAt: input.expiresAt ?? null,
      }).returning();
      if (created) return created;
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
  throw new Error("INVITE_CREATE_FAILED");
}

export async function updateRegistrationInvite(ownerId: string, inviteId: string, input: { enabled?: boolean; name?: string | null }) {
  const [updated] = await getDb().update(registrationInvites).set(input).where(and(eq(registrationInvites.id, inviteId), eq(registrationInvites.createdByUserId, ownerId))).returning();
  return updated ?? null;
}

export async function deleteRegistrationInvite(ownerId: string, inviteId: string) {
  const deleted = await getDb().delete(registrationInvites).where(and(eq(registrationInvites.id, inviteId), eq(registrationInvites.createdByUserId, ownerId))).returning({ id: registrationInvites.id });
  return deleted.length > 0;
}

export async function setUserStatus(userId: string, status: UserStatus) {
  return getDb().transaction(async (tx) => {
    const [updated] = await tx.update(users).set({ status, updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.role, "USER"))).returning({ id: users.id, status: users.status });
    if (!updated) return null;
    if (status === "SUSPENDED") await tx.delete(sessions).where(eq(sessions.userId, userId));
    return updated;
  });
}

export async function revokeUserSessions(userId: string) {
  const [target] = await getDb().select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.role, "USER"))).limit(1);
  if (!target) return false;
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
  return true;
}

export async function deleteUser(userId: string, confirmationUsername: string) {
  return getDb().transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id, username: users.username }).from(users).where(and(eq(users.id, userId), eq(users.role, "USER"))).limit(1);
    if (!target || target.username !== confirmationUsername) return false;
    await tx.delete(users).where(and(eq(users.id, userId), eq(users.role, "USER")));
    return true;
  });
}

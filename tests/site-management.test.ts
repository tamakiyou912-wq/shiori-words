import { beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { apiCredentials, guestCodes, registrationInvites, sessions, siteSettings, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { createRegistrationInvite, deleteUser, revokeUserSessions, setUserStatus, updateSiteSettings } from "@/lib/owner";
import { createInitialOwner, registerUser, SiteError } from "@/lib/site";

const setupToken = "owner-setup-token-for-tests-only-0123456789abcdef";
let ownerId = "";

function expectSiteError(code: string) {
  return (error: unknown) => error instanceof SiteError && error.message === code;
}

describe.sequential("private instance owner and registration", () => {
  beforeAll(() => {
    process.env.OWNER_SETUP_TOKEN = setupToken;
  });

  it("rejects an incorrect setup token", async () => {
    await expect(createInitialOwner({ setupToken: "wrong-token", username: "owner-test", password: "owner-password-123" })).rejects.toSatisfy(expectSiteError("OWNER_SETUP_TOKEN_INVALID"));
  });

  it("creates exactly one Owner and never counts it as a normal user", async () => {
    const beforeUsers = Number((await getDb().select({ value: count() }).from(users).where(eq(users.role, "USER")))[0]?.value ?? 0);
    const owner = await createInitialOwner({ setupToken, username: "owner-test", password: "owner-password-123" });
    ownerId = owner.id;
    expect(owner.role).toBe("OWNER");
    await expect(createInitialOwner({ setupToken, username: "owner-again", password: "owner-password-456" })).rejects.toSatisfy(expectSiteError("OWNER_ALREADY_EXISTS"));
    const afterUsers = Number((await getDb().select({ value: count() }).from(users).where(eq(users.role, "USER")))[0]?.value ?? 0);
    expect(afterUsers).toBe(beforeUsers);
    await expect(getDb().insert(users).values({ id: crypto.randomUUID(), username: "forged-owner", passwordHash: "hash", role: "OWNER" })).rejects.toBeDefined();
  });

  it("enforces closed registration and an atomic normal-user limit", async () => {
    await updateSiteSettings({ registrationMode: "closed", maxUsers: 10000 });
    await expect(registerUser({ username: "closed-user", password: "password-123" })).rejects.toSatisfy(expectSiteError("REGISTRATION_CLOSED"));

    const currentUsers = Number((await getDb().select({ value: count() }).from(users).where(eq(users.role, "USER")))[0]?.value ?? 0);
    await updateSiteSettings({ registrationMode: "open", maxUsers: currentUsers + 2 });
    const registrations = await Promise.allSettled([
      registerUser({ username: "limit-user-a", password: "password-123" }),
      registerUser({ username: "limit-user-b", password: "password-123" }),
      registerUser({ username: "limit-user-c", password: "password-123" }),
      registerUser({ username: "limit-user-d", password: "password-123" }),
    ]);
    expect(registrations.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const finalUsers = Number((await getDb().select({ value: count() }).from(users).where(eq(users.role, "USER")))[0]?.value ?? 0);
    expect(finalUsers).toBe(currentUsers + 2);
  });

  it("consumes registration invite uses atomically", async () => {
    const currentUsers = Number((await getDb().select({ value: count() }).from(users).where(eq(users.role, "USER")))[0]?.value ?? 0);
    await updateSiteSettings({ registrationMode: "invite", maxUsers: currentUsers + 10 });
    const invite = await createRegistrationInvite(ownerId, { name: "test", maxUses: 2 });
    const registrations = await Promise.allSettled([
      registerUser({ username: "invite-user-a", password: "password-123", inviteCode: invite.code }),
      registerUser({ username: "invite-user-b", password: "password-123", inviteCode: invite.code }),
      registerUser({ username: "invite-user-c", password: "password-123", inviteCode: invite.code }),
    ]);
    expect(registrations.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const stored = await getDb().query.registrationInvites.findFirst({ where: eq(registrationInvites.id, invite.id) });
    expect(stored?.usedUses).toBe(2);
  });

  it("suspends users, revokes sessions, cascades private data, and never mutates Owner", async () => {
    const currentUsers = Number((await getDb().select({ value: count() }).from(users).where(eq(users.role, "USER")))[0]?.value ?? 0);
    await updateSiteSettings({ registrationMode: "open", maxUsers: currentUsers + 5 });
    const target = await registerUser({ username: "managed-user", password: "password-123" });
    await createSession(target.id);
    await getDb().insert(apiCredentials).values({ id: crypto.randomUUID(), userId: target.id, provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "test", encryptedKey: "encrypted-test" });
    await getDb().insert(guestCodes).values({ id: crypto.randomUUID(), ownerUserId: target.id, code: `SHIORI-${crypto.randomUUID().slice(0, 6).toUpperCase()}`, maxUses: 5 });

    expect(await setUserStatus(target.id, "SUSPENDED")).toMatchObject({ status: "SUSPENDED" });
    expect(await getDb().query.sessions.findFirst({ where: eq(sessions.userId, target.id) })).toBeUndefined();
    expect(await setUserStatus(ownerId, "SUSPENDED")).toBeNull();
    expect(await deleteUser(ownerId, "owner-test")).toBe(false);

    await setUserStatus(target.id, "ACTIVE");
    await createSession(target.id);
    expect(await revokeUserSessions(target.id)).toBe(true);
    expect(await getDb().query.sessions.findFirst({ where: eq(sessions.userId, target.id) })).toBeUndefined();
    expect(await deleteUser(target.id, "wrong-name")).toBe(false);
    expect(await deleteUser(target.id, "managed-user")).toBe(true);
    expect(await getDb().query.apiCredentials.findFirst({ where: eq(apiCredentials.userId, target.id) })).toBeUndefined();
    expect(await getDb().query.guestCodes.findFirst({ where: eq(guestCodes.ownerUserId, target.id) })).toBeUndefined();
    expect(await getDb().query.users.findFirst({ where: eq(users.id, ownerId) })).toMatchObject({ role: "OWNER", status: "ACTIVE" });
  });

  it("keeps secure private-instance defaults", async () => {
    await getDb().update(siteSettings).set({ registrationMode: "invite", maxUsers: 20, allowGuestCodes: true }).where(eq(siteSettings.id, "default"));
    const settings = await getDb().query.siteSettings.findFirst({ where: eq(siteSettings.id, "default") });
    expect(settings).toMatchObject({ registrationMode: "invite", maxUsers: 20, allowGuestCodes: true });
  });
});

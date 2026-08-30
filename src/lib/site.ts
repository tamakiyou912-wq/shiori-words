import { and, count, eq, gt, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { registrationInvites, siteSettings, users } from "@/db/schema";
import { hashPassword, normalizeUsername, validPassword, validUsername } from "./auth";
import { safeEqual } from "./security";

export type RegistrationMode = "open" | "invite" | "closed";
export type UserRole = "OWNER" | "USER";
export type UserStatus = "ACTIVE" | "SUSPENDED";

export class SiteError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "SiteError";
  }
}

export function normalizeRegistrationInvite(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export async function ensureSiteSettings() {
  const db = getDb();
  await db.insert(siteSettings).values({ id: "default" }).onConflictDoNothing();
  const [settings] = await db.select().from(siteSettings).where(eq(siteSettings.id, "default")).limit(1);
  if (!settings) throw new SiteError("SITE_SETTINGS_UNAVAILABLE");
  return { ...settings, registrationMode: settings.registrationMode as RegistrationMode };
}

export async function hasOwner() {
  const [row] = await getDb().select({ id: users.id }).from(users).where(eq(users.role, "OWNER")).limit(1);
  return Boolean(row);
}

export async function getPublicSiteState() {
  const [settings, ownerReady, userTotalRows] = await Promise.all([
    ensureSiteSettings(),
    hasOwner(),
    getDb().select({ value: count() }).from(users).where(eq(users.role, "USER")),
  ]);
  const userCount = Number(userTotalRows[0]?.value ?? 0);
  return {
    ownerReady,
    registrationMode: settings.registrationMode,
    maxUsers: settings.maxUsers,
    userCount,
    atCapacity: userCount >= settings.maxUsers,
    allowGuestCodes: settings.allowGuestCodes,
  };
}

function configuredSetupToken() {
  const token = process.env.OWNER_SETUP_TOKEN?.trim();
  if (!token || token.length < 32) throw new SiteError("OWNER_SETUP_TOKEN_MISSING");
  return token;
}

export async function createInitialOwner(input: { setupToken: string; username: string; password: string }) {
  const username = normalizeUsername(input.username);
  if (!validUsername(username)) throw new SiteError("USERNAME_INVALID");
  if (!validPassword(input.password)) throw new SiteError("PASSWORD_INVALID");
  if (!safeEqual(input.setupToken, configuredSetupToken())) throw new SiteError("OWNER_SETUP_TOKEN_INVALID");

  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  return getDb().transaction(async (tx) => {
    await tx.insert(siteSettings).values({ id: "default" }).onConflictDoNothing();
    await tx.execute(sql`select id from site_settings where id = 'default' for update`);
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.role, "OWNER")).limit(1);
    if (existing) throw new SiteError("OWNER_ALREADY_EXISTS");

    const [created] = await tx.insert(users).values({
      id: crypto.randomUUID(),
      username,
      passwordHash,
      role: "OWNER",
      status: "ACTIVE",
      lastLoginAt: now,
    }).returning({ id: users.id, username: users.username, role: users.role });
    if (!created) throw new SiteError("OWNER_CREATE_FAILED");
    return created;
  });
}

export async function registerUser(input: { username: string; password: string; inviteCode?: string }) {
  const username = normalizeUsername(input.username);
  if (!validUsername(username)) throw new SiteError("USERNAME_INVALID");
  if (!validPassword(input.password)) throw new SiteError("PASSWORD_INVALID");
  const passwordHash = await hashPassword(input.password);
  const inviteCode = input.inviteCode ? normalizeRegistrationInvite(input.inviteCode) : "";
  const now = new Date();

  return getDb().transaction(async (tx) => {
    await tx.insert(siteSettings).values({ id: "default" }).onConflictDoNothing();
    await tx.execute(sql`select id from site_settings where id = 'default' for update`);
    const [settings] = await tx.select().from(siteSettings).where(eq(siteSettings.id, "default")).limit(1);
    if (!settings) throw new SiteError("SITE_SETTINGS_UNAVAILABLE");

    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.role, "OWNER")).limit(1);
    if (!owner) throw new SiteError("SITE_NOT_INITIALIZED");
    if (settings.registrationMode === "closed") throw new SiteError("REGISTRATION_CLOSED");

    const [total] = await tx.select({ value: count() }).from(users).where(eq(users.role, "USER"));
    if (Number(total?.value ?? 0) >= settings.maxUsers) throw new SiteError("USER_LIMIT_REACHED");

    let inviteId: string | null = null;
    if (settings.registrationMode === "invite") {
      if (!inviteCode) throw new SiteError("REGISTRATION_INVITE_REQUIRED");
      await tx.execute(sql`select id from registration_invites where code = ${inviteCode} for update`);
      const [invite] = await tx.select({ id: registrationInvites.id })
        .from(registrationInvites)
        .where(and(
          eq(registrationInvites.code, inviteCode),
          eq(registrationInvites.enabled, true),
          gt(registrationInvites.maxUses, registrationInvites.usedUses),
          or(isNull(registrationInvites.expiresAt), gt(registrationInvites.expiresAt, now)),
        ))
        .limit(1);
      if (!invite) throw new SiteError("REGISTRATION_INVITE_INVALID");
      inviteId = invite.id;
    }

    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (existing) throw new SiteError("USERNAME_TAKEN");

    const [created] = await tx.insert(users).values({
      id: crypto.randomUUID(),
      username,
      passwordHash,
      role: "USER",
      status: "ACTIVE",
      lastLoginAt: now,
    }).returning({ id: users.id, username: users.username, role: users.role });
    if (!created) throw new SiteError("USER_CREATE_FAILED");

    if (inviteId) {
      const [used] = await tx.update(registrationInvites)
        .set({ usedUses: sql<number>`${registrationInvites.usedUses} + 1` })
        .where(and(eq(registrationInvites.id, inviteId), gt(registrationInvites.maxUses, registrationInvites.usedUses)))
        .returning({ id: registrationInvites.id });
      if (!used) throw new SiteError("REGISTRATION_INVITE_INVALID");
    }
    return created;
  });
}

export function siteErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const errors: Record<string, { error: string; status: number }> = {
    OWNER_SETUP_TOKEN_MISSING: { error: "服务器尚未配置有效的 OWNER_SETUP_TOKEN。", status: 503 },
    OWNER_SETUP_TOKEN_INVALID: { error: "初始化令牌不正确。", status: 403 },
    OWNER_ALREADY_EXISTS: { error: "站点已完成初始化。", status: 409 },
    SITE_NOT_INITIALIZED: { error: "站点尚未完成 Owner 初始化。", status: 503 },
    REGISTRATION_CLOSED: { error: "当前实例已关闭注册。", status: 403 },
    REGISTRATION_INVITE_REQUIRED: { error: "请输入注册邀请码。", status: 400 },
    REGISTRATION_INVITE_INVALID: { error: "注册邀请码无效、已过期或次数已用完。", status: 403 },
    USER_LIMIT_REACHED: { error: "当前实例已达到用户上限。", status: 403 },
    USERNAME_TAKEN: { error: "这个用户名已经被使用。", status: 409 },
    USERNAME_INVALID: { error: "用户名需为 3–32 个字，可使用文字、数字、下划线或短横线。", status: 400 },
    PASSWORD_INVALID: { error: "密码需为 8–128 个字符。", status: 400 },
  };
  return errors[code] ?? { error: "暂时无法完成操作，请重试。", status: 500 };
}

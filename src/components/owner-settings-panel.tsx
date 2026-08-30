"use client";

import { Check, Clipboard, LockKey, Plus, Power, SignOut, Trash, UserGear } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type OwnerSnapshot = {
  settings: {
    registrationMode: "open" | "invite" | "closed";
    maxUsers: number;
    siteName: string;
    allowGuestCodes: boolean;
  };
  users: Array<{
    id: string;
    username: string;
    status: "ACTIVE" | "SUSPENDED";
    createdAt: string;
    lastLoginAt: string | null;
    apiConfigured: boolean;
    guestCodeCount: number;
    historyCount: number;
  }>;
  invites: Array<{
    id: string;
    code: string;
    name: string | null;
    maxUses: number;
    usedUses: number;
    enabled: boolean;
    expiresAt: string | null;
    createdAt: string;
  }>;
};

function shortDate(value: string | null) {
  if (!value) return "从未";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function OwnerSettingsPanel({ initial }: { initial: OwnerSnapshot }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial.settings);
  const [users, setUsers] = useState(initial.users);
  const [invites, setInvites] = useState(initial.invites);
  const [inviteName, setInviteName] = useState("");
  const [inviteMaxUses, setInviteMaxUses] = useState(5);
  const [inviteExpiry, setInviteExpiry] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "操作失败，请重试。");
    return payload;
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    setBusy("settings"); setNotice(null);
    try {
      await request("/api/owner/site", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      setNotice({ kind: "success", text: "站点设置已保存。" });
      router.refresh();
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "保存失败。" }); }
    finally { setBusy(""); }
  }

  async function createInvite(event: React.FormEvent) {
    event.preventDefault();
    setBusy("invite"); setNotice(null);
    try {
      const payload = await request("/api/owner/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: inviteName || undefined, maxUses: inviteMaxUses, expiresAt: inviteExpiry ? new Date(inviteExpiry).toISOString() : null }),
      });
      setInvites((current) => [payload.invite, ...current]);
      setInviteName(""); setInviteMaxUses(5); setInviteExpiry("");
      setNotice({ kind: "success", text: "注册邀请码已创建。" });
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "创建失败。" }); }
    finally { setBusy(""); }
  }

  async function toggleInvite(invite: OwnerSnapshot["invites"][number]) {
    const payload = await request(`/api/owner/invites/${invite.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !invite.enabled }) });
    setInvites((current) => current.map((item) => item.id === invite.id ? payload.invite : item));
  }

  async function removeInvite(invite: OwnerSnapshot["invites"][number]) {
    if (!window.confirm(`删除注册邀请码 ${invite.code}？`)) return;
    await request(`/api/owner/invites/${invite.id}`, { method: "DELETE" });
    setInvites((current) => current.filter((item) => item.id !== invite.id));
  }

  async function userAction(user: OwnerSnapshot["users"][number], action: "suspend" | "restore" | "revokeSessions") {
    const label = action === "suspend" ? "停用这个账号并注销所有会话" : action === "restore" ? "恢复这个账号" : "强制注销这个账号的全部会话";
    if (!window.confirm(`${label}：${user.username}？`)) return;
    setBusy(`user-${user.id}`); setNotice(null);
    try {
      await request(`/api/owner/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (action !== "revokeSessions") setUsers((current) => current.map((item) => item.id === user.id ? { ...item, status: action === "suspend" ? "SUSPENDED" : "ACTIVE" } : item));
      setNotice({ kind: "success", text: action === "revokeSessions" ? "用户会话已全部注销。" : "用户状态已更新。" });
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "操作失败。" }); }
    finally { setBusy(""); }
  }

  async function removeUser(user: OwnerSnapshot["users"][number]) {
    const confirmation = window.prompt(`此操作会永久删除 ${user.username} 的账号、API 凭据、历史、会话与体验码。\n请输入用户名 ${user.username} 进行二次确认：`);
    if (confirmation !== user.username) return;
    setBusy(`user-${user.id}`); setNotice(null);
    try {
      await request(`/api/owner/users/${user.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationUsername: confirmation }) });
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setNotice({ kind: "success", text: "普通用户已删除。" });
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "删除失败。" }); }
    finally { setBusy(""); }
  }

  return (
    <section className="settings-section owner-section" aria-labelledby="owner-title">
      <div className="settings-section-heading"><div><p className="eyebrow">Owner only</p><h2 id="owner-title">站点管理</h2><p>控制私人实例的注册、邀请码和普通用户。Owner 永远不计入人数上限。</p></div><UserGear aria-hidden="true" /></div>
      {notice && <p className={notice.kind === "success" ? "status-banner success owner-notice" : "status-banner error owner-notice"} role="status">{notice.kind === "success" && <Check aria-hidden="true" />}{notice.text}</p>}

      <form className="owner-settings-form" onSubmit={saveSettings}>
        <label>注册模式
          <select value={settings.registrationMode} onChange={(event) => setSettings((current) => ({ ...current, registrationMode: event.target.value as OwnerSnapshot["settings"]["registrationMode"] }))}>
            <option value="invite">邀请码注册</option><option value="open">开放注册</option><option value="closed">关闭注册</option>
          </select>
        </label>
        <label>普通用户上限
          <input type="number" min={1} max={10000} value={settings.maxUsers} onChange={(event) => setSettings((current) => ({ ...current, maxUsers: Number(event.target.value) }))} />
        </label>
        <label className="owner-toggle"><input type="checkbox" checked={settings.allowGuestCodes} onChange={(event) => setSettings((current) => ({ ...current, allowGuestCodes: event.target.checked }))} />允许用户创建和使用体验码</label>
        <button className="button primary" type="submit" disabled={Boolean(busy)}>{busy === "settings" ? "保存中" : "保存站点设置"}</button>
      </form>

      <div className="owner-subsection">
        <div className="owner-subheading"><div><h3>注册邀请码</h3><p>只用于创建正式账号，与体验码完全分开。</p></div><LockKey aria-hidden="true" /></div>
        <form className="owner-invite-form" onSubmit={createInvite}>
          <label>名称（可选）<input value={inviteName} onChange={(event) => setInviteName(event.target.value)} maxLength={50} placeholder="朋友邀请码" /></label>
          <label>允许注册人数<input type="number" min={1} max={10000} value={inviteMaxUses} onChange={(event) => setInviteMaxUses(Number(event.target.value))} /></label>
          <label>过期时间（可选）<input type="datetime-local" value={inviteExpiry} onChange={(event) => setInviteExpiry(event.target.value)} /></label>
          <button className="button secondary" type="submit" disabled={Boolean(busy)}><Plus aria-hidden="true" />{busy === "invite" ? "创建中" : "创建邀请码"}</button>
        </form>
        <div className="code-list">
          {invites.length === 0 && <p className="empty-note">还没有注册邀请码。</p>}
          {invites.map((invite) => <div className="code-row" key={invite.id}><div><strong>{invite.name || invite.code}</strong>{invite.name && <code>{invite.code}</code>}<span>{invite.usedUses} / {invite.maxUses} 个账号 · {invite.enabled ? "启用" : "已禁用"}{invite.expiresAt ? ` · ${shortDate(invite.expiresAt)} 过期` : ""}</span></div><div className="row-actions"><button type="button" aria-label="复制注册邀请码" onClick={() => navigator.clipboard.writeText(invite.code)}><Clipboard aria-hidden="true" /></button><button type="button" aria-label={invite.enabled ? "禁用注册邀请码" : "启用注册邀请码"} onClick={() => toggleInvite(invite)}><Power aria-hidden="true" /></button><button type="button" aria-label="删除注册邀请码" onClick={() => removeInvite(invite)}><Trash aria-hidden="true" /></button></div></div>)}
        </div>
      </div>

      <div className="owner-subsection">
        <div className="owner-subheading"><div><h3>普通用户</h3><p>{users.length} / {settings.maxUsers}；不显示密码、密钥内容或翻译历史。</p></div><UserGear aria-hidden="true" /></div>
        <div className="owner-user-list">
          {users.length === 0 && <p className="empty-note">还没有普通用户。</p>}
          {users.map((user) => <article className="owner-user-row" key={user.id}>
            <div className="owner-user-main"><strong>{user.username}</strong><span>{user.status === "ACTIVE" ? "正常" : "已停用"} · API {user.apiConfigured ? "已配置" : "未配置"}</span><small>注册：{shortDate(user.createdAt)} · 最近登录：{shortDate(user.lastLoginAt)} · 查询 {user.historyCount} · 体验码 {user.guestCodeCount}</small></div>
            <div className="owner-user-actions">
              <button className="button ghost" type="button" disabled={Boolean(busy)} onClick={() => userAction(user, user.status === "ACTIVE" ? "suspend" : "restore")}><Power aria-hidden="true" />{user.status === "ACTIVE" ? "停用" : "恢复"}</button>
              <button className="button ghost" type="button" disabled={Boolean(busy)} onClick={() => userAction(user, "revokeSessions")}><SignOut aria-hidden="true" />注销会话</button>
              <button className="button danger" type="button" disabled={Boolean(busy)} onClick={() => removeUser(user)}><Trash aria-hidden="true" />删除</button>
            </div>
          </article>)}
        </div>
      </div>
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Clipboard, Key, Plus, Power, SignOut, Trash } from "@phosphor-icons/react";

type Credential = { provider: string; baseUrl: string; model: string; hasKey: true } | null;
type GuestCode = { id: string; code: string; name: string | null; maxUses: number; usedUses: number; enabled: boolean; expiresAt: string | null; createdAt: string };

export function SettingsClient({ initialCredential, initialCodes, username, defaultConfig }: { initialCredential: Credential; initialCodes: GuestCode[]; username: string; defaultConfig: { provider: string; baseUrl: string; model: string } }) {
  const router = useRouter();
  const [provider, setProvider] = useState(initialCredential?.provider || defaultConfig.provider);
  const [baseUrl, setBaseUrl] = useState(initialCredential?.baseUrl || defaultConfig.baseUrl);
  const [model, setModel] = useState(initialCredential?.model || defaultConfig.model);
  const [apiKey, setApiKey] = useState("");
  const [codes, setCodes] = useState(initialCodes);
  const [codeName, setCodeName] = useState("");
  const [maxUses, setMaxUses] = useState(20);
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "操作失败，请重试。");
    return payload;
  }

  async function saveCredential(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save"); setStatus(null);
    try {
      await request("/api/settings/credential", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, baseUrl, model, apiKey: apiKey || undefined }) });
      setApiKey(""); setStatus({ kind: "success", text: "API 设置已安全保存。" }); router.refresh();
    } catch (error) { setStatus({ kind: "error", text: error instanceof Error ? error.message : "保存失败。" }); }
    finally { setBusy(""); }
  }

  async function testConnection() {
    setBusy("test"); setStatus(null);
    try { const payload = await request("/api/settings/test", { method: "POST" }); setStatus({ kind: "success", text: payload.message }); }
    catch (error) { setStatus({ kind: "error", text: error instanceof Error ? error.message : "连接失败。" }); }
    finally { setBusy(""); }
  }

  async function loadModels() {
    setBusy("models"); setStatus(null);
    try { const payload = await request("/api/settings/models"); setModels(payload.models); setStatus({ kind: "success", text: `找到 ${payload.models.length} 个模型。` }); }
    catch (error) { setStatus({ kind: "error", text: error instanceof Error ? error.message : "无法获取模型。" }); }
    finally { setBusy(""); }
  }

  async function deleteCredential() {
    if (!window.confirm("删除已经保存的 API Key？体验码也将无法使用。")) return;
    await request("/api/settings/credential", { method: "DELETE" });
    setApiKey(""); setStatus({ kind: "success", text: "API Key 已删除。" }); router.refresh();
  }

  async function createGuestCode(event: React.FormEvent) {
    event.preventDefault(); setBusy("code"); setStatus(null);
    try {
      const payload = await request("/api/guest-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: codeName || undefined, maxUses }) });
      setCodes((current) => [payload.code, ...current]); setCodeName(""); setMaxUses(20);
    } catch (error) { setStatus({ kind: "error", text: error instanceof Error ? error.message : "创建失败。" }); }
    finally { setBusy(""); }
  }

  async function toggleCode(code: GuestCode) {
    const payload = await request(`/api/guest-codes/${code.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !code.enabled }) });
    setCodes((current) => current.map((item) => item.id === code.id ? payload.code : item));
  }

  async function removeCode(code: GuestCode) {
    if (!window.confirm(`删除体验码 ${code.code}？`)) return;
    await request(`/api/guest-codes/${code.id}`, { method: "DELETE" });
    setCodes((current) => current.filter((item) => item.id !== code.id));
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault(); setBusy("password"); setStatus(null);
    try {
      await request("/api/auth/password", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      setStatus({ kind: "success", text: "密码已修改，请重新登录。" });
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login"); router.refresh();
    } catch (error) { setStatus({ kind: "error", text: error instanceof Error ? error.message : "修改失败。" }); }
    finally { setBusy(""); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh();
  }

  return (
    <main className="page-content settings-page">
      <header className="page-heading"><p className="eyebrow">{username}</p><h1>设置</h1><p>API Key 只在服务器端加密保存，已保存的完整 Key 永远不会返回浏览器。</p></header>

      {status && <p className={status.kind === "success" ? "status-banner success" : "status-banner error"} role="status">{status.kind === "success" ? <Check aria-hidden="true" /> : null}{status.text}</p>}

      <section className="settings-section" aria-labelledby="api-title">
        <div className="settings-section-heading"><div><h2 id="api-title">AI Provider</h2><p>正式使用时调用你自己的 API。</p></div><Key aria-hidden="true" /></div>
        <form className="settings-form" onSubmit={saveCredential}>
          <label>API Provider<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI-compatible</option></select></label>
          <label>API Key <span>DeepSeek 密钥通常以 sk- 开头</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={initialCredential ? "••••••••••（留空则不替换）" : "从 Provider 控制台复制完整 API Key"} autoComplete="new-password" /></label>
          <label className="wide-field">API Base URL <span>高级选项</span><input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required /></label>
          <label className="wide-field">模型<input list="provider-models" value={model} onChange={(event) => setModel(event.target.value)} required /><datalist id="provider-models">{models.map((item) => <option value={item} key={item} />)}</datalist></label>
          <div className="settings-actions"><button className="button primary" type="submit" disabled={Boolean(busy)}>{busy === "save" ? "保存中" : "保存设置"}</button><button className="button secondary" type="button" onClick={testConnection} disabled={!initialCredential || Boolean(busy)}>{busy === "test" ? "测试中" : "测试连接"}</button><button className="button ghost" type="button" onClick={loadModels} disabled={!initialCredential || Boolean(busy)}>{busy === "models" ? "获取中" : "获取模型列表"}</button>{initialCredential && <button className="button danger push-right" type="button" onClick={deleteCredential}><Trash aria-hidden="true" />删除 Key</button>}</div>
        </form>
      </section>

      <section className="settings-section" aria-labelledby="codes-title">
        <div className="settings-section-heading"><div><h2 id="codes-title">体验码</h2><p>调用消耗你的 API；主要请求和每条追问各算一次。</p></div><Plus aria-hidden="true" /></div>
        <form className="create-code-form" onSubmit={createGuestCode}><label>名称（可选）<input value={codeName} onChange={(event) => setCodeName(event.target.value)} placeholder="给朋友" maxLength={50} /></label><label>允许次数<input type="number" min={1} max={10000} value={maxUses} onChange={(event) => setMaxUses(Number(event.target.value))} /></label><button className="button secondary" type="submit" disabled={Boolean(busy) || !initialCredential}><Plus aria-hidden="true" />创建</button></form>
        <div className="code-list">
          {codes.length === 0 && <p className="empty-note">还没有体验码。</p>}
          {codes.map((code) => <div className="code-row" key={code.id}><div><strong>{code.name || code.code}</strong>{code.name && <code>{code.code}</code>}<span>{code.usedUses} / {code.maxUses} 次 · {code.enabled ? "启用" : "已禁用"}</span></div><div className="row-actions"><button type="button" aria-label="复制体验码" onClick={() => navigator.clipboard.writeText(code.code)}><Clipboard aria-hidden="true" /></button><button type="button" aria-label={code.enabled ? "禁用体验码" : "启用体验码"} onClick={() => toggleCode(code)}><Power aria-hidden="true" /></button><button type="button" aria-label="删除体验码" onClick={() => removeCode(code)}><Trash aria-hidden="true" /></button></div></div>)}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="account-title">
        <div className="settings-section-heading"><div><h2 id="account-title">账号</h2><p>修改密码会退出其他会话。</p></div><SignOut aria-hidden="true" /></div>
        <form className="password-form" onSubmit={changePassword}><label>当前密码<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label><label>新密码<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} /></label><button className="button secondary" type="submit" disabled={Boolean(busy)}>修改密码</button><button className="button ghost push-right" type="button" onClick={logout}><SignOut aria-hidden="true" />退出登录</button></form>
      </section>
    </main>
  );
}

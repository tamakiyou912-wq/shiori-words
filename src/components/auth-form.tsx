"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Eye, EyeSlash } from "@phosphor-icons/react";
import { GuestCodeForm } from "./guest-code-form";

type RegistrationState = {
  ownerReady: boolean;
  registrationMode: "open" | "invite" | "closed";
  atCapacity: boolean;
  allowGuestCodes: boolean;
};

export function AuthForm({ mode, site }: { mode: "login" | "register"; site: RegistrationState }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isRegister = mode === "register";
  const registrationAvailable = site.ownerReady && site.registrationMode !== "closed" && !site.atCapacity;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, ...(isRegister ? { inviteCode } : {}) }) });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(payload.error || "操作失败，请重试。");
      return;
    }
    router.push(isRegister ? "/settings?welcome=1" : "/");
    router.refresh();
  }

  return (
    <main className={isRegister || !site.allowGuestCodes ? "auth-page" : "auth-page auth-page-with-guest"}>
      <section className={isRegister || !site.allowGuestCodes ? "auth-panel" : "auth-panel auth-panel-login"} aria-labelledby="auth-title">
        <div className="auth-account">
        <p className="eyebrow">詞織账号</p>
        <h1 id="auth-title">{isRegister ? "创建账号" : "欢迎回来"}</h1>
        <p className="auth-intro">{isRegister ? "只需要用户名和密码。账号用于保存你的 API 设置与查询历史。" : "登录账号，继续使用自己的 API 和历史记录。"}</p>
        {isRegister && !registrationAvailable ? (
          <p className="status-banner error" role="status">{!site.ownerReady ? "站点尚未完成 Owner 初始化。" : site.atCapacity ? "当前实例已达到用户上限。" : "当前实例已关闭注册。"}</p>
        ) : <form onSubmit={submit} className="stack-form">
          <label>用户名
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={32} required autoFocus />
          </label>
          <label>密码
            <span className="password-field">
              <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isRegister ? "new-password" : "current-password"} minLength={8} maxLength={128} required />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
            </span>
          </label>
          {isRegister && site.registrationMode === "invite" && <label>注册邀请码
            <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} autoComplete="off" maxLength={64} placeholder="SHIORI-JOIN-…" required />
          </label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary wide" type="submit" disabled={loading}>{loading ? "请稍候" : isRegister ? "注册" : "登录"}<ArrowRight aria-hidden="true" /></button>
        </form>}
        {isRegister ? <p className="auth-switch">已经有账号？ <Link href="/login">登录</Link></p> : registrationAvailable ? <p className="auth-switch">还没有账号？ <Link href="/register">注册</Link></p> : !site.ownerReady ? <p className="auth-switch">首次部署？ <Link href="/setup">初始化站点</Link></p> : null}
        </div>
        {!isRegister && site.allowGuestCodes && (
          <section className="auth-guest" aria-labelledby="auth-guest-title">
            <div className="auth-divider"><span>或</span></div>
            <p className="eyebrow">免注册使用</p>
            <h2 id="auth-guest-title">输入体验码</h2>
            <p>使用朋友分享的体验次数，不需要账号或 API Key。</p>
            <GuestCodeForm id="login-guest-code" />
          </section>
        )}
      </section>
    </main>
  );
}

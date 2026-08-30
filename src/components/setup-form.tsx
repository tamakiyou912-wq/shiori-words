"use client";

import { ArrowRight, Eye, EyeSlash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SetupForm() {
  const router = useRouter();
  const [setupToken, setSetupToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupToken, username, password, confirmPassword }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "初始化失败，请重试。");
      router.push("/settings?setup=complete");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "初始化失败，请重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack-form">
      <label>Owner 初始化令牌
        <input type="password" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} autoComplete="off" required autoFocus />
      </label>
      <label>Owner 用户名
        <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={32} required />
      </label>
      <label>密码
        <span className="password-field">
          <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
          <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
        </span>
      </label>
      <label>确认密码
        <input type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary wide" type="submit" disabled={loading}>{loading ? "正在初始化" : "创建唯一 Owner"}<ArrowRight aria-hidden="true" /></button>
    </form>
  );
}

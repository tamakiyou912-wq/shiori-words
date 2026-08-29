"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Key } from "@phosphor-icons/react";

export function GuestCodeForm({ id = "guest-code" }: { id?: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function activate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/guest/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(payload.error || "体验码无法使用。");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="guest-code-entry">
      <form onSubmit={activate} className="guest-code-form">
        <label className="sr-only" htmlFor={id}>体验码</label>
        <Key aria-hidden="true" />
        <input
          id={id}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="SHIORI-X7K29"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={loading || !code.trim()}>{loading ? "验证中" : "开始体验"}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

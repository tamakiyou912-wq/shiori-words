import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { GuestCodeForm } from "./guest-code-form";

export function AccessPanel() {
  return (
    <section className="access-panel" aria-labelledby="access-title">
      <div>
        <p className="eyebrow" id="access-title">开始使用</p>
        <p>登录后使用自己的 API，或者输入朋友分享的体验码。</p>
      </div>
      <div className="access-actions">
        <Link className="button secondary" href="/login">登录 / 注册 <ArrowRight aria-hidden="true" /></Link>
        <GuestCodeForm id="home-guest-code" />
      </div>
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { SetupForm } from "@/components/setup-form";
import { hasOwner } from "@/lib/site";

export const metadata: Metadata = { title: "初始化站点" };

export default async function SetupPage() {
  const initialized = await hasOwner();
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="setup-title">
        <p className="eyebrow">私人实例</p>
        <h1 id="setup-title">{initialized ? "初始化已完成" : "创建 Owner"}</h1>
        {initialized ? (
          <>
            <p className="auth-intro">站点已经拥有唯一 Owner，此页面不会再创建其他 Owner。</p>
            <p className="auth-switch"><Link href="/login">前往登录</Link></p>
          </>
        ) : (
          <>
            <p className="auth-intro">仅限第一次部署。令牌来自服务器环境变量，不会保存到数据库。</p>
            <SetupForm />
          </>
        )}
      </section>
    </main>
  );
}

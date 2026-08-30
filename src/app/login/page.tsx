import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth";
import { getPublicSiteState } from "@/lib/site";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return <AuthForm mode="login" site={await getPublicSiteState()} />;
}

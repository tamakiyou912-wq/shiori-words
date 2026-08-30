import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth";
import { getPublicSiteState } from "@/lib/site";

export const metadata: Metadata = { title: "注册" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/");
  return <AuthForm mode="register" site={await getPublicSiteState()} />;
}

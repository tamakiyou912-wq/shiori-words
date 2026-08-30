import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { AppHeaderFallback, AuthenticatedAppHeader } from "@/components/app-header";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";

export const metadata: Metadata = {
  title: { default: "詞織 / SHIORI", template: "%s · 詞織" },
  description: "以日语学习为核心的中日英 AI 翻译与语言助手。words, woven clearly.",
  applicationName: "詞織",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "詞織" },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#181715" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body>
        <div className="app-shell">
          <Suspense fallback={<AppHeaderFallback />}>
            <AuthenticatedAppHeader />
          </Suspense>
          {children}
        </div>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}

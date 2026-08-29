import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "詞織 / SHIORI",
    short_name: "詞織",
    description: "中日英 AI 翻译与日语学习助手。words, woven clearly.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f6f1",
    theme_color: "#b44835",
    lang: "zh-CN",
    orientation: "any",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

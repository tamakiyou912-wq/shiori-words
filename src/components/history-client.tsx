"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Trash } from "@phosphor-icons/react";

type HistoryItem = { id: string; input: string; summary: string; detectedLanguage: string; targetLanguage: string; createdAt: string };

const languageNames: Record<string, string> = { zh: "中文", ja: "日语", en: "英语", romaji: "罗马字", unknown: "自动" };

export function HistoryClient({ initialItems }: { initialItems: HistoryItem[] }) {
  const [items, setItems] = useState(initialItems);

  async function remove(id: string) {
    await fetch(`/api/history/${id}`, { method: "DELETE" });
    setItems((current) => current.filter((item) => item.id !== id));
  }

  async function clearAll() {
    if (!window.confirm("清空全部历史记录？此操作无法撤销。")) return;
    await fetch("/api/history", { method: "DELETE" });
    setItems([]);
  }

  return (
    <main className="page-content history-page">
      <header className="page-heading row-heading"><div><p className="eyebrow">最近查询</p><h1>历史</h1><p>点击一条记录，在首页重新打开完整结果。</p></div>{items.length > 0 && <button className="button ghost" onClick={clearAll}><Trash aria-hidden="true" />清空</button>}</header>
      <div className="history-list">
        {items.length === 0 && <div className="empty-state"><p>还没有查询记录。</p><Link href="/">开始翻译 <ArrowRight aria-hidden="true" /></Link></div>}
        {items.map((item) => (
          <div className="history-row" key={item.id}>
            <Link href={`/?history=${item.id}`}><div><strong>{item.summary}</strong><p>{item.input}</p></div><span>{languageNames[item.detectedLanguage] || item.detectedLanguage} → {languageNames[item.targetLanguage] || item.targetLanguage}<time dateTime={item.createdAt}>{new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.createdAt))}</time></span></Link>
            <button type="button" aria-label={`删除 ${item.summary}`} onClick={() => remove(item.id)}><Trash aria-hidden="true" /></button>
          </div>
        ))}
      </div>
    </main>
  );
}

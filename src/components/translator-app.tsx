"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChatCircleDots, PaperPlaneRight, X } from "@phosphor-icons/react";
import { AccessPanel } from "./access-panel";
import { TranslationResultView } from "./translation-result";
import { romajiScriptChoices } from "@/lib/language/preprocess";
import type { InputInterpretation, StreamEvent, TargetLanguage, TranslationResult } from "@/lib/types";

type FollowUpMessage = { question: string; answer: Partial<TranslationResult> };

const targetNames: Record<TargetLanguage, string> = { auto: "自动判断", zh: "中文", ja: "日语", en: "英语" };

export async function consumeStream(response: Response, onEvent: (event: StreamEvent) => void, signal?: AbortSignal) {
  if (!response.body) throw new Error("网络连接失败。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;
  const consumeLine = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    try {
      const event = JSON.parse(line) as StreamEvent;
      if (!event || typeof event !== "object" || typeof event.type !== "string") return;
      if (event.type === "done" || event.type === "error") terminal = true;
      onEvent(event);
    } catch {
      // A damaged optional line must not erase sections that were already rendered.
    }
  };
  while (true) {
    if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/u);
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  if (!terminal && !signal?.aborted) throw new Error("网络响应中断，已保留收到的结果。");
}

export function TranslatorApp({ hasAccess, guest, initialResult = null, initialConversationId }: { hasAccess: boolean; guest: { code: string; remainingUses: number } | null; initialResult?: TranslationResult | null; initialConversationId?: string }) {
  const [input, setInput] = useState(initialResult?.original || "");
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>("auto");
  const [result, setResult] = useState<Partial<TranslationResult> | null>(initialResult);
  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [messages, setMessages] = useState<FollowUpMessage[]>([]);
  const [remainingUses, setRemainingUses] = useState(guest?.remainingUses);
  const resultRef = useRef<HTMLDivElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const isComposingRef = useRef(false);
  const scriptChoices = useMemo(() => romajiScriptChoices(input), [input]);

  useEffect(() => () => activeRequestRef.current?.abort(), []);

  async function translate(event?: React.FormEvent, suggestedInput?: string, inputMode: InputInterpretation = "auto") {
    event?.preventDefault();
    const query = (suggestedInput ?? input).trim();
    if (!query || isComposingRef.current) return;
    if (!hasAccess) {
      document.getElementById("access-title")?.scrollIntoView({ behavior: "smooth", block: "center" });
      setError("请先登录或输入体验码。");
      return;
    }
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const requestId = ++requestIdRef.current;
    if (suggestedInput) setInput(query);
    setLoading(true);
    setError("");
    setResult({ original: query, translation: "", detectedLanguage: "unknown", targetLanguage: targetLanguage === "auto" ? "ja" : targetLanguage });
    setMessages([]);
    setConversationId(undefined);
    try {
      const response = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: query, targetLanguage, inputMode }), signal: controller.signal });
      await consumeStream(response, (streamEvent) => {
        if (requestId !== requestIdRef.current) return;
        if (streamEvent.type === "section") setResult((current) => ({ ...current, [streamEvent.data.key]: streamEvent.data.value }));
        if (streamEvent.type === "meta") setResult((current) => ({ ...current, detectedLanguage: streamEvent.data.detectedLanguage, targetLanguage: streamEvent.data.targetLanguage as TranslationResult["targetLanguage"] }));
        if (streamEvent.type === "done") {
          setResult(streamEvent.data.result);
          setConversationId(streamEvent.data.conversationId);
          if (streamEvent.data.remainingUses !== undefined) setRemainingUses(streamEvent.data.remainingUses);
        }
        if (streamEvent.type === "error") throw new Error(streamEvent.message);
      }, controller.signal);
      if (requestId === requestIdRef.current) window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
    } catch (caught) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      setError(caught instanceof Error ? caught.message : "网络连接失败。");
      setResult((current) => current && (current.translation || current.dictionary || current.sentenceAnalysis) ? current : null);
    } finally {
      if (requestId === requestIdRef.current) {
        activeRequestRef.current = null;
        setLoading(false);
      }
    }
  }

  async function askFollowUp(question = followUp) {
    if (!question.trim() || !conversationId || loading || isComposingRef.current) return;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const requestId = ++requestIdRef.current;
    const index = messages.length;
    setMessages((current) => [...current, { question: question.trim(), answer: { translation: "" } }]);
    setFollowUp("");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: result?.original || input, targetLanguage, conversationId, followUp: question.trim() }),
        signal: controller.signal,
      });
      await consumeStream(response, (streamEvent) => {
        if (requestId !== requestIdRef.current) return;
        if (streamEvent.type === "section") {
          setMessages((current) => current.map((message, messageIndex) => messageIndex === index ? { ...message, answer: { ...message.answer, [streamEvent.data.key]: streamEvent.data.value } } : message));
        }
        if (streamEvent.type === "done") {
          setMessages((current) => current.map((message, messageIndex) => messageIndex === index ? { ...message, answer: streamEvent.data.result } : message));
          if (streamEvent.data.remainingUses !== undefined) setRemainingUses(streamEvent.data.remainingUses);
        }
        if (streamEvent.type === "error") throw new Error(streamEvent.message);
      }, controller.signal);
    } catch (caught) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      setError(caught instanceof Error ? caught.message : "网络连接失败。");
      setMessages((current) => current.slice(0, index));
    } finally {
      if (requestId === requestIdRef.current) {
        activeRequestRef.current = null;
        setLoading(false);
      }
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !isComposingRef.current) {
      event.preventDefault();
      void translate();
    }
  }

  return (
    <main className="main-content">
      <section className="translator" aria-labelledby="translator-title">
        <h1 className="sr-only" id="translator-title">中日英 AI 翻译与日语学习</h1>
        {guest && (
          <div className="guest-status"><span>体验模式 · {guest.code}</span><strong>{remainingUses} 次可用</strong></div>
        )}
        <form className="translate-form" onSubmit={translate}>
          <label className="sr-only" htmlFor="translation-input">输入要翻译或查询的内容</label>
          <div className="translation-field">
            <textarea
              id="translation-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={() => { isComposingRef.current = false; }}
              placeholder="输入中文、日语、英语或罗马字……"
              rows={2}
              autoFocus
            />
            {input && <button className="clear-input" type="button" aria-label="清空输入" onClick={() => setInput("")}><X aria-hidden="true" /></button>}
            <div className="translation-controls">
              <label>目标语言
                <select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value as TargetLanguage)}>
                  {Object.entries(targetNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}
                </select>
              </label>
              <span className="shortcut-hint">Enter 翻译 · Shift+Enter 换行</span>
              <button className="button primary translate-button" type="submit" disabled={!input.trim()}>
                {loading && !result ? "翻译中" : "翻译"}<ArrowRight aria-hidden="true" />
              </button>
            </div>
          </div>
        </form>
        {scriptChoices && (
          <div className="script-assist" aria-label="罗马字输入候选">
            <span>输入识别</span>
            <button type="button" onClick={() => void translate(undefined, scriptChoices.hiragana, "hiragana")}>
              <small>平假名</small><strong lang="ja">{scriptChoices.hiragana}</strong>
            </button>
            <button type="button" onClick={() => void translate(undefined, scriptChoices.katakana, "katakana")}>
              <small>片假名</small><strong lang="ja">{scriptChoices.katakana}</strong>
            </button>
            <button type="button" onClick={() => void translate(undefined, input, "kanji")}>
              <small>汉字・词语</small><strong>按读音联想</strong>
            </button>
          </div>
        )}
        {error && <div className="inline-error" role="alert">{error}</div>}
      </section>

      {!hasAccess && <AccessPanel />}

      {result && (
        <div ref={resultRef} className="result-area">
          <TranslationResultView key={result.original} result={result} streaming={loading && messages.length === 0} onSelectSuggestion={(query) => void translate(undefined, query, "auto")} />

          {messages.length > 0 && (
            <div className="followup-thread" aria-label="连续追问">
              {messages.map((message, index) => (
                <div className="followup-turn" key={`${message.question}-${index}`}>
                  <p className="followup-question">{message.question}</p>
                  <TranslationResultView result={message.answer} streaming={loading && index === messages.length - 1} onSelectSuggestion={(query) => void translate(undefined, query, "auto")} />
                </div>
              ))}
            </div>
          )}

          {conversationId && (
            <section className="followup-section" aria-labelledby="followup-title">
              <h2 id="followup-title">继续追问</h2>
              <div className="suggestion-row">
                {["这样自然吗？", "换成口语", "帮我造三个句子"].map((suggestion) => <button key={suggestion} type="button" onClick={() => void askFollowUp(suggestion)} disabled={loading}>{suggestion}</button>)}
              </div>
              <form onSubmit={(event) => { event.preventDefault(); if (!isComposingRef.current) void askFollowUp(); }} className="followup-form">
                <label className="sr-only" htmlFor="followup-input">追问这个结果</label>
                <ChatCircleDots aria-hidden="true" />
                <input id="followup-input" value={followUp} onChange={(event) => setFollowUp(event.target.value)} onCompositionStart={() => { isComposingRef.current = true; }} onCompositionEnd={() => { isComposingRef.current = false; }} placeholder="追问这个结果……" disabled={loading} />
                <button type="submit" aria-label="发送追问" disabled={loading || !followUp.trim()}><PaperPlaneRight aria-hidden="true" /></button>
              </form>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

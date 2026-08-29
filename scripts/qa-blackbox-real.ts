import { readFile, writeFile } from "node:fs/promises";
import type { QueryTelemetry, StreamEvent, TranslationResult } from "../src/lib/types";
import { buildQACorpus, representativeRealQueries, type QAQuery } from "./qa-corpus";

type RecordResult = QAQuery & {
  status: "success" | "error";
  error?: string;
  firstEventMs?: number;
  wallMs: number;
  telemetry?: QueryTelemetry;
  result?: TranslationResult;
  issues: string[];
};

function percentile(values: number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))] ?? 0;
}

function stats(values: number[]) {
  return values.length ? {
    count: values.length,
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  } : { count: 0, average: 0, median: 0, p95: 0, max: 0 };
}

function sanityIssues(query: QAQuery, result?: TranslationResult) {
  const issues: string[] = [];
  if (!result?.translation?.trim()) issues.push("empty-translation");
  const serialized = JSON.stringify(result ?? {});
  if (/\u0000|�/u.test(serialized)) issues.push("corrupt-text");
  if (serialized.length > 30_000) issues.push("oversized-result");
  const lexical = !["boundary"].includes(query.category);
  if (lexical && result?.type !== "sentence" && result?.dictionary) {
    if (!result.dictionary.chineseMeaning?.trim()) issues.push("missing-chinese");
    if (!result.dictionary.englishMeaning?.trim()) issues.push("missing-english");
  }
  if (result?.type === "sentence") {
    if (!result.sentenceAnalysis?.japanese?.trim()) issues.push("missing-sentence-japanese");
    if (!result.sentenceAnalysis?.chinese?.trim()) issues.push("missing-sentence-chinese");
    if (!result.sentenceAnalysis?.english?.trim()) issues.push("missing-sentence-english");
  }
  if (query.input === "コンセント" && /\bconsent\b/iu.test(result?.dictionary?.englishMeaning ?? "")) issues.push("mechanical-katakana-english");
  if (result?.dictionary?.reading && result.dictionary.reading.length > 80) issues.push("implausible-reading");
  return issues;
}

async function queryApi(query: QAQuery, index: number, token: string): Promise<RecordResult> {
  const started = performance.now();
  let firstEventMs: number | undefined;
  try {
    const response = await fetch("http://127.0.0.1:3000/api/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `shiori_session=${token}`,
        "x-forwarded-for": `198.51.100.${(index % 240) + 1}`,
      },
      body: JSON.stringify({ input: query.input, targetLanguage: "auto" }),
    });
    if (!response.body) throw new Error("response body missing");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events: StreamEvent[] = [];
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/u);
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        try {
          if (!line.trim()) continue;
          events.push(JSON.parse(line) as StreamEvent);
          firstEventMs ??= performance.now() - started;
        } catch { /* A damaged optional line is ignored just like the browser consumer. */ }
      }
      if (done) break;
    }
    const error = events.find((event) => event.type === "error");
    const done = events.findLast((event) => event.type === "done");
    if (error?.type === "error") return { ...query, status: "error", error: error.message, wallMs: performance.now() - started, firstEventMs, issues: [error.code ?? "api-error"] };
    if (done?.type !== "done") return { ...query, status: "error", error: "missing terminal event", wallMs: performance.now() - started, firstEventMs, issues: ["missing-terminal"] };
    return {
      ...query,
      status: "success",
      wallMs: performance.now() - started,
      firstEventMs,
      telemetry: done.data.telemetry,
      result: done.data.result,
      issues: sanityIssues(query, done.data.result),
    };
  } catch (error) {
    return { ...query, status: "error", error: error instanceof Error ? error.message : "unknown", wallMs: performance.now() - started, firstEventMs, issues: ["network-error"] };
  }
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, task: (value: T, index: number) => Promise<R>) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      output[index] = await task(values[index]!, index);
    }
  }));
  return output;
}

const anchors = [
  "aishiteru", "shitteru", "wakatteru", "tabeteru", "nonderu", "matteru", "itteru", "miteiru", "ikitai", "tabetai", "ikanai", "tabenai",
  "gakkou", "gakko", "nihonn", "konnichiha", "intaanetto", "inntaanetto", "su-pa-", "ko-hi-", "goipurinto", "語彙purinto",
  "学校", "予約", "学习", "コンセント", "サラリーマン", "クレーム", "ノートパソコン", "school", "reservation",
  "我差点忘了今天有课。", "I almost forgot I had class today.",
];

async function main() {
  const fixture = JSON.parse(await readFile(new URL("../work/qa-blackbox-session.json", import.meta.url), "utf8")) as { token: string };
  const corpus = await buildQACorpus();
  const byInput = new Map(corpus.map((query) => [query.input, query]));
  const anchorQueries = anchors.map((input): QAQuery => byInput.get(input) ?? { input, category: /[\u3040-\u30ff]/u.test(input) ? "japanese" : /\p{Script=Han}/u.test(input) ? "chinese" : "romaji-ime" });
  const sample = [...anchorQueries, ...representativeRealQueries(corpus, 130)];
  const requestedCount = Math.max(1, Math.min(150, Number(process.env.QA_REAL_COUNT ?? 130)));
  const unique = [...new Map(sample.map((query) => [query.input, query])).values()].slice(0, requestedCount);
  const records = await mapConcurrent(unique, 4, (query, index) => queryApi(query, index, fixture.token));
  const success = records.filter((record) => record.status === "success");
  const usage = success.flatMap((record) => record.telemetry?.usage ? [record.telemetry.usage] : []);
  const inputTokens = usage.map((item) => item.inputTokens ?? 0);
  const cachedTokens = usage.map((item) => item.cachedInputTokens ?? 0);
  const outputTokens = usage.map((item) => item.outputTokens ?? 0);
  const totalTokens = usage.map((item) => (item.inputTokens ?? 0) + (item.outputTokens ?? 0));
  const calls = success.map((record) => record.telemetry?.aiCalls ?? 0);
  const prices = { hit: 0.007, miss: 0.22, output: 0.66 };
  const offPeakCost = usage.reduce((sum, item) => sum
    + (item.cachedInputTokens ?? 0) * prices.hit / 1_000_000
    + Math.max(0, (item.inputTokens ?? 0) - (item.cachedInputTokens ?? 0)) * prices.miss / 1_000_000
    + (item.outputTokens ?? 0) * prices.output / 1_000_000, 0);
  const averageCost = usage.length ? offPeakCost / usage.length : 0;
  const metrics = {
    generatedAt: new Date().toISOString(),
    total: records.length,
    success: success.length,
    errors: records.length - success.length,
    sanityFailures: success.filter((record) => record.issues.length > 0).length,
    apiCalls: { ...stats(calls), aboveOne: calls.filter((value) => value > 1).length },
    tokens: { input: stats(inputTokens), cachedInput: stats(cachedTokens), output: stats(outputTokens), total: stats(totalTokens), sum100Equivalent: stats(totalTokens).average * 100 },
    latencyMs: {
      firstEvent: stats(success.flatMap((record) => record.firstEventMs === undefined ? [] : [record.firstEventMs])),
      dictionary: stats(success.flatMap((record) => record.telemetry ? [record.telemetry.dictionaryMs] : [])),
      ai: stats(success.flatMap((record) => record.telemetry?.aiMs === undefined ? [] : [record.telemetry.aiMs])),
      total: stats(success.map((record) => record.wallMs)),
    },
    estimatedOffPeakUsd: { per100: averageCost * 100, per1000: averageCost * 1000, per10000: averageCost * 10000 },
    estimatedPeakUsd: { per100: averageCost * 200, per1000: averageCost * 2000, per10000: averageCost * 20000 },
  };
  const outputName = process.env.QA_REAL_OUTPUT ?? "qa-blackbox-real.json";
  await writeFile(new URL(`../work/${outputName}`, import.meta.url), JSON.stringify({ metrics, failures: records.filter((record) => record.status === "error" || record.issues.length > 0), records }, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
}

await main();

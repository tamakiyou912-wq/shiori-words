import { mkdir, writeFile } from "node:fs/promises";
import { toHiragana, toRomaji } from "wanakana";
import { prepareQuery } from "../src/lib/query/pipeline";
import { buildQACorpus, type QAQuery } from "./qa-corpus";

type LocalRecord = QAQuery & {
  rank: number;
  resolved?: string;
  reading?: string;
  source?: string;
  detectedLanguage: string;
  issues: string[];
  falseCorrection: boolean;
  latencyMs: number;
};

function percentile(values: number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))] ?? 0;
}

function expectedRank(query: QAQuery, plan: Awaited<ReturnType<typeof prepareQuery>>) {
  const matches = plan.resolution?.matches ?? plan.dictionaryMatches;
  const expected = (match: (typeof matches)[number]) => query.expectedEntryId
    ? match.id === query.expectedEntryId
    : match.surface === query.expectedSurface || toHiragana(match.reading) === toHiragana(query.expectedReading ?? "");
  const rank = matches.findIndex(expected);
  if (rank >= 0) return rank + 1;
  if (query.expectedSurface && plan.resolution?.resolved === query.expectedSurface) return 1;
  return 0;
}

function qualityIssues(query: QAQuery, plan: Awaited<ReturnType<typeof prepareQuery>>) {
  const result = plan.baseResult;
  const issues: string[] = [];
  if (!result.translation?.trim()) issues.push("empty-result");
  if (/\u0000|�/u.test(JSON.stringify(result))) issues.push("corrupt-text");
  if (JSON.stringify(result).length > 20_000) issues.push("oversized-result");
  if (result.dictionary?.reading && !toRomaji(result.dictionary.reading)) issues.push("invalid-reading");
  if (query.category === "english" && plan.detectedLanguage !== "en") issues.push(`language:${plan.detectedLanguage}`);
  if (query.category === "chinese" && !["zh", "unknown"].includes(plan.detectedLanguage)) issues.push(`language:${plan.detectedLanguage}`);
  return issues;
}

async function main() {
  const corpus = await buildQACorpus();
  await prepareQuery("gakkou", "auto");
  const records: LocalRecord[] = [];
  const latencies: number[] = [];
  let falseCorrections = 0;
  let validMorphology = 0;
  for (const query of corpus) {
    const started = performance.now();
    const plan = await prepareQuery(query.input, "auto");
    const latencyMs = performance.now() - started;
    latencies.push(latencyMs);
    const rank = expectedRank(query, plan);
    const exactKana = query.expectedReading ? toHiragana(query.expectedReading) : undefined;
    const top = plan.resolution?.matches[0];
    const falseCorrection = query.category === "morphology"
      && Boolean(plan.resolution?.reading && toHiragana(plan.resolution.reading) !== exactKana)
      && Boolean(top?.matchType === "fuzzy" || plan.resolution?.segmented);
    if (query.category === "morphology") {
      validMorphology += 1;
      if (falseCorrection) falseCorrections += 1;
    }
    records.push({
      ...query,
      rank,
      resolved: plan.resolution?.resolved,
      reading: plan.resolution?.reading,
      source: plan.baseResult.source,
      detectedLanguage: plan.detectedLanguage,
      issues: qualityIssues(query, plan),
      falseCorrection,
      latencyMs,
    });
  }

  const romaji = records.filter((record) => record.category.startsWith("romaji") || record.category === "morphology");
  const fuzzy = records.filter((record) => record.fuzzyExpected);
  const metrics = {
    generatedAt: new Date().toISOString(),
    total: records.length,
    categories: Object.fromEntries([...new Set(records.map((record) => record.category))].map((category) => [category, records.filter((record) => record.category === category).length])),
    qualityFailures: records.filter((record) => record.issues.length > 0).length,
    romaji: {
      total: romaji.length,
      top1: romaji.filter((record) => record.rank === 1).length / romaji.length,
      top3: romaji.filter((record) => record.rank >= 1 && record.rank <= 3).length / romaji.length,
      failure: romaji.filter((record) => record.rank === 0).length / romaji.length,
      falseCorrectionRate: validMorphology ? falseCorrections / validMorphology : 0,
      fuzzyPrecision: fuzzy.length ? fuzzy.filter((record) => record.rank >= 1 && record.rank <= 3).length / fuzzy.length : 0,
    },
    latencyMs: {
      average: latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
      median: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: Math.max(...latencies),
    },
  };
  await mkdir(new URL("../work", import.meta.url), { recursive: true });
  await writeFile(new URL("../work/qa-blackbox-local.json", import.meta.url), JSON.stringify({ metrics, failures: records.filter((record) => record.rank === 0 || record.issues.length > 0 || record.falseCorrection).slice(0, 100), records }, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
}

await main();

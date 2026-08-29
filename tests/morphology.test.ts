import { describe, expect, it } from "vitest";
import { toHiragana } from "wanakana";
import { resolveJapaneseInput } from "@/lib/language/jmdict";
import { mergeAIResult, prepareQuery } from "@/lib/query/pipeline";
import { buildQACorpus } from "../scripts/qa-corpus";

describe("legal romaji morphology outranks fuzzy correction", () => {
  it.each([
    ["aishiteru", "愛してる", "あいしてる"],
    ["shitteru", "知ってる", "しってる"],
    ["tabeteru", "食べてる", "たべてる"],
    ["nonderu", "飲んでる", "のんでる"],
    ["miteiru", "見ている", "みている"],
    ["ikitai", "行きたい", "いきたい"],
    ["tabetai", "食べたい", "たべたい"],
    ["ikanai", "行かない", "いかない"],
    ["tabenai", "食べない", "たべない"],
    ["yokatta", "良かった", "よかった"],
    ["tanoshikatta", "楽しかった", "たのしかった"],
  ])("keeps the exact pronunciation for %s", async (input, surface, reading) => {
    const plan = await prepareQuery(input, "auto");
    expect(plan.resolution?.reading).toBe(reading);
    expect(plan.baseResult.dictionary?.surface).toBe(surface);
    expect(plan.resolution?.matches[0]?.matchType).not.toBe("fuzzy");
    expect(plan.baseResult.correction).toBeUndefined();
  });

  it.each(["wakatteru", "matteru", "itteru"])('does not force a phonetic correction for ambiguous "%s"', async (input) => {
    const resolution = await resolveJapaneseInput(input);
    expect(toHiragana(resolution.reading ?? "")).toBe(toHiragana(resolution.recognition?.segments[0]?.reading ?? ""));
    expect(resolution.matches[0]?.matchType).toBe("morphology");
    expect(resolution.matches.some((match) => match.matchType === "fuzzy")).toBe(false);
  });

  it("keeps false phonetic corrections at zero across 100+ generated valid inflections", async () => {
    const corpus = (await buildQACorpus()).filter((query) => query.category === "morphology");
    expect(corpus.length).toBeGreaterThanOrEqual(100);
    let falseCorrections = 0;
    let topThree = 0;
    for (const query of corpus) {
      const resolution = await resolveJapaneseInput(query.input);
      const expectedReading = toHiragana(query.expectedReading ?? "");
      const changedPronunciation = toHiragana(resolution.reading ?? "") !== expectedReading;
      const correctionPath = resolution.segmented || resolution.matches[0]?.matchType === "fuzzy";
      if (changedPronunciation && correctionPath) falseCorrections += 1;
      const rank = resolution.matches.findIndex((match) => match.id === query.expectedEntryId);
      if (rank >= 0 && rank < 3) topThree += 1;
    }
    expect(falseCorrections).toBe(0);
    expect(topThree / corpus.length).toBeGreaterThanOrEqual(0.95);
  }, 30_000);

  it("keeps the resolved Japanese headword when AI returns a Chinese gloss as translation", async () => {
    const base = (await prepareQuery("nonderu", "auto")).baseResult;
    const merged = mergeAIResult(base, { translation: "正在喝", dictionary: { surface: "飲んでる", chineseMeaning: "正在喝", englishMeaning: "to be drinking" } });
    expect(merged.translation).toBe("飲んでる");
    expect((merged.suggestions ?? []).filter((suggestion) => suggestion.query === "飲んでる").length).toBeLessThanOrEqual(1);
  });

  it("uses AI semantics to choose an orthography without changing the exact pronunciation", async () => {
    const base = (await prepareQuery("wakatteru", "auto")).baseResult;
    const merged = mergeAIResult(base, { dictionary: { surface: "わかってる", reading: "わかってる", chineseMeaning: "明白", englishMeaning: "to understand" } });
    expect(merged.translation).toBe("分かってる");
    expect(merged.dictionary).toMatchObject({ surface: "分かってる", reading: "わかってる" });
    expect(new Set((merged.suggestions ?? []).map((suggestion) => suggestion.query)).size).toBe((merged.suggestions ?? []).length);
  });
});

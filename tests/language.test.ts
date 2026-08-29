import { describe, expect, it } from "vitest";
import { imeRomajiDistance, lookupDictionary, resolveJapaneseInput } from "@/lib/language/jmdict";
import { collapseKatakanaLongVowels, detectLanguage, normalizeInput, normalizedLookupKey, romajiForms, romajiScriptChoices, segmentScripts } from "@/lib/language/preprocess";
import { prepareQuery } from "@/lib/query/pipeline";

describe("unified Japanese input normalization", () => {
  it("normalizes Unicode and whitespace without word-specific rewrites", () => {
    expect(normalizeInput("  ＧＡＫＫＯＵ  \n  テスト ")).toBe("GAKKOU\nテスト");
    expect(normalizedLookupKey("Gakko")).toBe("gakko");
  });

  it("segments mixed scripts and preserves source order", () => {
    expect(segmentScripts("語彙purinto・ごい").map(({ kind, text }) => [kind, text])).toEqual([
      ["han", "語彙"],
      ["latin", "purinto"],
      ["punctuation", "・"],
      ["hiragana", "ごい"],
    ]);
  });

  it("handles doubled vowels and phone-keyboard long marks generically", () => {
    expect(collapseKatakanaLongVowels("スウパア")).toBe("スーパー");
    expect(romajiForms("ko-hi-").katakanaCandidates).toContain("コーヒー");
    expect(romajiScriptChoices("su-pa-")?.katakana).toBe("スーパー");
  });

  it("distinguishes outward language categories without treating all Han text as Japanese", () => {
    expect(detectLanguage("gakkou")).toBe("romaji");
    expect(detectLanguage("コンセント")).toBe("ja");
    expect(detectLanguage("预约")).toBe("zh");
    expect(detectLanguage("語彙purinto")).toBe("unknown");
  });
});

describe("JMdict lookup and IME-like resolution", () => {
  it.each([
    ["gakkou", "学校", "がっこう"],
    ["gakko", "学校", "がっこう"],
    ["nihonn", "日本", "にほん"],
    ["konnichiha", "今日は", "こんにちは"],
    ["kitte", "切手", "きって"],
    ["zasshi", "雑誌", "ざっし"],
    ["intaanetto", "インターネット", "インターネット"],
    ["inntaanetto", "インターネット", "インターネット"],
    ["inta-netto", "インターネット", "インターネット"],
    ["suupaa", "スーパー", "スーパー"],
    ["su-pa-", "スーパー", "スーパー"],
    ["koohii", "珈琲", "コーヒー"],
    ["ko-hi-", "珈琲", "コーヒー"],
    ["geemu", "ゲーム", "ゲーム"],
    ["ge-mu", "ゲーム", "ゲーム"],
    ["sarariman", "サラリーマン", "サラリーマン"],
    ["ooku", "多く", "おおく"],
  ])("resolves %s through the same generic pipeline", async (input, surface, reading) => {
    const result = await prepareQuery(input, "auto");
    expect(result.baseResult.dictionary).toMatchObject({ surface, reading });
    expect(result.baseResult.translation).toBeTruthy();
  });

  it.each([
    ["goipurinto", "語彙プリント", "ごいプリント"],
    ["goi purinto", "語彙プリント", "ごいプリント"],
    ["語彙purinto", "語彙プリント", "ごいプリント"],
    ["ごいpurinto", "語彙プリント", "ごいプリント"],
    ["goiプリント", "語彙プリント", "ごいプリント"],
    ["benkyousuru", "勉強する", "べんきょうする"],
    ["nihonjin", "日本人", "にほんじん"],
    ["kanjitesuto", "漢字テスト", "かんじテスト"],
    ["eigo no tesuto", "英語のテスト", "えいごのテスト"],
    ["日本go", "日本語", "にほんご"],
    ["konbini de kaimono", "コンビニで買い物", "コンビニでかいもの"],
  ])("segments and recombines %s", async (input, surface, reading) => {
    const result = await resolveJapaneseInput(input);
    expect(result.resolved).toBe(surface);
    expect(result.reading).toBe(reading);
    expect(result.recognition?.segments.length).toBeGreaterThan(0);
  });

  it("uses bounded fuzzy matching instead of an alias table", async () => {
    const candidates = await lookupDictionary("gakkko", { allowFuzzy: true, limit: 3 });
    expect(candidates[0]?.surface).toBe("学校");
    expect(candidates[0]?.editDistance).toBeGreaterThan(0);
    expect(imeRomajiDistance("gakou", "gakkou")).toBeLessThan(imeRomajiDistance("gakou", "gaikou"));
    expect((await lookupDictionary("gakou", { allowFuzzy: true, limit: 3 }))[0]?.surface).toBe("学校");
  });

  it("keeps English lookup separate from romaji segmentation", async () => {
    const school = await prepareQuery("school", "auto");
    const reservation = await prepareQuery("reservation", "auto");
    expect(school.detectedLanguage).toBe("en");
    expect(reservation.detectedLanguage).toBe("en");
    expect(school.dictionaryMatches.some((match) => match.englishMeanings.includes("school"))).toBe(true);
  });

  it("uses OpenCC variants as a general Han lookup aid", async () => {
    expect((await prepareQuery("学习", "auto")).baseResult.dictionary?.surface).toBe("学習");
    expect((await prepareQuery("學習", "auto")).baseResult.dictionary?.surface).toBe("学習");
  });

  it("adds editorial katakana facts after a JMdict lookup", async () => {
    const outlet = (await prepareQuery("コンセント", "auto")).baseResult;
    expect(outlet.dictionary?.englishMeaning).toContain("outlet");
    expect(outlet.katakanaOrigin?.actualEnglish).toContain("outlet");
  });
});

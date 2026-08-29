import { describe, expect, it } from "vitest";
import { mergeAIResult, prepareQuery } from "@/lib/query/pipeline";

const corpus = [
  // Standard Japanese and IME-style romaji
  "gakkou", "nihon", "sensei", "benkyou", "taberu", "kirei", "kakeru", "kitte", "zasshi", "nihonn", "konnichiha", "konnbannwa",
  "tomodachi", "daigaku", "densha", "byouin", "yakusoku", "ryokou", "shukudai", "jisho", "kotoba", "bunpou", "shitsumon", "kotae",
  "arigatou", "ohayou", "oyasumi", "sumimasen", "onegaishimasu", "hajimemashite", "yoroshiku", "daijoubu", "wakaranai", "wakarimashita",
  // Katakana and phone-keyboard long vowels
  "intaanetto", "inntaanetto", "inta-netto", "suupaa", "su-pa-", "koohii", "ko-hi-", "geemu", "ge-mu", "konpyuutaa", "konpyu-ta-",
  "pasokon", "konbini", "arubaito", "hoteru", "resutoran", "kamera", "terebi", "rajio", "takushii", "basu", "meeru", "me-ru", "taipuraitaa",
  // Typos and bounded fuzzy inputs
  "gakou", "gakkko", "nihonnn", "intaanet", "konnbini", "pasokonn", "senssei", "benkyoo", "tomodti", "resutorann",
  // Segmented and mixed scripts
  "benkyousuru", "nihonjin", "goipurinto", "kanjitesuto", "eigo no tesuto", "日本go", "語彙purinto", "ごいpurinto", "goiプリント", "konbini de kaimono",
  "nihongo no hon", "gakkou de benkyou", "tomodachi to eiga", "東京eki", "日本jin", "英語tesuto", "べんきょうsuru", "コンビニde", "kanjiドリル",
  // Direct kana and kanji
  "がっこう", "学校", "にほん", "日本", "こんにちは", "こんばんは", "ネット", "インターネット", "スーパー", "コーヒー", "コンピューター",
  "先生", "勉強", "食べる", "綺麗", "言葉", "辞書", "質問", "答え", "友達", "病院", "電車", "旅行", "宿題", "語彙", "プリント",
  "コンセント", "サラリーマン", "クレーム", "アルバイト", "パソコン", "メール", "バドミントン",
  // Chinese
  "预约", "学习", "學習", "报名", "提交", "上课", "便利店", "电脑", "咖啡", "词汇", "老师", "朋友", "医院", "电车", "旅行计划",
  // English words and phrases
  "school", "reservation", "convenience store", "computer", "coffee", "teacher", "friend", "hospital", "train", "travel", "vocabulary", "printout",
  "natural", "claim", "consent", "part-time job", "power outlet", "good morning", "thank you",
  // Full sentences
  "今日学校行かなかった", "今日は学校に行きませんでした。", "我差点忘了今天有课。", "你是谁？", "请帮我预约明天下午。",
  "I almost forgot I had class today.", "Where is the nearest convenience store?", "Could you make this sound more natural?", "I did not go to school today.",
  // Boundary and mixed input
  "a", "N", "123", "😀", "!!!", "中文 English", "日本語 English", "日本語 + English", "ＡＭＥＲＩＫＡ", "  gakkou   ", "学校\nに行きます",
  "hello世界", "coffeeを飲む", "日本 go", "goi  purinto", "\n\nこんにちは\n",
];

describe("query pipeline reliability", () => {
  it("returns a non-empty graceful result for 100+ varied inputs", async () => {
    expect(new Set(corpus).size).toBeGreaterThanOrEqual(140);
    await prepareQuery("gakkou", "auto"); // exclude one-time dictionary decompression from hot-path timing
    const started = performance.now();
    for (const input of corpus) {
      const plan = await prepareQuery(input, "auto");
      expect(plan.baseResult.translation.trim(), input).not.toBe("");
      expect(plan.baseResult.original, input).toBe(input);
      expect(plan.telemetry.dictionaryMs, input).toBeGreaterThanOrEqual(0);
    }
    const average = (performance.now() - started) / corpus.length;
    expect(average).toBeLessThan(80);
  }, 30_000);

  it("keeps a dictionary fallback when optional AI fields are malformed or missing", async () => {
    const base = (await prepareQuery("gakkou", "auto")).baseResult;
    const result = mergeAIResult(base, { translation: "", examples: undefined, usageNotes: [] });
    expect(result.translation).toBeTruthy();
    expect(result.dictionary).toMatchObject({ surface: "学校", reading: "がっこう", englishMeaning: "school" });
  });

  it("does not let AI replace reliable JMdict reading facts", async () => {
    const base = (await prepareQuery("gakkou", "auto")).baseResult;
    const result = mergeAIResult(base, {
      translation: "学校",
      dictionary: { surface: "错误", reading: "まちがい", romaji: "machigai", chineseMeaning: "学校", englishMeaning: "wrong" },
    });
    expect(result.dictionary).toMatchObject({ surface: "学校", reading: "がっこう", englishMeaning: "school", chineseMeaning: "学校" });
  });

  it("uses the requested-language sentence field as the primary translation", async () => {
    const base = (await prepareQuery("我差点忘了今天有课。", "auto")).baseResult;
    const result = mergeAIResult(base, {
      sentenceAnalysis: {
        japanese: "今日授業があるのを忘れるところだった。",
        chinese: "我差点忘了今天有课。",
        english: "I almost forgot I had class today.",
      },
    });
    expect(result.translation).toBe("今日授業があるのを忘れるところだった。");
  });
});

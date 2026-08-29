import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { conjugate, conjugateAuxiliaries, adjConjugate } from "kamiya-codec";
import { toHiragana, toRomaji } from "wanakana";

export type CompactEntry = {
  i: string;
  k: string[];
  kc?: string[];
  r: string[];
  rc?: string[];
  p: string[];
  g: string[];
  c: boolean;
};

export type QAQuery = {
  input: string;
  category: "romaji-random" | "romaji-ime" | "morphology" | "japanese" | "chinese" | "english" | "mixed" | "boundary";
  expectedEntryId?: string;
  expectedSurface?: string;
  expectedReading?: string;
  fuzzyExpected?: boolean;
};

type CompactDictionary = { entries: CompactEntry[] };

function seededShuffle<T>(values: T[], seed = 0x5a10_2026) {
  const shuffled = [...values];
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return shuffled;
}

function preferredSurface(entry: CompactEntry) {
  return entry.kc?.[0] ?? entry.k[0] ?? entry.rc?.[0] ?? entry.r[0] ?? "";
}

function cleanReading(entry: CompactEntry) {
  const reading = entry.rc?.[0] ?? entry.r[0] ?? "";
  return /^[\p{Script=Hiragana}\p{Script=Katakana}ー・]+$/u.test(reading) ? reading : "";
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function loadQAEntries() {
  const compressed = await readFile(new URL("../public/dictionary/jmdict-common.json.gz", import.meta.url));
  return (JSON.parse(gunzipSync(compressed).toString("utf8")) as CompactDictionary).entries;
}

function randomRomaji(entries: CompactEntry[], count: number): QAQuery[] {
  const readingCounts = new Map<string, number>();
  for (const entry of entries) for (const reading of entry.r) readingCounts.set(toHiragana(reading), (readingCounts.get(toHiragana(reading)) ?? 0) + 1);
  const pools = [
    entries.filter((entry) => entry.p.some((pos) => pos === "n" || pos.startsWith("n-"))),
    entries.filter((entry) => entry.p.some((pos) => pos.startsWith("v"))),
    entries.filter((entry) => entry.p.some((pos) => pos.startsWith("adj"))),
    entries.filter((entry) => entry.p.some((pos) => pos.startsWith("adv"))),
  ].map((pool, index) => seededShuffle(pool, 0x5a10_2026 + index));
  const selected: CompactEntry[] = [];
  const used = new Set<string>();
  let cursor = 0;
  while (selected.length < count && cursor < entries.length) {
    for (const pool of pools) {
      const entry = pool[cursor % Math.max(1, pool.length)];
      const reading = entry && cleanReading(entry);
      const romaji = reading && toRomaji(reading).toLocaleLowerCase("en-US");
      if (!entry || !reading || !/^[a-z-]{3,24}$/u.test(romaji) || readingCounts.get(toHiragana(reading)) !== 1 || used.has(romaji)) continue;
      used.add(romaji);
      selected.push(entry);
      if (selected.length >= count) break;
    }
    cursor += 1;
  }
  return selected.map((entry) => {
    const reading = cleanReading(entry);
    return {
      input: toRomaji(reading),
      category: "romaji-random",
      expectedEntryId: entry.i,
      expectedSurface: preferredSurface(entry),
      expectedReading: reading,
    };
  });
}

function morphologyCorpus(entries: CompactEntry[], count: number): QAQuery[] {
  const dictionaryReadings = new Set(entries.flatMap((entry) => entry.r.map((reading) => toHiragana(reading))));
  const eligible = seededShuffle(entries.filter((entry) => {
    const reading = cleanReading(entry);
    const regularVerb = entry.p.some((pos) => ["v1", "v5u", "v5k", "v5k-s", "v5g", "v5s", "v5t", "v5n", "v5b", "v5m", "v5r", "vs-i"].includes(pos))
      && /[うくぐすつぬぶむる]$/u.test(reading);
    const adjective = entry.p.includes("adj-i") && reading.endsWith("い");
    return reading.length >= 2 && reading.length <= 9 && (regularVerb || adjective);
  }), 0xa11f_1ec7);
  const queries: QAQuery[] = [];
  const used = new Set<string>();
  const verbModes = ["negative", "te", "ta", "tai", "masu", "teiru"] as const;
  const adjectiveModes = ["past", "negative", "negativePast"] as const;

  for (let index = 0; index < eligible.length && queries.length < count; index += 1) {
    const entry = eligible[index]!;
    const reading = cleanReading(entry);
    let form = "";
    try {
      if (entry.p.includes("adj-i")) {
        const mode = adjectiveModes[index % adjectiveModes.length]!;
        form = adjConjugate(reading, mode === "past" ? "Past" : mode === "negative" ? "Negative" : "NegativePast", true)[0] ?? "";
      } else {
        const typeII = entry.p.includes("v1");
        const mode = verbModes[index % verbModes.length]!;
        if (mode === "negative") form = conjugate(reading, "Negative", typeII).at(-1) ?? "";
        if (mode === "te") form = conjugate(reading, "Te", typeII)[0] ?? "";
        if (mode === "ta") form = conjugate(reading, "Ta", typeII)[0] ?? "";
        if (mode === "tai") form = conjugateAuxiliaries(reading, ["Tai"], "Dictionary", typeII)[0] ?? "";
        if (mode === "masu") form = conjugateAuxiliaries(reading, ["Masu"], "Dictionary", typeII)[0] ?? "";
        if (mode === "teiru") {
          form = conjugateAuxiliaries(reading, ["TeIru"], "Dictionary", typeII)[0] ?? "";
          form = form.replace(/ている$/u, "てる").replace(/でいる$/u, "でる");
        }
      }
    } catch {
      continue;
    }
    const input = toRomaji(form).toLocaleLowerCase("en-US");
    if (!form || form === reading || dictionaryReadings.has(toHiragana(form)) || !/^[a-z-]{3,30}$/u.test(input) || used.has(input)) continue;
    used.add(input);
    queries.push({
      input,
      category: "morphology",
      expectedEntryId: entry.i,
      expectedSurface: preferredSurface(entry),
      expectedReading: toHiragana(form),
    });
  }
  return queries;
}

const imeCases: Array<[string, string, string]> = [
  ["gakkou", "学校", "がっこう"], ["gakko", "学校", "がっこう"], ["nihonn", "日本", "にほん"],
  ["konnichiha", "今日は", "こんにちは"], ["konnbannwa", "今晩は", "こんばんは"], ["kitte", "切手", "きって"],
  ["zasshi", "雑誌", "ざっし"], ["kekkon", "結婚", "けっこん"], ["matte", "待って", "まって"],
  ["intaanetto", "インターネット", "インターネット"], ["inntaanetto", "インターネット", "インターネット"],
  ["inta-netto", "インターネット", "インターネット"], ["suupaa", "スーパー", "スーパー"], ["su-pa-", "スーパー", "スーパー"],
  ["koohii", "コーヒー", "コーヒー"], ["ko-hi-", "コーヒー", "コーヒー"], ["geemu", "ゲーム", "ゲーム"],
  ["ge-mu", "ゲーム", "ゲーム"], ["meeru", "メール", "メール"], ["me-ru", "メール", "メール"],
  ["konpyuutaa", "コンピューター", "コンピューター"], ["konpyu-ta-", "コンピューター", "コンピューター"],
  ["pasokon", "パソコン", "パソコン"], ["konbini", "コンビニ", "コンビニ"], ["arubaito", "アルバイト", "アルバイト"],
  ["sarariman", "サラリーマン", "サラリーマン"], ["nootopasokon", "ノートパソコン", "ノートパソコン"],
  ["aishiteru", "愛してる", "あいしてる"], ["shitteru", "知ってる", "しってる"], ["tabeteru", "食べてる", "たべてる"],
];

const fuzzyCases: Array<[string, string, string]> = [
  ["gakou", "学校", "がっこう"], ["intaanet", "インターネット", "インターネット"],
  ["konnbini", "コンビニ", "コンビニ"], ["pasokonn", "パソコン", "パソコン"],
  ["benkyoo", "勉強", "べんきょう"], ["daigakuu", "大学", "だいがく"],
];

const chinese = [
  "学校", "预约", "預約", "学习", "學習", "报名", "報名", "提交", "处理", "處理", "对应", "對應", "实现", "實現", "系统", "系統",
  "网络", "網絡", "便利店", "电脑", "電腦", "咖啡", "老师", "朋友", "医院", "电车", "车站", "旅行", "计划", "作业", "词典",
  "词汇", "语法", "问题", "答案", "申请", "取消", "确认", "修改", "保存", "删除", "发送", "登录", "注册", "密码", "账号", "设置",
  "我差点忘了今天有课。", "请帮我预约明天下午。", "这个说法自然吗？", "我今天没有去学校。", "最近的便利店在哪里？", "请换成更口语的说法。",
  "我正在学习日语。", "这份资料明天提交。", "网络连接失败了。", "可以帮我修改这句话吗？", "我想报名这个课程。", "请告诉老师我会迟到。",
];

const english = [
  "school", "reservation", "study", "application", "submission", "system", "network", "convenience store", "computer", "coffee",
  "teacher", "friend", "hospital", "train", "station", "travel", "plan", "homework", "dictionary", "vocabulary", "grammar", "question", "answer",
  "natural", "claim", "consent", "power outlet", "part-time job", "notebook computer", "email", "game", "supermarket", "internet", "password",
  "account", "settings", "save", "delete", "send", "register", "sign in", "cancel", "confirm", "change", "good morning", "thank you",
  "I almost forgot I had class today.", "Where is the nearest convenience store?", "Could you make this sound more natural?", "I did not go to school today.",
  "Please tell my teacher that I will be late.", "I would like to reserve a table for two.",
];

const mixed = [
  "語彙purinto", "ごいpurinto", "goiプリント", "日本go", "nihongoのtest", "今天gakkou", "コンビニ de kaimono", "Englishを勉強する",
  "benkyouする", "日本jin", "東京eki", "英語tesuto", "べんきょうsuru", "コンビニde", "kanjiドリル", "coffeeを飲む",
  "学校de benkyou", "明日no yotei", "先生ni shitsumon", "友達to eiga", "予約wo cancel", "API設定をsave", "日本語and English",
  "中文と日本語", "今日はschool", "駅までtaxi", "パソコンde work", "資料wo submit", "登録shita", "ログインできnai",
];

const boundary = [
  "a", "N", "123", "000123", "😀", "!!!", "。！？", "中文 English", "日本語 English", "日本語 + English", "ＡＭＥＲＩＫＡ",
  "  gakkou   ", "学校\nに行きます", "hello世界", "日本 go", "goi  purinto", "\n\nこんにちは\n", "GAKKOU", "Gakkou", "ｇａｋｋｏｕ",
  "gakkou!!!", "gakkou?", "ＣＯＦＦＥＥ", "test_test", "---", "日本語123", "中文+romaji", "aishiteru...", "x", "かなカナ漢字ABC",
];

export async function buildQACorpus() {
  const entries = await loadQAEntries();
  const random = randomRomaji(entries, 150);
  const morphology = morphologyCorpus(entries, 120);
  const ime: QAQuery[] = imeCases.map(([input, expectedSurface, expectedReading]) => ({ input, category: "romaji-ime", expectedSurface, expectedReading }));
  const fuzzy: QAQuery[] = fuzzyCases.map(([input, expectedSurface, expectedReading]) => ({ input, category: "romaji-ime", expectedSurface, expectedReading, fuzzyExpected: true }));
  const japaneseEntries = uniqueBy(seededShuffle(entries.filter((entry) => cleanReading(entry) && preferredSurface(entry)), 0x1a2b_3c4d), preferredSurface).slice(0, 80);
  const japanese: QAQuery[] = japaneseEntries.map((entry) => ({ input: preferredSurface(entry), category: "japanese", expectedEntryId: entry.i, expectedSurface: preferredSurface(entry), expectedReading: cleanReading(entry) }));
  const all: QAQuery[] = [
    ...random, ...morphology, ...ime, ...fuzzy, ...japanese,
    ...chinese.map((input): QAQuery => ({ input, category: "chinese" })),
    ...english.map((input): QAQuery => ({ input, category: "english" })),
    ...mixed.map((input): QAQuery => ({ input, category: "mixed" })),
    ...boundary.map((input): QAQuery => ({ input, category: "boundary" })),
  ];
  return uniqueBy(all, (query) => query.input);
}

export function representativeRealQueries(corpus: QAQuery[], count = 120) {
  const quotas: Array<[QAQuery["category"][], number]> = [
    [["romaji-random", "romaji-ime", "morphology"], 55], [["japanese"], 20], [["chinese"], 15],
    [["english"], 15], [["mixed"], 10], [["boundary"], 5],
  ];
  const selected: QAQuery[] = [];
  for (const [categories, quota] of quotas) {
    const pool = seededShuffle(corpus.filter((query) => categories.includes(query.category)), 0xfeed_0000 + selected.length);
    selected.push(...pool.slice(0, quota));
  }
  return selected.slice(0, count);
}

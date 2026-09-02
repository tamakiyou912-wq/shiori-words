import type { KatakanaOrigin, TranslationResult } from "@/lib/types";

/** Small editorial layer for loanword facts that are not represented by JMdict glosses alone. */
const loanwordNotes: Record<string, { origin: KatakanaOrigin; note?: string }> = {
  コンセント: {
    origin: {
      actualEnglish: "electrical outlet / power outlet",
      explanation: "来源存在历史借用变化。现代日语表示电源插座；现代英语不能用 consent 表示插座。",
      waseiEigo: true,
    },
    note: "墙上的插座是「コンセント」，插头是「プラグ」。",
  },
  サラリーマン: {
    origin: {
      source: "salary + man",
      actualEnglish: "office worker / salaried employee",
      explanation: "日语中的和制英语，通常指领薪的公司职员。现代英语一般不用它作普通职业称呼。",
      waseiEigo: true,
    },
    note: "更中性的日语职业表达是「会社員」。",
  },
  ノートパソコン: {
    origin: {
      source: "notebook + personal computer",
      actualEnglish: "laptop / notebook computer",
      explanation: "「ノートパソコン」是日语缩略组合，英语中通常说 laptop。",
      waseiEigo: true,
    },
  },
  クレーム: {
    origin: {
      source: "claim",
      actualEnglish: "complaint / customer complaint",
      explanation: "日语常指顾客投诉；英语 claim 的范围和日语「クレーム」并不完全相同。",
      waseiEigo: false,
    },
  },
};

export function applyCuratedEnrichment(result: TranslationResult): TranslationResult {
  const surface = result.dictionary?.surface;
  const curated = surface ? loanwordNotes[surface] : undefined;
  if (!curated) return result;
  const notes = [...new Set([...(result.usageNotes ?? []), ...(curated.note ? [curated.note] : [])])];
  return {
    ...result,
    katakanaOrigin: result.katakanaOrigin ?? curated.origin,
    usageNotes: notes.length ? notes : undefined,
  };
}

export const curatedLoanwordCount = Object.keys(loanwordNotes).length;

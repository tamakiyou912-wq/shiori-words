import { toHiragana, toKatakana, toRomaji } from "wanakana";
import type { Language, TargetLanguage } from "@/lib/types";

export type ScriptKind = "han" | "hiragana" | "katakana" | "latin" | "number" | "space" | "punctuation" | "other";

export type ScriptSegment = {
  kind: ScriptKind;
  text: string;
  start: number;
  end: number;
};

const macronMap: Record<string, string> = {
  ā: "aa",
  ī: "ii",
  ū: "uu",
  ē: "ee",
  ō: "ou",
};

const smallKana = new Set(["ァ", "ィ", "ゥ", "ェ", "ォ", "ャ", "ュ", "ョ", "ヮ"]);

export function normalizeInput(input: string) {
  return input
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

function normalizeLatin(input: string) {
  return [...input.toLocaleLowerCase("en-US")]
    .map((character) => macronMap[character] ?? character)
    .join("");
}

/** A stable key for exact dictionary matching; it intentionally contains no word-specific corrections. */
export function normalizedLookupKey(input: string) {
  return normalizeLatin(normalizeInput(input))
    .replace(/[’']/g, "")
    .replace(/[\s._·・]/g, "")
    .replace(/-/g, "");
}

function classifyCharacter(character: string): ScriptKind {
  if (/\p{Script=Han}/u.test(character)) return "han";
  if (/[\u3040-\u309f]/u.test(character)) return "hiragana";
  if (character === "・" || character === "＝") return "punctuation";
  if (/[\u30a0-\u30ff\uff66-\uff9f]/u.test(character)) return "katakana";
  if (/\p{Script=Latin}/u.test(character) || character === "-" || character === "'") return "latin";
  if (/\p{Number}/u.test(character)) return "number";
  if (/\s/u.test(character)) return "space";
  if (/\p{P}|\p{S}/u.test(character)) return "punctuation";
  return "other";
}

/** Splits by writing system while keeping exact source offsets for UI recognition feedback. */
export function segmentScripts(input: string): ScriptSegment[] {
  const normalized = normalizeInput(input);
  const segments: ScriptSegment[] = [];
  let offset = 0;

  for (const character of normalized) {
    const start = offset;
    offset += character.length;
    const kind = classifyCharacter(character);
    const previous = segments.at(-1);
    if (previous && previous.kind === kind) {
      previous.text += character;
      previous.end = offset;
    } else {
      segments.push({ kind, text: character, start, end: offset });
    }
  }
  return segments;
}

/** Treats a phone-keyboard hyphen as a Japanese long vowel mark. */
export function expandRomajiLongMarks(input: string) {
  let output = "";
  let previousVowel = "";
  for (const character of normalizeLatin(input)) {
    if (/[aeiou]/u.test(character)) previousVowel = character;
    if (character === "-") {
      if (previousVowel) output += previousVowel;
    } else if (/[a-z]/u.test(character)) {
      output += character;
    }
  }
  return output;
}

function morae(input: string) {
  const result: string[] = [];
  for (const character of input) {
    if (smallKana.has(character) && result.length > 0) result[result.length - 1] += character;
    else result.push(character);
  }
  return result;
}

function moraVowel(mora: string) {
  const romaji = toRomaji(mora).toLocaleLowerCase("en-US");
  return [...romaji].reverse().find((character) => /[aeiou]/u.test(character));
}

/** Converts doubled katakana vowels to ー without changing hiragana or consonants. */
export function collapseKatakanaLongVowels(input: string) {
  const units = morae(input);
  const vowelKana: Record<string, string> = { ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o" };
  const output: string[] = [];
  for (const unit of units) {
    const previous = output.at(-1);
    const expected = vowelKana[unit];
    if (previous && expected && previous !== "ー" && moraVowel(previous) === expected) output.push("ー");
    else output.push(unit);
  }
  return output.join("");
}

function normalizeAmbiguousN(input: string) {
  return input
    .replace(/([bcdfghjklmpqrstvwxyz])\1{2,}/g, "$1$1")
    .replace(/n{3,}/g, "nn")
    .replace(/nn(?=[bmp])/g, "n")
    .replace(/nn$/g, "n");
}

export type RomajiForms = {
  raw: string;
  latinCandidates: string[];
  hiraganaCandidates: string[];
  katakanaCandidates: string[];
  lookupKeys: string[];
};

export function romajiForms(input: string): RomajiForms {
  const raw = normalizeLatin(normalizeInput(input));
  const compact = raw.replace(/[\s._·・’']/g, "");
  const expanded = expandRomajiLongMarks(compact);
  const unmarked = compact.replace(/-/g, "");
  const longMarkFirst = compact.includes("-") ? [expanded, unmarked] : [unmarked, expanded];
  const latinCandidates = [...new Set([
    ...longMarkFirst,
    normalizeAmbiguousN(unmarked),
    normalizeAmbiguousN(expanded),
  ].filter((candidate) => /^[a-z]+$/u.test(candidate)))];

  const hiragana = new Set<string>();
  const katakana = new Set<string>();
  for (const latin of latinCandidates) {
    for (const IMEMode of [false, true] as const) {
      const hira = toHiragana(latin, { IMEMode });
      if (/^[\u3040-\u309fー]+$/u.test(hira)) hiragana.add(hira);
      const kata = toKatakana(latin, { IMEMode });
      if (/^[\u30a0-\u30ffー]+$/u.test(kata)) {
        katakana.add(kata);
        katakana.add(collapseKatakanaLongVowels(kata));
      }
    }
  }

  return {
    raw,
    latinCandidates,
    hiraganaCandidates: [...hiragana],
    katakanaCandidates: [...katakana],
    lookupKeys: [...new Set(latinCandidates.map(normalizedLookupKey))],
  };
}

export function romajiToKanaCandidates(input: string) {
  const forms = romajiForms(input);
  return [...forms.hiraganaCandidates, ...forms.katakanaCandidates];
}

export function romajiScriptChoices(input: string) {
  const segments = segmentScripts(input);
  if (segments.length !== 1 || segments[0]?.kind !== "latin") return null;
  const forms = romajiForms(input);
  return {
    hiragana: forms.hiraganaCandidates[0] ?? toHiragana(input),
    katakana: forms.katakanaCandidates.find((value) => value.includes("ー")) ?? forms.katakanaCandidates[0] ?? toKatakana(input),
  };
}

export function detectLanguage(input: string): Language {
  const normalized = normalizeInput(input);
  if (!normalized) return "unknown";
  const segments = segmentScripts(normalized).filter((segment) => !["space", "punctuation", "number"].includes(segment.kind));
  const kinds = new Set(segments.map((segment) => segment.kind));
  if (kinds.has("hiragana") || kinds.has("katakana")) return "ja";
  if (kinds.has("han") && kinds.has("latin")) return "unknown";
  if (kinds.size === 1 && kinds.has("han")) return "zh";
  if (kinds.size === 1 && kinds.has("latin")) {
    const words = normalized.trim().split(/\s+/u);
    return words.length === 1 && /^[\p{Script=Latin}’'-]+$/u.test(words[0]) ? "romaji" : "en";
  }
  return "unknown";
}

export function resolveTarget(source: Language, requested: TargetLanguage): Exclude<TargetLanguage, "auto"> {
  if (requested !== "auto") return requested;
  if (source === "zh" || source === "romaji" || source === "unknown") return "ja";
  if (source === "ja") return "zh";
  return "ja";
}

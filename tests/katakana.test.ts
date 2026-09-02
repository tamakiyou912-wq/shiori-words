import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { katakanaPresentation, normalizeKatakanaInfo, titleLengthClass } from "@/lib/language/katakana";
import { TranslationResultView } from "@/components/translation-result";
import { assembleResult, parseProviderContent, reasoningPolicy, OpenAICompatibleProvider, userPrompt } from "@/lib/ai/provider";
import { CACHE_SCHEMA_VERSION, queryCacheKey } from "@/lib/query/cache";
import type { TranslationResult } from "@/lib/types";
import { prepareQuery, mergeAIResult } from "@/lib/query/pipeline";
import { applyCuratedEnrichment } from "@/lib/language/dictionary";

afterEach(() => vi.unstubAllGlobals());

describe("katakana learning presentation", () => {
  it("keeps construction separate from modern English", () => {
    const result = parseProviderContent(JSON.stringify({translation:"モバイルバッテリー",katakanaInfo:{sourceExpression:"mobile battery",naturalEnglish:["power bank","portable charger"],kind:"wasei",usageNote:"日语构词不等于英语日常说法。"}}));
    const assembled = assembleResult("モバイルバッテリー", "auto", result.sections);
    expect(assembled.katakanaInfo?.sourceExpression).toBe("mobile battery");
    expect(katakanaPresentation(assembled)?.naturalEnglish).toEqual(["power bank", "portable charger"]);
  });
  it.each(["output","result","data"])("recovers a valid result wrapped in %s without a second request",(wrapper)=>{
    const content=JSON.stringify({task:"word",input:"mobairubatteri",[wrapper]:{dictionary:{surface:"モバイルバッテリー",chineseMeaning:"充电宝"},katakanaInfo:{sourceExpression:"mobile battery",naturalEnglish:["power bank"]}}});
    const parsed=parseProviderContent(content);
    expect(parsed.textFallback).toBe(false);
    expect(parsed.result.dictionary?.chineseMeaning).toBe("充电宝");
    expect(parsed.result.katakanaInfo?.sourceExpression).toBe("mobile battery");
  });
  it("deduplicates equivalent source and English without losing distinct synonyms", () => {
    const view = katakanaPresentation({katakanaInfo:{sourceExpression:"Internet",naturalEnglish:["internet", "Internet.","the Net"]}});
    expect(view?.naturalEnglish).toEqual(["the Net"]);
    expect(katakanaPresentation({katakanaInfo:{sourceExpression:"television（缩写）",naturalEnglish:["television","TV"]}})?.naturalEnglish).toEqual(["TV"]);
  });
  it("recovers nested enrichment alongside valid root fields",()=>{
    const parsed=parseProviderContent(JSON.stringify({translation:"スマホ",dictionary:{surface:"スマホ",chineseMeaning:"智能手机",katakanaInfo:{sourceExpression:"smartphone",kind:"abbreviation"},examples:[{japanese:"スマホを買った。",chinese:"买了智能手机。"}]},output:{translation:"must not replace root",usageNotes:["日语缩略词"]}}));
    expect(parsed.result.translation).toBe("スマホ");
    expect(parsed.result.katakanaInfo?.kind).toBe("abbreviation");
    expect(parsed.result.examples).toHaveLength(1);
    expect(parsed.result.usageNotes).toEqual(["日语缩略词"]);
  });
  it.each([null, false, [], 42, "bad"])("ignores an invalid optional object %j", (value) => {
    expect(normalizeKatakanaInfo(value)).toBeUndefined();
    expect(parseProviderContent(JSON.stringify({translation:"ホテル",katakanaInfo:value})).result.translation).toBe("ホテル");
  });
  it("keeps valid siblings when optional fields have the wrong type", () => {
    expect(normalizeKatakanaInfo({sourceExpression:"hotel",naturalEnglish:[null,5,"hotel"],sourceLanguage:[],kind:"unknown",isWaseiEigo:"false"})).toMatchObject({sourceExpression:"hotel",naturalEnglish:["hotel"],sourceLanguage:undefined,isWaseiEigo:undefined,kind:undefined});
  });
  it("does not present a contradictory construction as an unchanged English loan",()=>{
    const info=normalizeKatakanaInfo({sourceExpression:"paper driver",naturalEnglish:["licensed but inexperienced driver"],kind:"loan"});
    expect(info?.kind).toBeUndefined();
    expect(info?.usageNote).toContain("不一定是日常英语");
    expect(katakanaPresentation({dictionary:{surface:"スマホ",englishMeaning:"smartphone / smart phone"}})?.naturalEnglish).toEqual(["smartphone"]);
  });
  it("supports non-English provenance without assigning English by default", () => {
    expect(katakanaPresentation({katakanaInfo:{sourceLanguage:"German",sourceExpression:"Arbeit",naturalEnglish:["part-time job"],kind:"nonEnglish"}})?.sourceLanguage).toBe("German");
    expect(katakanaPresentation({katakanaOrigin:{source:"camera",explanation:""}})?.sourceLanguage).toBeUndefined();
  });
  it("reads legacy saved history and preserves fallback English", () => {
    expect(katakanaPresentation({dictionary:{surface:"コンセント",englishMeaning:"power outlet"},katakanaOrigin:{explanation:"歴史借用",actualEnglish:"electrical outlet / power outlet"}})?.naturalEnglish).toEqual(["electrical outlet","power outlet"]);
    expect(katakanaPresentation({dictionary:{surface:"ホテル",englishMeaning:"hotel"}})?.naturalEnglish).toEqual(["hotel"]);
    expect(katakanaPresentation({dictionary:{surface:"学校",englishMeaning:"school"}})).toBeUndefined();
  });
  it("does not let AI replace reviewed loanword distinctions with a false friend",()=>{
    const result=applyCuratedEnrichment({original:"クレーム",translation:"クレーム",detectedLanguage:"ja",targetLanguage:"zh",dictionary:{surface:"クレーム"},katakanaInfo:{sourceExpression:"claim",naturalEnglish:["claim"],kind:"loan"}});
    expect(result.katakanaInfo?.kind).toBe("shift");
    expect(katakanaPresentation(result)?.naturalEnglish).toContain("complaint");
  });
  it.each(["学校","こんにちは","モバイルバッテリー","インターネット","語彙プリント"])("hides Romaji by default with a keyboard accessible toggle: %s", (surface) => {
    const html = renderToStaticMarkup(createElement(TranslationResultView,{result:{dictionary:{surface,reading:"がっこう",romaji:"gakkou"}}}));
    expect(html).toContain('aria-label="显示罗马字"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toMatch(/class="entry-romaji"[^>]*hidden=""/);
  });
  it("shows source, distinct English and Chinese in this order", () => {
    const html=renderToStaticMarkup(createElement(TranslationResultView,{result:{dictionary:{surface:"モバイルバッテリー",chineseMeaning:"充电宝"},katakanaInfo:{sourceExpression:"mobile battery",naturalEnglish:["power bank"]}}}));
    expect(html.indexOf("mobile battery")).toBeLessThan(html.indexOf("power bank"));
    expect(html.indexOf("power bank")).toBeLessThan(html.indexOf("充电宝"));
  });
  it("retains a direct katakana spelling when the dictionary uses a kanji variant",()=>{
    const html=renderToStaticMarkup(createElement(TranslationResultView,{result:{original:"コーヒー",dictionary:{surface:"珈琲",reading:"コーヒー",chineseMeaning:"咖啡"},katakanaInfo:{sourceExpression:"koffie",naturalEnglish:["coffee"]}}}));
    expect(html).toMatch(/<h1[^>]*>コーヒー<\/h1>/);
    expect(html).toContain("咖啡");
  });
  it.each([["学校","title-short"],["こんにちは","title-medium"],["モバイルバッテリー","title-long"],["コミュニケーション","title-long"],["コンピューターサイエンス","title-long"]])("sizes %s with a generic length rule",(word,expected)=>expect(titleLengthClass(word)).toBe(expected));
  it("invalidates the old result cache", () => {
    expect(CACHE_SCHEMA_VERSION).not.toBe("query-v9");
    expect(queryCacheKey("hotel","ja","deepseek","flash")).toContain(CACHE_SCHEMA_VERSION);
  });
});

describe("bounded adaptive provider policy", () => {
  it.each(["gakkou","mobairubatteri","konbini","学校","预约","reservation","Could I charge my phone here?"])("uses non-thinking for %s",(input)=>expect(reasoningPolicy({input,targetLanguage:"ja"})).toBe("disabled"));
  it("uses reasoning only for a nuanced contextual follow-up or complex long input", async () => {
    const context: TranslationResult={original:"test",translation:"試験",detectedLanguage:"en",targetLanguage:"ja"};
    const request={input:"test",targetLanguage:"ja" as const,context,followUp:"为什么这个表达不自然？"};
    expect(reasoningPolicy(request)).toBe("low");
    expect(reasoningPolicy({...request,followUp:"再给一个例句"})).toBe("disabled");
    expect(reasoningPolicy({input:"長い文。".repeat(70),targetLanguage:"ja"})).toBe("low");
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({choices:[{message:{content:'{"translation":"説明"}'}}]})));
    await new OpenAICompatibleProvider({provider:"deepseek",baseUrl:"https://api.example.test",apiKey:"test-fixture",model:"deepseek-v4-flash"}).complete(request);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({thinking:{type:"enabled"},reasoning_effort:"low"});
  });
  it("sends concise known facts without repeating recognition and romaji",()=>{
    const prompt=userPrompt({input:"gakkou",targetLanguage:"ja",seed:{detectedLanguage:"romaji",dictionary:{surface:"学校",reading:"がっこう",romaji:"gakkou",englishMeaning:"school"}}});
    expect(prompt).not.toContain('"romaji":"gakkou"');
    expect(prompt).not.toContain('"recognition"');
    expect(prompt).toContain('"reading":"がっこう"');
  });
  it("requests katakana learning fields even when JMdict prefers kanji",()=>{
    const prompt=JSON.parse(userPrompt({input:"コーヒー",targetLanguage:"auto",seed:{dictionary:{surface:"珈琲",reading:"コーヒー"}}}));
    expect(prompt.output.katakanaInfo).toBeTruthy();
    expect(prompt.output.katakanaInfo.sourceLanguage).toContain("certain");
    expect(prompt.output.katakanaInfo.naturalEnglish[0]).toContain("JAPANESE meaning");
    expect(prompt.output.dictionary.chineseMeaning).toContain("required");
  });
});

describe("Romaji regression without changing the parser", () => {
  it.each(["mobairubatteri","mobairubatterii","mobairubatteri-","mobairu batteri","intaanetto","inntaanetto","konpyuutaa","nootopasokon","pasokon","konbini","sumaho","eakon"])("keeps a usable local result for %s", async(input)=>{
    const plan=await prepareQuery(input,"auto");
    expect(plan.baseResult.translation).toBeTruthy();
    expect(plan.detectedLanguage).toBe("romaji");
  });
  it.each(["mobairubatterii","mobairubatteri-","mobairu batteri"])("allows same-reading orthography repair of a tentative composition: %s",async(input)=>{
    const {baseResult}=await prepareQuery(input,"auto");
    const result=mergeAIResult(baseResult,{dictionary:{surface:"モバイルバッテリー",reading:"モバイルバッテリー",chineseMeaning:"移动电源"}});
    expect(result.dictionary?.surface).toBe("モバイルバッテリー");
    expect(result.recognition?.resolved).toBe("モバイルバッテリー");
    expect(result.meanings?.some(m=>m.japanese==="射る")).not.toBe(true);
  });
  it("cannot rewrite an exact dictionary hit or change a composition's pronunciation",async()=>{
    const exact=(await prepareQuery("gakkou","auto")).baseResult;
    expect(mergeAIResult(exact,{dictionary:{surface:"別の語",reading:"がっこう"}}).dictionary?.surface).toBe("学校");
    const composed=(await prepareQuery("goipurinto","auto")).baseResult;
    expect(mergeAIResult(composed,{dictionary:{surface:"買い物",reading:"かいもの"}}).dictionary?.surface).toBe("語彙プリント");
  });
});

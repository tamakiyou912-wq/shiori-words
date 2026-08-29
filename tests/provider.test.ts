import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleResult, normalizeProviderSection, OpenAICompatibleProvider, parseProviderContent, systemPrompt, userPrompt } from "@/lib/ai/provider";
import { normalizeProviderModel } from "@/lib/credentials";

afterEach(() => vi.unstubAllGlobals());

describe("one-call OpenAI-compatible provider", () => {
  it("uses one non-streaming structured request and records provider usage", async () => {
    const payload = {
      choices: [{ message: { content: JSON.stringify({
        translation: "学校",
        dictionary: { surface: "学校", reading: "がっこう", romaji: "gakkou", chineseMeaning: "学校", englishMeaning: "school" },
        usageNotes: ["简洁"],
      }) } }],
      usage: { prompt_tokens: 210, prompt_cache_hit_tokens: 120, completion_tokens: 80 },
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
    const provider = new OpenAICompatibleProvider({ provider: "deepseek", baseUrl: "https://api.example.test", model: "fast-model", apiKey: "secret" });
    const output = await provider.complete({ input: "school", targetLanguage: "ja" });
    expect(output.result.dictionary).toMatchObject({ surface: "学校", englishMeaning: "school" });
    expect(output.usage).toEqual({ inputTokens: 210, cachedInputTokens: 120, outputTokens: 80 });
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    const request = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      thinking: { type: "disabled" },
      stream: false,
      response_format: { type: "json_object" },
    });
  });

  it("repairs mildly malformed JSON without another AI request", () => {
    const parsed = parseProviderContent('{translation:"予約", examples:[{"japanese":"予約します",}],}');
    expect(parsed.repaired).toBe(true);
    expect(parsed.result.translation).toBe("予約");
    expect(parsed.result.examples).toEqual([{ japanese: "予約します" }]);
  });

  it("falls back to provider text when structured output is unrecoverable", () => {
    const parsed = parseProviderContent("这是仍然可显示的主要翻译结果");
    expect(parsed.textFallback).toBe(true);
    expect(parsed.result.translation).toContain("主要翻译结果");
  });

  it("normalizes malformed optional fields independently", () => {
    expect(normalizeProviderSection({ section: "meanings", data: "更自然的口语表达" })).toEqual({
      section: "meanings",
      data: [{ chinese: "更自然的口语表达" }],
    });
    expect(normalizeProviderSection({ section: "usageNotes", data: "用于朋友间对话" })).toEqual({
      section: "usageNotes",
      data: ["用于朋友间对话"],
    });
    expect(normalizeProviderSection({ section: "examples", data: null })).toBeNull();
  });

  it("assembles a non-empty fallback even if translation is absent", () => {
    const result = assembleResult("学校", "zh", [
      { section: "dictionary", data: { surface: "学校", reading: "がっこう", englishMeaning: "school" } },
      { section: "examples", data: "毎日学校に行きます。" },
    ]);
    expect(result.translation).toBe("学校");
    expect(result.examples).toEqual([{ japanese: "毎日学校に行きます。" }]);
  });

  it("keeps the cacheable system prefix stable and the dynamic data in the user message", () => {
    expect(systemPrompt()).not.toMatch(/timestamp|user id|202\d/iu);
    expect(userPrompt({ input: "gakkou", targetLanguage: "auto" })).toContain('"input":"gakkou"');
    expect(systemPrompt().length).toBeLessThan(1100);
  });

  it("rejects malformed saved API keys before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleProvider({ provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", apiKey: "这里不是 API Key" });
    await expect(provider.testConnection()).rejects.toThrow("API Key 格式不正确");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upgrades legacy DeepSeek model aliases", () => {
    expect(normalizeProviderModel("deepseek", "deepseek-chat")).toBe("deepseek-v4-flash");
    expect(normalizeProviderModel("deepseek", "deepseek-reasoner")).toBe("deepseek-v4-pro");
    expect(normalizeProviderModel("openai-compatible", "deepseek-chat")).toBe("deepseek-chat");
  });
});

import { describe, expect, it } from "vitest";
import { streamResponse } from "@/app/api/translate/route";

describe("server result stream", () => {
  it("exposes a local section before asynchronous enrichment finishes", async () => {
    let finish!: () => void;
    const enrichment = new Promise<void>((resolve) => { finish = resolve; });
    const response = streamResponse(async (send) => {
      send({ type: "section", data: { key: "primary", value: "学校" } });
      await enrichment;
      send({
        type: "done",
        data: {
          result: {
            detectedLanguage: "romaji",
            targetLanguage: "ja",
            original: "gakkou",
            normalizedInput: "gakkou",
            translation: "学校",
          },
        },
      });
    });
    const reader = response.body!.getReader();

    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("first chunk was buffered")), 100)),
    ]);
    expect(new TextDecoder().decode(first.value)).toContain('"type":"section"');

    finish();
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toContain('"type":"done"');
  });
});

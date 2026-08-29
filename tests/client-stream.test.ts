import { describe, expect, it } from "vitest";
import { consumeStream } from "@/components/translator-app";
import type { StreamEvent } from "@/lib/types";

function responseFromChunks(chunks: string[]) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }));
}

describe("browser result stream", () => {
  it("keeps valid partial events when a separate line is malformed", async () => {
    const events: StreamEvent[] = [];
    const response = responseFromChunks([
      '{"type":"section","data":{"key":"translation","value":"学校"}}\n{broken',
      '\n{"type":"done","data":{"result":{"detectedLanguage":"romaji","targetLanguage":"ja","original":"gakkou","translation":"学校"}}}\n',
    ]);
    await consumeStream(response, (event) => events.push(event));
    expect(events.map((event) => event.type)).toEqual(["section", "done"]);
  });

  it("reports an interrupted stream instead of silently showing a blank page", async () => {
    const response = responseFromChunks(['{"type":"section","data":{"key":"translation","value":"学校"}}\n']);
    await expect(consumeStream(response, () => undefined)).rejects.toThrow("响应中断");
  });
});

import { describe, expect, it } from "vitest";
import { consumeStream } from "@/components/translator-app";
import { parseProviderContent } from "@/lib/ai/provider";
import type { StreamEvent } from "@/lib/types";

function chunkedResponse(chunks: string[]) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }));
}

describe("300-request lifecycle and malformed-output stress", () => {
  it("always finishes, degrades, or reports a controlled interruption", async () => {
    let completed = 0;
    let controlledInterruptions = 0;
    for (let index = 0; index < 300; index += 1) {
      const mode = index % 6;
      if (mode === 0) {
        const parsed = parseProviderContent(`{translation:"结果 ${index}",examples:null,}`);
        expect(parsed.result.translation).toContain(String(index));
        completed += 1;
        continue;
      }
      if (mode === 1) {
        const parsed = parseProviderContent(`纯文本 fallback ${index}`);
        expect(parsed.result.translation).toContain(String(index));
        completed += 1;
        continue;
      }
      const events: StreamEvent[] = [];
      if (mode === 2) {
        await consumeStream(chunkedResponse([
          `{"type":"section","data":{"key":"translation","value":"${index}`,
          `"}}\n{bad optional line}\n{"type":"done","data":{"result":{"translation":"${index}"}}}\n`,
        ]), (event) => events.push(event));
        expect(events.at(-1)?.type).toBe("done");
        completed += 1;
        continue;
      }
      if (mode === 3) {
        await expect(consumeStream(chunkedResponse([`{"type":"section","data":{"key":"translation","value":"${index}"}}\n`]), () => undefined)).rejects.toThrow("响应中断");
        controlledInterruptions += 1;
        continue;
      }
      if (mode === 4) {
        const controller = new AbortController();
        controller.abort();
        await expect(consumeStream(chunkedResponse([`{"type":"done","data":{"result":{"translation":"stale ${index}"}}}\n`]), () => undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        controlledInterruptions += 1;
        continue;
      }
      const parsed = parseProviderContent(JSON.stringify({ dictionary: { surface: `語${index}` }, meanings: "部分结果", examples: [] }));
      expect(parsed.result.dictionary?.surface).toBe(`語${index}`);
      completed += 1;
    }
    expect(completed).toBe(200);
    expect(controlledInterruptions).toBe(100);
  }, 30_000);
});

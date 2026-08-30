import { describe, expect, it } from "vitest";
import { consumeStream, QueryTimeoutError } from "@/components/translator-app";
import type { StreamEvent } from "@/lib/types";

function lifecycleResponse(index: number, mode: number) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      if (mode === 0) {
        controller.enqueue(encoder.encode(`{"type":"done","data":{"result":{"translation":"结果 ${index}"}}}\n`));
        controller.close();
        return;
      }
      if (mode === 1) {
        controller.enqueue(encoder.encode(`{"type":"section","data":{"key":"translation","value":"基础结果 ${index}"}}\n`));
        return;
      }
      if (mode === 2) {
        controller.enqueue(encoder.encode(`{broken optional line}\n{"type":"done","data":{"result":{"translation":"恢复 ${index}"}}}\n`));
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`{"type":"error","message":"受控错误 ${index}"}\n`));
      controller.close();
    },
  }));
}

describe("100-query terminal-state stress", () => {
  it("settles every success, partial stream, malformed stream, and server error", async () => {
    const states = { success: 0, timeout: 0, error: 0 };
    for (let index = 0; index < 100; index += 1) {
      const mode = index % 4;
      const events: StreamEvent[] = [];
      try {
        await consumeStream(lifecycleResponse(index, mode), (event) => {
          if (event.type === "error") throw new Error(event.message);
          events.push(event);
        }, undefined, 5);
        expect(events.at(-1)?.type).toBe("done");
        states.success += 1;
      } catch (error) {
        if (error instanceof QueryTimeoutError) {
          expect(events.some((event) => event.type === "section")).toBe(true);
          states.timeout += 1;
        } else {
          expect(error).toBeInstanceOf(Error);
          states.error += 1;
        }
      }
    }
    expect(states).toEqual({ success: 50, timeout: 25, error: 25 });
  });
});

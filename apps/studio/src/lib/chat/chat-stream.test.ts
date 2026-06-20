import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { respondStreamHandler } from "../../test/msw/handlers";
import { streamRespond } from "./stream";

const server = setupServer(respondStreamHandler());

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers(respondStreamHandler()));
afterAll(() => server.close());

describe("streamRespond (msw SSE)", () => {
  it("streams narrator chunks + phases and resolves with the final floor", async () => {
    const chunks: string[] = [];
    const phases: string[] = [];
    let startFloorNo: number | undefined;

    const result = await streamRespond({
      sessionId: "s1",
      message: "hi",
      callbacks: {
        onStart: (payload) => {
          startFloorNo = payload.floorNo;
        },
        onChunk: (delta) => chunks.push(delta),
        onPhase: (phase) => phases.push(phase),
      },
    });

    expect(chunks.join("")).toBe("Hello world");
    expect(phases).toContain("generating");
    expect(startFloorNo).toBe(1);
    expect(result.floorId).toBe("f1");
    expect(result.floorNo).toBe(1);
    expect(result.generatedText).toBe("Hello world");
  });

  it("surfaces stream error events and rejects", async () => {
    server.use(
      respondStreamHandler([
        { event: "start", data: { floor_id: "f1", floor_no: 1 } },
        { event: "error", data: { code: "boom", message: "stream failed" } },
      ]),
    );

    const errors: string[] = [];
    await expect(
      streamRespond({
        sessionId: "s1",
        message: "hi",
        callbacks: { onError: (message) => errors.push(message) },
      }),
    ).rejects.toThrow();
    expect(errors).toContain("stream failed");
  });
});

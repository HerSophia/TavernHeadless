import { describe, expect, it } from "vitest";

import { TavernApiError } from "@tavern/sdk";

import * as clientHelpers from "../index.js";
import { mapApiErrorToUiState } from "../errors/map-api-error-to-ui-state.js";
import { getActivePage } from "../selectors/get-active-page.js";
import { createInitialRespondStreamState, reduceRespondStream } from "../stream/reduce-respond-stream.js";
import { buildTimelineMessages } from "../timeline/build-timeline-messages.js";
import { resolveUsage } from "../usage/resolve-usage.js";

describe("client-helpers public exports", () => {
  it("exposes the expected runtime helpers", () => {
    expect(clientHelpers).toMatchObject({
      buildTimelineMessages: expect.any(Function),
      createInitialRespondStreamState: expect.any(Function),
      getActivePage: expect.any(Function),
      mapApiErrorToUiState: expect.any(Function),
      reduceRespondStream: expect.any(Function),
      resolveUsage: expect.any(Function),
    });
  });
});

describe("resolveUsage", () => {
  it("normalizes mixed usage fields", () => {
    expect(
      resolveUsage({
        completion_tokens: 4,
        prompt_tokens: 6,
      }),
    ).toMatchObject({
      inputTokens: 6,
      outputTokens: 4,
      totalTokens: 10,
    });
  });

  it("prefers explicit input output and total tokens when available", () => {
    expect(
      resolveUsage({
        input_tokens: 3,
        output_tokens: 2,
        total_tokens: 99,
      }),
    ).toMatchObject({
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 99,
    });
  });

  it("returns zeroed usage for nullish input", () => {
    expect(resolveUsage(null)).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });
});

describe("getActivePage", () => {
  it("returns activePage when it exists", () => {
    const activePage = { id: "active" };
    const fallbackPage = { id: "fallback" };

    expect(
      getActivePage({
        activePage,
        pages: [fallbackPage],
      }),
    ).toBe(activePage);
  });

  it("falls back to the first page when activePage is missing", () => {
    const firstPage = { id: "page-1" };
    const secondPage = { id: "page-2" };

    expect(
      getActivePage({
        pages: [firstPage, secondPage],
      }),
    ).toBe(firstPage);
  });

  it("returns null when pages are empty nullish or malformed", () => {
    expect(getActivePage({ pages: [] })).toBeNull();
    expect(getActivePage({ pages: null })).toBeNull();
    expect(getActivePage({ pages: [undefined] as unknown as Array<{ id: string }> })).toBeNull();
  });
});

describe("buildTimelineMessages", () => {
  it("builds timeline messages from active pages", () => {
    const timeline = buildTimelineMessages([
      {
        activePage: {
          id: "page-1",
          messages: [
            {
              content: "hello",
              contentFormat: "markdown",
              id: "msg-1",
              role: "assistant",
              seq: 1,
            },
          ],
          pageKind: "main",
          pageNo: 1,
          version: 1,
        },
        createdAt: 100,
        floorNo: 1,
        id: "floor-1",
        pageCount: 1,
        state: "completed",
        tokenIn: 5,
        tokenOut: 7,
      },
    ]);

    expect(timeline).toEqual([
      {
        at: 100,
        content: "hello",
        contentFormat: "markdown",
        floorId: "floor-1",
        floorNo: 1,
        floorState: "completed",
        id: "msg-1",
        pageId: "page-1",
        role: "assistant",
        seq: 1,
        tokenIn: 5,
        tokenOut: 7,
      },
    ]);
  });

  it("skips unsupported entries and normalizes unknown content formats", () => {
    const timeline = buildTimelineMessages([
      {
        activePage: null,
        createdAt: 10,
        floorNo: 1,
        id: "floor-skip",
        pageCount: 0,
        state: "completed",
        tokenIn: 0,
        tokenOut: 0,
      },
      {
        activePage: {
          id: "page-2",
          messages: [
            {
              content: "skip me",
              contentFormat: "markdown",
              id: "msg-skip",
              role: "tool",
              seq: 1,
            } as unknown as {
              content: string;
              contentFormat: string;
              id: string;
              role: string;
              seq: number;
            },
            {
              content: "plain fallback",
              contentFormat: "html",
              id: "msg-2",
              role: "user",
              seq: 2,
            },
            {
              content: "{\"ok\":true}",
              contentFormat: "json",
              id: "msg-3",
              role: "system",
              seq: 3,
            },
          ],
          pageKind: "branch",
          pageNo: 2,
          version: 4,
        },
        createdAt: 200,
        floorNo: 2,
        id: "floor-2",
        pageCount: 1,
        state: "completed",
        tokenIn: 11,
        tokenOut: 12,
      },
    ]);

    expect(timeline).toEqual([
      {
        at: 200,
        content: "plain fallback",
        contentFormat: "text",
        floorId: "floor-2",
        floorNo: 2,
        floorState: "completed",
        id: "msg-2",
        pageId: "page-2",
        role: "user",
        seq: 2,
        tokenIn: 11,
        tokenOut: 12,
      },
      {
        at: 200,
        content: "{\"ok\":true}",
        contentFormat: "json",
        floorId: "floor-2",
        floorNo: 2,
        floorState: "completed",
        id: "msg-3",
        pageId: "page-2",
        role: "system",
        seq: 3,
        tokenIn: 11,
        tokenOut: 12,
      },
    ]);
  });
});

describe("reduceRespondStream", () => {
  it("reduces stream events into final state", () => {
    const state1 = reduceRespondStream(createInitialRespondStreamState(), {
      payload: { branchId: "branch-1", floorId: "floor-1", floorNo: 2 },
      type: "start",
    });
    const state2 = reduceRespondStream(state1, {
      payload: { chunk: "Hello" },
      type: "chunk",
    });
    const state3 = reduceRespondStream(state2, {
      payload: {
        floorId: "floor-1",
        floorNo: 2,
        generatedText: "Hello",
        totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
      type: "done",
    });

    expect(state3.branchId).toBe("branch-1");
    expect(state3.status).toBe("done");
    expect(state3.result?.generatedText).toBe("Hello");
    expect(state3.result?.totalTokens).toBe(15);
  });

  it("promotes idle chunks to streaming accumulates summaries and falls back to accumulated content", () => {
    const state1 = reduceRespondStream(createInitialRespondStreamState(), {
      payload: { chunk: "Hello" },
      type: "chunk",
    });
    const state2 = reduceRespondStream(state1, {
      payload: { chunk: " world" },
      type: "chunk",
    });
    const state3 = reduceRespondStream(state2, {
      payload: { summaries: ["s1", "s2"] },
      type: "summary",
    });
    const state4 = reduceRespondStream(state3, {
      payload: {
        floorId: "floor-9",
        floorNo: 9,
        totalUsage: {},
      },
      type: "done",
    });

    expect(state1.status).toBe("streaming");
    expect(state3.summaries).toEqual(["s1", "s2"]);
    expect(state4.content).toBe("Hello world");
    expect(state4.result).toMatchObject({
      floorId: "floor-9",
      floorNo: 9,
      generatedText: "Hello world",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });

  it("captures error payload and uses fallback error message", () => {
    const state = reduceRespondStream(createInitialRespondStreamState(), {
      payload: { code: "stream_failed" },
      type: "error",
    });

    expect(state).toMatchObject({
      error: {
        code: "stream_failed",
        message: "Stream request failed",
      },
      status: "error",
    });
  });
});

describe("mapApiErrorToUiState", () => {
  it.each([
    [401, "authentication", false],
    [403, "authorization", false],
    [404, "not_found", false],
    [409, "conflict", true],
    [400, "validation", false],
    [422, "validation", false],
    [503, "server", true],
    [418, "unknown", false],
  ] as const)("maps TavernApiError status %i", (status, kind, retryable) => {
    const mapped = mapApiErrorToUiState(
      new TavernApiError({
        code: "ERR_TEST",
        message: `status-${status}`,
        status,
      }),
    );

    expect(mapped).toEqual({
      code: "ERR_TEST",
      kind,
      message: `status-${status}`,
      retryable,
      status,
    });
  });

  it("maps TypeError to network state", () => {
    expect(mapApiErrorToUiState(new TypeError("Connection lost"))).toEqual({
      kind: "network",
      message: "Connection lost",
      retryable: true,
    });
  });

  it("maps generic Error to unknown state", () => {
    expect(mapApiErrorToUiState(new Error("Boom"))).toEqual({
      kind: "unknown",
      message: "Boom",
      retryable: false,
    });
  });

  it("maps non-error values to a generic unknown state", () => {
    expect(mapApiErrorToUiState("boom")).toEqual({
      kind: "unknown",
      message: "Unknown error",
      retryable: false,
    });
  });
});

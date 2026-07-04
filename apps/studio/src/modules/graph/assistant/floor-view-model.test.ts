import { describe, expect, it } from "vitest";

import type {
  TemporaryConversationTranscript,
  TemporaryConversationTranscriptFloor,
  TemporaryConversationTranscriptMessage,
} from "../../../lib/temp-conversation";
import { buildFloorViews } from "./floor-view-model";

function message(
  over: Partial<TemporaryConversationTranscriptMessage> = {},
): TemporaryConversationTranscriptMessage {
  return {
    id: "m",
    seq: 0,
    role: "user",
    content: "hi",
    contentFormat: "text",
    isHidden: false,
    source: null,
    createdAt: 0,
    ...over,
  };
}

function floor(
  over: Partial<TemporaryConversationTranscriptFloor> = {},
  messages: TemporaryConversationTranscriptMessage[] = [],
): TemporaryConversationTranscriptFloor {
  return {
    id: "f1",
    floorNo: 1,
    branchId: "main",
    parentFloorId: null,
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: 0,
    updatedAt: 0,
    reasoningText: null,
    stepNarrations: [],
    toolExecutions: [],
    pages: [
      {
        id: "pg1",
        pageNo: 1,
        pageKind: "narrative",
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: 0,
        updatedAt: 0,
        messages,
      },
    ],
    ...over,
  };
}

function transcript(floors: TemporaryConversationTranscriptFloor[]): TemporaryConversationTranscript {
  return { conversationId: "c1", branchId: "main", floors };
}

describe("buildFloorViews", () => {
  it("groups messages per floor and keeps seq order", () => {
    const views = buildFloorViews(
      transcript([
        floor({ id: "f1", floorNo: 1 }, [
          message({ id: "m_a", seq: 1, role: "assistant", content: "world" }),
          message({ id: "m_u", seq: 0, role: "user", content: "hello" }),
        ]),
      ]),
    );
    expect(views).toHaveLength(1);
    expect(views[0]?.messages.map((m) => m.id)).toEqual(["m_u", "m_a"]);
  });

  it("sorts floors by floorNo ascending", () => {
    const views = buildFloorViews(
      transcript([
        floor({ id: "f2", floorNo: 2 }, [message({ id: "m2" })]),
        floor({ id: "f1", floorNo: 1 }, [message({ id: "m1" })]),
      ]),
    );
    expect(views.map((v) => v.id)).toEqual(["f1", "f2"]);
  });

  it("filters hidden messages and system guidance", () => {
    const views = buildFloorViews(
      transcript([
        floor({ id: "f1", floorNo: 1 }, [
          message({ id: "m_sys", seq: 0, role: "system", content: "guidance" }),
          message({ id: "m_u", seq: 1, role: "user", content: "hi" }),
          message({ id: "m_a", seq: 2, role: "assistant", content: "ok" }),
          message({ id: "m_hidden", seq: 3, role: "assistant", content: "secret", isHidden: true }),
        ]),
      ]),
    );
    expect(views[0]?.messages.map((m) => m.id)).toEqual(["m_u", "m_a"]);
  });

  it("drops floors that have no visible message", () => {
    const views = buildFloorViews(
      transcript([
        floor({ id: "f_guidance", floorNo: 1 }, [
          message({ id: "m_sys", role: "system", content: "guidance" }),
        ]),
        floor({ id: "f_real", floorNo: 2 }, [message({ id: "m_u", role: "user", content: "hi" })]),
      ]),
    );
    expect(views.map((v) => v.id)).toEqual(["f_real"]);
  });

  it("computes metrics from token counts and timestamps", () => {
    const views = buildFloorViews(
      transcript([
        floor({ id: "f1", floorNo: 1, tokenIn: 10, tokenOut: 20, createdAt: 1_000, updatedAt: 3_000 }, [
          message({id: "m_u", role: "user", content: "hi" }),
        ]),
      ]),
    );
    const metrics = views[0]?.metrics;
    expect(metrics?.finishedAt).toBe(3_000);
    expect(metrics?.durationMs).toBe(2_000);
    expect(metrics?.totalTokens).toBe(30);
    expect(metrics?.tokenIn).toBe(10);
    expect(metrics?.tokenOut).toBe(20);
    expect(metrics?.cachedTokens).toBeNull();
    // 20 tokenOut / 2s = 10 tok/s
    expect(metrics?.tokensPerSecond).toBe(10);
  });

  it("returns null speed when duration is zero", () => {
    const views = buildFloorViews(
      transcript([
        floor({ id: "f1", floorNo: 1, tokenOut: 5, createdAt: 100, updatedAt: 100 }, [
          message({ id: "m_u", role: "user", content: "hi" }),
        ]),
      ]),
    );
    expect(views[0]?.metrics.tokensPerSecond).toBeNull();
  });

  it("leaves reasoning undefined when transcript has no reasoning text", () => {
    const views = buildFloorViews(
      transcript([floor({ id: "f1", floorNo: 1 }, [message({ id: "m_u", role: "user", content: "hi" })])]),
     );
    expect(views[0]?.reasoning).toBeUndefined();
  });

  it("fills reasoning from transcript reasoningText", () => {
    const views = buildFloorViews(
      transcript([
        floor({ id: "f1", floorNo: 1, reasoningText: "think: plan the graph" }, [
          message({ id: "m_u", role: "user", content: "hi" }),
        ]),
      ]),
    );
    expect(views[0]?.reasoning).toBe("think: plan the graph");
  });

  it("归并工具步与回答步为有序 steps（工具步在前、回答步在后）", () => {
    const views = buildFloorViews(
      transcript([
        floor(
          {
            id: "f1",
            floorNo: 1,
            toolExecutions: [
              {
                id: "exec1",
                toolName: "nodegraph.node_type.list",
                status: "success",
                args: { scope: "all" },
                result: { count: 3 },
                sideEffectLevel: "none",
                commitOutcome: "committed",
                errorMessage: null,
                durationMs: 120,
                startedAt: 1000,
                finishedAt: 1120,
                attemptNo: 1,
                generationStepNo: 1,
                replayParentExecutionId: null,
              },
            ],
          },
          [
            message({ id: "m_u", seq: 0, role: "user", content: "问题", createdAt: 900 }),
            // 回答 createdAt 晚于工具 startedAt(1000)，时序归并后工具步在前
            message({ id: "m_a", seq: 1, role: "assistant", content: "回答", createdAt: 2000 }),
          ],
        ),
      ]),
    );
    const steps = views[0]?.steps ?? [];
    expect(steps.map((s) => s.kind)).toEqual(["tool", "answer"]);
    expect(steps[0]).toMatchObject({ kind: "tool", toolName: "nodegraph.node_type.list" });
    expect(steps[1]).toMatchObject({ kind: "answer", id: "m_a" });
  });

  it("无工具执行时 steps 只含回答步", () => {
    const views = buildFloorViews(
      transcript([
        floor({ id: "f1", floorNo: 1 }, [
          message({ id: "m_u", seq: 0, role: "user", content: "hi" }),
          message({ id: "m_a", seq: 1, role: "assistant",content: "ok" }),
        ]),
      ]),
    );
    const steps = views[0]?.steps ?? [];
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "answer", id: "m_a" });
  });
});

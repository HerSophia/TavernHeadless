import { computed } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TavernApiError } from "@tavern/sdk";

import type { WorkspaceRespondStreamEvent } from "../../../lib/workspace-api";
import type { SessionState, TimelineMessage } from "../types";

const workspaceApiMocks = vi.hoisted(() => ({
  deleteMessageById: vi.fn(),
  editAndRegenerateMessage: vi.fn(),
  extractToolReplayBlockingExecutions: vi.fn(),
  isToolReplayBlockedError: vi.fn(),
  isToolReplayConfirmationRequiredError: vi.fn(),
  respondInSession: vi.fn(),
  retryFloor: vi.fn(),
  streamSessionResponse: vi.fn(),
  updateMessageContent: vi.fn()
}));

const timelineDraftMocks = vi.hoisted(() => ({
  animateMockAssistantReply: vi.fn()
}));

vi.mock("../../../lib/workspace-api", () => workspaceApiMocks);
vi.mock("../timeline-draft", () => timelineDraftMocks);

import { createMessageActions } from "./messages";

describe("createMessageActions.sendMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceApiMocks.extractToolReplayBlockingExecutions.mockReturnValue([]);
    workspaceApiMocks.isToolReplayBlockedError.mockReturnValue(false);
    workspaceApiMocks.isToolReplayConfirmationRequiredError.mockReturnValue(false);
  });

  it("keeps floor metadata and the respond result when timeline hydration fails after stream success", async () => {
    const bucket: TimelineMessage[] = [];
    let messageSeed = 0;

    const session: SessionState = {
      account: "account-1",
      archived: false,
      characterName: "Seraphina",
      id: "session-1",
      title: {
        en: "Session 1",
        zh: "会话 1"
      },
      userName: "Rowan",
      worldbookCount: 0,
      worldbookProfileId: null
    };

    workspaceApiMocks.streamSessionResponse.mockImplementation(async (_sessionId, _message, options) => {
      options?.onStart?.({
        branch_id: "branch-1",
        floor_id: "floor-1",
        floor_no: 3
      });
      options?.onChunk?.("draft chunk");

      return {
        branchId: "branch-1",
        finalState: "committed",
        floorId: "floor-1",
        floorNo: 3,
        generatedText: "final response",
        inputTokens: 12,
        outputTokens: 34,
        summaries: ["summary-1"],
        totalTokens: 46,
        totalUsage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 }
      };
    });

    const actions = createMessageActions({
      activeSession: computed(() => session),
      createMessageId: (prefix: string) => {
        messageSeed += 1;
        return `${prefix}-${messageSeed}`;
      },
      currentAccount: computed(() => "account-1"),
      ensureTimeline: () => bucket,
      findActiveMessage: () => null,
      hydrateActiveTimeline: async () => ({
        apiSyncFailed: false,
        count: bucket.length
      }),
      hydrateSessionTimeline: async () => ({
        apiSyncFailed: true,
        count: bucket.length
      }),
      isStreaming: computed(() => false)
    });

    const result = await actions.sendMessage("hello world");

    expect(result).toEqual(
      expect.objectContaining({
        localFallback: false,
        ok: true,
        result: expect.objectContaining({
          finalState: "committed",
          floorId: "floor-1",
          floorNo: 3,
          summaries: ["summary-1"]
        }),
        streamFallback: false,
        timelineSyncFailed: true,
        tokens: 46
      })
    );
    expect(bucket).toHaveLength(2);
    expect(bucket[0]).toEqual(
      expect.objectContaining({
        content: "hello world",
        floorId: "floor-1",
        floorNo: 3,
        floorState: "committed",
        role: "user"
      })
    );
    expect(bucket[1]).toEqual(
      expect.objectContaining({
        content: "final response",
        floorId: "floor-1",
        floorNo: 3,
        floorState: "committed",
        role: "assistant",
        streaming: false,
        tokens: 46
      })
    );
  });

  it("forwards stream events into the reducer callback without duplicating the real done event", async () => {
    const bucket: TimelineMessage[] = [];
    const recordedEvents: WorkspaceRespondStreamEvent[] = [];
    let messageSeed = 0;

    const session: SessionState = {
      account: "account-1",
      archived: false,
      characterName: "Seraphina",
      id: "session-1",
      title: {
        en: "Session 1",
        zh: "会话 1"
      },
      userName: "Rowan",
      worldbookCount: 0,
      worldbookProfileId: null
    };

    workspaceApiMocks.streamSessionResponse.mockImplementation(async (_sessionId, _message, options) => {
      options?.onEvent?.({
        payload: { branchId: "branch-1", floorId: "floor-1", floorNo: 4 },
        type: "start"
      });
      options?.onStart?.({
        branch_id: "branch-1",
        floor_id: "floor-1",
        floor_no: 4
      });
      options?.onChunk?.("tool chunk");
      options?.onEvent?.({
        payload: {
          executionId: "exec-1",
          phase: "start",
          providerId: "builtin",
          replaySafety: "uncertain",
          toolName: "set_variable"
        },
        type: "tool"
      });
      options?.onEvent?.({
        payload: {
          branchId: "branch-1",
          finalState: "committed",
          floorId: "floor-1",
          floorNo: 4,
          generatedText: "tool result",
          summaries: [],
          totalUsage: { inputTokens: 10, outputTokens: 12, totalTokens: 22 }
        },
        type: "done"
      });

      return {
        branchId: "branch-1",
        finalState: "committed",
        floorId: "floor-1",
        floorNo: 4,
        generatedText: "tool result",
        inputTokens: 10,
        outputTokens: 12,
        summaries: [],
        totalTokens: 22,
        totalUsage: { inputTokens: 10, outputTokens: 12, totalTokens: 22 }
      };
    });

    const actions = createMessageActions({
      activeSession: computed(() => session),
      createMessageId: (prefix: string) => {
        messageSeed += 1;
        return `${prefix}-${messageSeed}`;
      },
      currentAccount: computed(() => "account-1"),
      ensureTimeline: () => bucket,
      findActiveMessage: () => null,
      hydrateActiveTimeline: async () => ({
        apiSyncFailed: false,
        count: bucket.length
      }),
      hydrateSessionTimeline: async () => ({
        apiSyncFailed: false,
        count: bucket.length
      }),
      isStreaming: computed(() => false),
      recordRespondStreamEvent: (event) => recordedEvents.push(event),
      resetRespondStreamState: vi.fn()
    });

    await actions.sendMessage("tool aware");

    expect(recordedEvents).toEqual([
      {
        payload: { branchId: "branch-1", floorId: "floor-1", floorNo: 4 },
        type: "start"
      },
      {
        payload: {
          executionId: "exec-1",
          phase: "start",
          providerId: "builtin",
          replaySafety: "uncertain",
          toolName: "set_variable"
        },
        type: "tool"
      },
      {
        payload: {
          branchId: "branch-1",
          finalState: "committed",
          floorId: "floor-1",
          floorNo: 4,
          generatedText: "tool result",
          summaries: [],
          totalUsage: { inputTokens: 10, outputTokens: 12, totalTokens: 22 }
        },
        type: "done"
      }
    ]);
  });

  it("appends a synthetic done event when the stream path falls back to the non-stream response", async () => {
    const bucket: TimelineMessage[] = [];
    const recordedEvents: WorkspaceRespondStreamEvent[] = [];
    let messageSeed = 0;

    const session: SessionState = {
      account: "account-1",
      archived: false,
      characterName: "Seraphina",
      id: "session-1",
      title: {
        en: "Session 1",
        zh: "会话 1"
      },
      userName: "Rowan",
      worldbookCount: 0,
      worldbookProfileId: null
    };

    workspaceApiMocks.streamSessionResponse.mockRejectedValue(new Error("stream failed"));
    workspaceApiMocks.respondInSession.mockResolvedValue({
      branchId: "branch-1",
      finalState: "committed",
      floorId: "floor-1",
      floorNo: 5,
      generatedText: "fallback result",
      inputTokens: 3,
      outputTokens: 7,
      summaries: ["summary-1"],
      totalTokens: 10,
      totalUsage: { inputTokens: 3, outputTokens: 7, totalTokens: 10 }
    });

    const actions = createMessageActions({
      activeSession: computed(() => session),
      createMessageId: (prefix: string) => {
        messageSeed += 1;
        return `${prefix}-${messageSeed}`;
      },
      currentAccount: computed(() => "account-1"),
      ensureTimeline: () => bucket,
      findActiveMessage: () => null,
      hydrateActiveTimeline: async () => ({
        apiSyncFailed: false,
        count: bucket.length
      }),
      hydrateSessionTimeline: async () => ({
        apiSyncFailed: false,
        count: bucket.length
      }),
      isStreaming: computed(() => false),
      recordRespondStreamEvent: (event) => recordedEvents.push(event),
      resetRespondStreamState: vi.fn()
    });

    const result = await actions.sendMessage("fallback");

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      streamFallback: true
    }));
    expect(recordedEvents).toEqual([
      {
        payload: {
          branchId: "branch-1",
          finalState: "committed",
          floorId: "floor-1",
          floorNo: 5,
          generatedText: "fallback result",
          summaries: ["summary-1"],
          totalUsage: { inputTokens: 3, outputTokens: 7, totalTokens: 10 }
        },
        type: "done"
      }
    ]);
  });

  it("returns confirmation_required when retryFloor requires explicit replay confirmation", async () => {
    const bucket: TimelineMessage[] = [
      {
        at: 1,
        content: "Need retry",
        contentFormat: "text",
        floorId: "floor-1",
        floorNo: 2,
        floorState: "committed",
        id: "assistant-1",
        persisted: true,
        role: "assistant",
        seq: 0,
        source: "remote"
      }
    ];

    const blockingExecutions = [
      {
        executionId: "exec-1",
        lifecycleState: "finished",
        providerId: "builtin",
        providerType: "builtin",
        reason: "tool mutates state",
        replaySafety: "confirm_on_replay",
        sideEffectLevel: "sandbox",
        status: "success",
        toolName: "set_variable"
      }
    ];

    workspaceApiMocks.retryFloor.mockRejectedValue(new TavernApiError({
      code: "tool_replay_confirmation_required",
      details: {
        blocking_executions: [
          {
            execution_id: "exec-1",
            lifecycle_state: "finished",
            provider_id: "builtin",
            provider_type: "builtin",
            reason: "tool mutates state",
            replay_safety: "confirm_on_replay",
            side_effect_level: "sandbox",
            status: "success",
            tool_name: "set_variable"
          }
        ]
      },
      message: "Retry requires explicit confirmation",
      status: 409
    }));
    workspaceApiMocks.extractToolReplayBlockingExecutions.mockReturnValue(blockingExecutions);
    workspaceApiMocks.isToolReplayConfirmationRequiredError.mockReturnValue(true);

    const actions = createMessageActions({
      activeSession: computed(() => ({
        account: "account-1",
        archived: false,
        characterName: "Seraphina",
        id: "session-1",
        title: { en: "Session 1", zh: "会话 1" },
        userName: "Rowan",
        worldbookCount: 0,
        worldbookProfileId: null
      })),
      createMessageId: () => "draft-1",
      currentAccount: computed(() => "account-1"),
      ensureTimeline: () => bucket,
      findActiveMessage: (messageId) => messageId === "assistant-1" ? { bucket, index: 0 } : null,
      hydrateActiveTimeline: async () => ({ apiSyncFailed: false, count: bucket.length }),
      hydrateSessionTimeline: async () => ({ apiSyncFailed: false, count: bucket.length }),
      isStreaming: computed(() => false)
    });

    await expect(actions.retryMessageFloor("assistant-1")).resolves.toEqual({
      apiSyncFailed: false,
      blockingExecutions,
      ok: false,
      reason: "confirmation_required"
    });
  });
});

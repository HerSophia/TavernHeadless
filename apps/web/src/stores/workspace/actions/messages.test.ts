import { computed } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionState, TimelineMessage } from "../types";

const workspaceApiMocks = vi.hoisted(() => ({
  deleteMessageById: vi.fn(),
  editAndRegenerateMessage: vi.fn(),
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
        totalTokens: 46
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
});

import { describe, expect, it } from "vitest";

import {
  buildConversationHistoryWindow,
  normalizeConversationHistory,
  type EffectiveConversationTurn,
} from "../chat/conversation-history-normalizer.js";
import type { PromptHistoryMessageEntry } from "../chat-history-loader.js";

function makeEntry(input: Partial<PromptHistoryMessageEntry> & Pick<PromptHistoryMessageEntry, "role" | "content">): PromptHistoryMessageEntry {
  return {
    floorId: input.floorId ?? null,
    floorNo: input.floorNo ?? null,
    pageId: input.pageId ?? null,
    pageNo: input.pageNo ?? null,
    messageId: input.messageId ?? null,
    seq: input.seq ?? 1,
    role: input.role,
    content: input.content,
    ...(input.fromCurrentInput ? { fromCurrentInput: true } : {}),
  };
}

describe("conversation-history-normalizer", () => {
  it("merges consecutive user entries across floors into one effective user turn", () => {
    const result = normalizeConversationHistory([
      makeEntry({ floorId: "floor-1", floorNo: 1, pageId: "page-1", messageId: "msg-1", role: "user", content: "hello" }),
      makeEntry({ floorId: "floor-2", floorNo: 2, pageId: "page-2", messageId: "msg-2", role: "user", content: "world" }),
    ]);

    expect(result.violations).toEqual([]);
    expect(result.effectiveTurns).toEqual<EffectiveConversationTurn[]>([
      {
        role: "user",
        content: "hello\n\nworld",
        sourceFloorIds: ["floor-1", "floor-2"],
        sourcePageIds: ["page-1", "page-2"],
        sourceMessageIds: ["msg-1", "msg-2"],
        floorRange: { start: 1, end: 2 },
        includesCurrentInput: false,
        foldKind: "adjacent_user",
        entryCount: 2,
      },
    ]);
  });

  it("merges consecutive assistant entries when they stay in the same floor", () => {
    const result = normalizeConversationHistory([
      makeEntry({ floorId: "floor-3", floorNo: 3, pageId: "page-3", messageId: "msg-3", role: "assistant", content: "part-1" }),
      makeEntry({ floorId: "floor-3", floorNo: 3, pageId: "page-3", messageId: "msg-4", role: "assistant", content: "part-2", seq: 2 }),
    ]);

    expect(result.violations).toEqual([]);
    expect(result.effectiveTurns[0]).toEqual({
      role: "assistant",
      content: "part-1\n\npart-2",
      sourceFloorIds: ["floor-3"],
      sourcePageIds: ["page-3"],
      sourceMessageIds: ["msg-3", "msg-4"],
      floorRange: { start: 3, end: 3 },
      includesCurrentInput: false,
      foldKind: "same_floor_assistant",
      entryCount: 2,
    });
  });

  it("records a violation for consecutive assistant entries across floors", () => {
    const result = normalizeConversationHistory([
      makeEntry({ floorId: "floor-4", floorNo: 4, pageId: "page-4", messageId: "msg-5", role: "assistant", content: "one" }),
      makeEntry({ floorId: "floor-5", floorNo: 5, pageId: "page-5", messageId: "msg-6", role: "assistant", content: "two" }),
    ]);

    expect(result.effectiveTurns).toHaveLength(2);
    expect(result.violations).toEqual([
      {
        code: "adjacent_assistant_floors",
        message: "Consecutive assistant entries spanned multiple floors.",
        sourceFloorIds: ["floor-4", "floor-5"],
        sourceMessageIds: ["msg-5", "msg-6"],
      },
    ]);
  });

  it("treats history user tail and current input as one selected effective user turn", () => {
    const result = buildConversationHistoryWindow({
      entries: [
        makeEntry({ floorId: "floor-6", floorNo: 6, pageId: "page-6", messageId: "msg-7", role: "assistant", content: "narration" }),
        makeEntry({ floorId: "floor-7", floorNo: 7, pageId: "page-7", messageId: "msg-8", role: "user", content: "first ask" }),
        makeEntry({ role: "user", content: "second ask", fromCurrentInput: true }),
      ],
      maxSelectedTurns: 2,
    });

    expect(result.history).toEqual([{ role: "assistant", content: "narration" }]);
    expect(result.effectiveUserMessage).toBe("first ask\n\nsecond ask");
    expect(result.historyNormalization).toEqual({
      rawEntryCount: 3,
      effectiveTurnCount: 2,
      selectedTurnCount: 2,
      trailingUserSourceFloorIds: ["floor-7"],
      mergedUserGroups: [
        {
          effectiveRole: "user",
          sourceFloorIds: ["floor-7"],
          sourceMessageIds: ["msg-8"],
          includesCurrentInput: true,
        },
      ],
      violations: [],
    });
  });
});

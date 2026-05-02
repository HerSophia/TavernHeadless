import { describe, expect, it } from "vitest";

import {
  buildConversationInputSnapshot,
  buildFloorMetadataJson,
  mergeFloorMetadataConversationInput,
  readFloorConversationInputSnapshot,
} from "../chat/shared/metadata.js";

describe("chat metadata conversation_input helpers", () => {
  it("merges and reads conversation_input while preserving existing metadata keys", () => {
    const baseMetadata = buildFloorMetadataJson("user-1", JSON.stringify({ name: "Alice" }), 1_736_000_000_000, "raw ask");
    const snapshot = buildConversationInputSnapshot({
      effectiveText: "hello\n\nagain",
      sourceTurn: {
        sourceFloorIds: ["floor-1", "floor-2"],
        sourcePageIds: ["page-1", "page-2"],
        sourceMessageIds: ["msg-1", "msg-2"],
        floorRange: { start: 1, end: 2 },
        includesCurrentInput: true,
        entryCount: 2,
      },
      currentInputPageId: "page-2",
      currentInputMessageId: "msg-2",
    });

    const merged = mergeFloorMetadataConversationInput(baseMetadata, snapshot);
    const parsed = JSON.parse(merged!);

    expect(parsed.user_input_raw).toBe("raw ask");
    expect(parsed.user_binding).toMatchObject({
      user_id: "user-1",
      snapshot_summary: { name: "Alice" },
    });
    expect(parsed.conversation_input).toEqual({
      mode: "merged_user_tail",
      effective_text: "hello\n\nagain",
      source_floor_ids: ["floor-1", "floor-2"],
      source_page_ids: ["page-1", "page-2"],
      source_message_ids: ["msg-1", "msg-2"],
      floor_range: { start: 1, end: 2 },
      includes_current_input: true,
      current_input_page_id: "page-2",
      current_input_message_id: "msg-2",
    });
    expect(readFloorConversationInputSnapshot(merged)).toEqual(snapshot);
  });

  it("returns null when conversation_input payload is invalid", () => {
    expect(readFloorConversationInputSnapshot('{"conversation_input":{"mode":"unknown"}}')).toBeNull();
  });
});

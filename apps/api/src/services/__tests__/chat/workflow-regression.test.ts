import { describe, expect, it } from "vitest";

import { ChatService as CompatibilityChatService } from "../../chat-service.js";
import { ChatService as NestedChatService } from "../../chat/chat-service.js";

describe("chat service compatibility export", () => {
  it("keeps the top-level chat-service entry wired to the nested implementation", () => {
    expect(CompatibilityChatService).toBe(NestedChatService);
  });
});

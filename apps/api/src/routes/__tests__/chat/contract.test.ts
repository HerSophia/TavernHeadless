import { describe, expect, it } from "vitest";

import { registerChatRoutes as CompatibilityRegisterChatRoutes } from "../../chat.js";
import { registerChatRoutes as NestedRegisterChatRoutes } from "../../chat/index.js";

describe("chat route compatibility export", () => {
  it("keeps the top-level chat route entry wired to the nested implementation", () => {
    expect(CompatibilityRegisterChatRoutes).toBe(NestedRegisterChatRoutes);
  });
});

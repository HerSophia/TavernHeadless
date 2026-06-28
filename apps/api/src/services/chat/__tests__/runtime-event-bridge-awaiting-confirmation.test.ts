import { describe, expect, it} from "vitest";

import { createEventBus } from "@tavern/core";

import type { RespondRuntimeToolEvent } from "../contracts.js";
import { ChatRuntimeEventBridge } from "../runtime-event-bridge.js";

describe("ChatRuntimeEventBridge awaiting_confirmation", () => {
  it("maps tool.call_awaiting_confirmation to an awaiting_confirmation tool event", async () => {
    const eventBus = createEventBus();
    const bridge = new ChatRuntimeEventBridge(eventBus);
    const events: RespondRuntimeToolEvent[] = [];

    const unsubscribe = bridge.subscribeRuntimeToolEvents("floor_1", {
      onTool: (event) => {
        events.push(event);
  },
    });

    await eventBus.emit("tool.call_awaiting_confirmation", {
      floorId: "floor_1",
      pageId: "page_1",
      callerSlot: "narrator",
      callId: "call_1",
      toolName: "nodegraph.graph.create",
      args: { name: "demo" },
      sideEffectLevel: "sandbox",
    });

    unsubscribe();

  expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      phase: "awaiting_confirmation",
  toolName: "nodegraph.graph.create",
      callId: "call_1",
      args: { name: "demo" },
      sideEffectLevel: "sandbox",
    });
  });

  it("ignores awaiting_confirmation events for other floors", async () => {
    const eventBus = createEventBus();
    const bridge = new ChatRuntimeEventBridge(eventBus);
    const events: RespondRuntimeToolEvent[] = [];

    const unsubscribe = bridge.subscribeRuntimeToolEvents("floor_1", {
      onTool: (event) => {
        events.push(event);
      },
    });

    await eventBus.emit("tool.call_awaiting_confirmation", {
      floorId: "floor_other",
      callerSlot: "narrator",
      callId: "call_2",
      toolName: "nodegraph.node.add",
      args: {},
    });

    unsubscribe();

    expect(events).toHaveLength(0);
  });
});

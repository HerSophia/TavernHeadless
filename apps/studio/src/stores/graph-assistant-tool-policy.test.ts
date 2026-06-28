import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi} from "vitest";

const { policyApi } = vi.hoisted(() => ({
  policyApi: {
    get: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../lib/graph-assistant-tool-policy-api", () => ({
  graphAssistantToolPolicyApi: policyApi,
}));

import { useGraphAssistantToolPolicyStore } from "./graph-assistant-tool-policy";

function makeItem(
  toolName: string,
  decision: "auto" | "confirm",
  defaultDecision: "auto" | "confirm" = decision,
) {
  return {
    tool_name: toolName,
    side_effect_level: "sandbox" as const,
    default_decision: defaultDecision,
    decision,
    source: decision === defaultDecision? ("default" as const) : ("override" as const),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  policyApi.get.mockResolvedValue({ items: []});
  policyApi.update.mockResolvedValue({ items: [] });
});

describe("graph assistant tool policy store", () => {
  it("loads effective policy and computes auto/confirm counts", async () => {
    policyApi.get.mockResolvedValue({
      items: [
        makeItem("nodegraph.graph.get", "auto"),
        makeItem("nodegraph.graph.create", "confirm"),
      ],
    });
    const store = useGraphAssistantToolPolicyStore();
    await store.load("p1");
   expect(store.projectId).toBe("p1");
    expect(store.items).toHaveLength(2);
    expect(store.autoCount).toBe(1);
    expect(store.confirmCount).toBe(1);
    expect(store.loading).toBe(false);
  });

  it("captures load errors", async () => {
    policyApi.get.mockRejectedValue(new Error("boom"));
    const store = useGraphAssistantToolPolicyStore();
    await store.load("p1");
    expect(store.error).toBe("boom");
  });

  it("sets a single decision andrefreshes from response", async () => {
    policyApi.get.mockResolvedValue({ items: [makeItem("nodegraph.node.add", "auto")] });
    policyApi.update.mockResolvedValue({ items: [makeItem("nodegraph.node.add", "confirm", "auto")] });
    const store = useGraphAssistantToolPolicyStore();
    await store.load("p1");
    await store.setDecision("nodegraph.node.add", "confirm");
    expect(policyApi.update).toHaveBeenCalledWith("p1", [
      { tool_name: "nodegraph.node.add", decision: "confirm" },
    ]);
    expect(store.items[0]?.decision).toBe("confirm");
    expect(store.items[0]?.source).toBe("override");
  });

  it("resets all tools to their default decision", async () => {
    policyApi.get.mockResolvedValue({
      items: [
        makeItem("nodegraph.graph.create", "auto", "confirm"),
        makeItem("nodegraph.graph.get", "auto", "auto"),
      ],
    });
    policyApi.update.mockResolvedValue({ items: [] });
    const store = useGraphAssistantToolPolicyStore();
    await store.load("p1");
    await store.resetToDefault();
    expect(policyApi.update).toHaveBeenCalledWith("p1", [
      { tool_name:"nodegraph.graph.create", decision: "confirm" },
      { tool_name: "nodegraph.graph.get", decision: "auto" },
    ]);
  });

  it("does not callupdate when no project is loaded", async () => {
    const store = useGraphAssistantToolPolicyStore();
    await store.setAll("auto");
    expect(policyApi.update).not.toHaveBeenCalled();
  });

  it("ignores load when the project id is empty", async () => {
    const store = useGraphAssistantToolPolicyStore();
    await store.load("");
    expect(policyApi.get).not.toHaveBeenCalled();
    expect(store.projectId).toBeNull();
  });

  it("does not call update when the loaded catalog is empty", async () => {
    policyApi.get.mockResolvedValue({ items: [] });
const store = useGraphAssistantToolPolicyStore();
    await store.load("p1");
    await store.setAll("confirm");
    expect(policyApi.update).not.toHaveBeenCalled();
  });

  it("captures update errors and rethrows", async () => {
    policyApi.get.mockResolvedValue({ items: [makeItem("nodegraph.node.add","auto")] });
    policyApi.update.mockRejectedValue(new Error("update failed"));
    const store = useGraphAssistantToolPolicyStore();
    await store.load("p1");
    await expect(store.setDecision("nodegraph.node.add", "confirm")).rejects.toThrow("update failed");
    expect(store.error).toBe("update failed");
    expect(store.saving).toBe(false);
  });
});

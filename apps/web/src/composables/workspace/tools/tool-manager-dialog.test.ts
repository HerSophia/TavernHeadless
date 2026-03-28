import { effectScope, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceApiMocks = vi.hoisted(() => ({
  createToolDefinition: vi.fn(),
  deleteToolDefinition: vi.fn(),
  fetchSessionRuntimeToolCatalog: vi.fn(),
  fetchSessionToolPermissions: vi.fn(),
  fetchToolDefinition: vi.fn(),
  fetchToolDefinitions: vi.fn(),
  fetchToolExecutions: vi.fn(),
  putSessionToolPermissions: vi.fn(),
  toggleToolDefinition: vi.fn(),
  updateToolDefinition: vi.fn()
}));

vi.mock("../../../lib/workspace-api", () => workspaceApiMocks);

import { useWorkspaceToolManagerDialog } from "./tool-manager-dialog";

describe("useWorkspaceToolManagerDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads session tool state and saves permissions", async () => {
    workspaceApiMocks.fetchToolDefinitions.mockResolvedValue({ definitions: [], meta: {} });
    workspaceApiMocks.fetchSessionToolPermissions.mockResolvedValue({
      allowIrreversible: false,
      enabled: true,
      maxCallsPerTurn: 4,
      maxStepsPerGeneration: 2,
      slotAllowList: { narrator: ["roll_dice"] }
    });
    workspaceApiMocks.fetchSessionRuntimeToolCatalog.mockResolvedValue({
      conflicts: [],
      generatedAt: 123,
      sessionId: "session-1",
      tools: [
        {
          allowedSlots: ["narrator"],
          availability: "available",
          availabilityReason: null,
          name: "roll_dice",
          providerId: "builtin",
          providerType: "builtin",
          replaySafety: "safe",
          sideEffectLevel: "none",
          source: "builtin"
        }
      ]
    });
    workspaceApiMocks.fetchToolExecutions.mockResolvedValue({
      meta: {},
      records: [
        {
          args: { sides: 20 },
          attemptNo: 1,
          callerSlot: "narrator",
          commitOutcome: "committed",
          createdAt: 1,
          durationMs: 2,
          errorMessage: null,
          finishedAt: 3,
          floorId: "floor-1",
          id: "exec-1",
          lifecycleState: "finished",
          pageId: null,
          providerId: "builtin",
          providerType: "builtin",
          replayParentExecutionId: null,
          result: { value: 12 },
          runId: "run-1",
          sideEffectLevel: "none",
          startedAt: 1,
          status: "success",
          toolName: "roll_dice"
        }
      ]
    });
    workspaceApiMocks.putSessionToolPermissions.mockResolvedValue({
      enabled: false,
      maxCallsPerTurn: 8
    });

    const addEvent = vi.fn();
    const scope = effectScope();
    const state = scope.run(() => useWorkspaceToolManagerDialog({
      activeSessionId: ref("session-1"),
      addEvent,
      currentAccount: ref("acc-1"),
      t: (key) => key
    }));

    expect(state).toBeTruthy();

    await state?.openToolManagerDialog();

    expect(workspaceApiMocks.fetchSessionToolPermissions).toHaveBeenCalledWith("session-1", "acc-1");
    expect(workspaceApiMocks.fetchSessionRuntimeToolCatalog).toHaveBeenCalledWith("session-1", "acc-1");
    expect(workspaceApiMocks.fetchToolExecutions).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1" }));
    expect(state?.toolManagerDialog.runtimeCatalog?.tools).toHaveLength(1);
    expect(state?.toolManagerDialog.executions).toHaveLength(1);

    state!.toolManagerDialog.permissionsDraft.enabledMode = "false";
    state!.toolManagerDialog.permissionsDraft.maxCallsPerTurn = "8";
    state!.toolManagerDialog.permissionsDraft.maxStepsPerGeneration = "";
    state!.toolManagerDialog.permissionsDraft.slotAllowListJson = "";
    state!.toolManagerDialog.permissionsDraft.slotDenyListJson = "";

    await state?.saveSessionToolPermissions();

    expect(workspaceApiMocks.putSessionToolPermissions).toHaveBeenCalledWith(
      "session-1",
      {
        allowIrreversible: false,
        enabled: false,
        maxCallsPerTurn: 8,
        maxStepsPerGeneration: undefined,
        slotAllowList: undefined,
        slotDenyList: undefined
      },
      "acc-1"
    );
    expect(addEvent).toHaveBeenCalledWith("events.toolManagerPermissionsSaved", "success", { session: "session-1" });

    scope.stop();
  });

  it("creates, toggles, and deletes a tool definition", async () => {
    const createdDefinition = {
      allowedSlots: ["narrator"],
      createdAt: 1,
      description: "Lookup notes",
      enabled: true,
      handler: { script: "return args;" },
      handlerType: "script",
      id: "def-1",
      name: "lookup_notes",
      parameters: {},
      sideEffectLevel: "none",
      source: "custom",
      sourceId: null,
      updatedAt: 2
    };

    workspaceApiMocks.fetchToolDefinitions
      .mockResolvedValueOnce({ definitions: [], meta: {} })
      .mockResolvedValueOnce({ definitions: [createdDefinition], meta: {} })
      .mockResolvedValueOnce({ definitions: [], meta: {} });
    workspaceApiMocks.createToolDefinition.mockResolvedValue(createdDefinition);
    workspaceApiMocks.fetchToolDefinition.mockResolvedValue(createdDefinition);
    workspaceApiMocks.toggleToolDefinition.mockResolvedValue({ ...createdDefinition, enabled: false });
    workspaceApiMocks.deleteToolDefinition.mockResolvedValue(true);

    const addEvent = vi.fn();
    const scope = effectScope();
    const state = scope.run(() => useWorkspaceToolManagerDialog({
      activeSessionId: ref(null),
      addEvent,
      currentAccount: ref("acc-1"),
      t: (key) => key
    }));

    expect(state).toBeTruthy();

    await state?.openToolManagerDialog();
    state!.toolManagerDialog.definitionDraft.name = "lookup_notes";
    state!.toolManagerDialog.definitionDraft.description = "Lookup notes";
    state!.toolManagerDialog.definitionDraft.parametersJson = "{}";
    state!.toolManagerDialog.definitionDraft.handlerJson = JSON.stringify({ script: "return args;" });

    await state?.saveToolDefinition();

    expect(workspaceApiMocks.createToolDefinition).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "acc-1",
      name: "lookup_notes"
    }));
    expect(addEvent).toHaveBeenCalledWith("events.toolManagerDefinitionCreated", "success", { tool: "lookup_notes" });

    await state?.toggleToolDefinitionEnabled("def-1", false);
    expect(workspaceApiMocks.toggleToolDefinition).toHaveBeenCalledWith("def-1", false, "acc-1");

    await state?.deleteToolDefinitionById("def-1");
    expect(workspaceApiMocks.deleteToolDefinition).toHaveBeenCalledWith("def-1", "acc-1");
    expect(addEvent).toHaveBeenCalledWith("events.toolManagerDefinitionDeleted", "warn", { tool: "lookup_notes" });

    scope.stop();
  });
});

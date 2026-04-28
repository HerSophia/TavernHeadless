import { describe, expect, it, vi } from "vitest";

import { ChatServiceError } from "../../chat/errors.js";
import { FirstPartyStateContextService } from "../../chat/first-party-state-context-service.js";

describe("FirstPartyStateContextService", () => {
  const createError = (code: string, message: string, cause?: unknown, details?: unknown) => (
    new ChatServiceError(code, message, cause, details)
  );

  it("returns empty context when first-party service is unavailable", () => {
    const service = new FirstPartyStateContextService(undefined, createError);

    expect(service.loadFirstPartyStateContext({
      accountId: "acc",
      sessionId: "sess",
      branchId: "main",
    })).toEqual({ scene: null, world: null });
  });

  it("builds diagnostics for loaded managed scene and world context", () => {
    const service = new FirstPartyStateContextService(undefined, createError);

    const diagnostics = service.buildFirstPartyStateDiagnostics({
      scene: {
        namespace: "scene",
        slot: "default",
        resolutionMode: "source_floor",
        source: "source_floor_snapshot",
        present: true,
        schemaVersion: 1,
        floorId: "floor-1",
        updatedAt: 1,
        sourceMutationIds: [],
        scene: { generatedText: "scene" },
      } as never,
      world: {
        namespace: "world",
        slot: "default",
        resolutionMode: "source_floor",
        source: "source_floor_snapshot",
        present: true,
        schemaVersion: 1,
        floorId: "floor-1",
        updatedAt: 1,
        sourceMutationIds: [],
        world: {
          worldbookId: null,
          worldbookVersion: null,
          activatedWorldbookEntryUids: [],
          summaryLines: [],
          toolExecutionIds: [],
        },
      } as never,
    }, "assemble");

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.code).toBe("managed_scene_context_loaded");
    expect(diagnostics[1]?.code).toBe("managed_world_context_loaded");
  });

  it("stageExecutionState forwards scene and world staging", () => {
    const stageSceneState = vi.fn();
    const stageWorldState = vi.fn();
    const service = new FirstPartyStateContextService(
      {
        loadSceneContext: vi.fn(),
        loadWorldContext: vi.fn(),
        stageSceneState,
        stageWorldState,
      } as never,
      createError,
    );

    service.stageExecutionState({
      accountId: "acc",
      sessionId: "sess",
      branchId: "main",
      floorId: "floor-1",
      runType: "respond",
      execution: { toolExecutionRecords: [], pendingToolJobs: [], summaries: [] } as never,
      promptSnapshot: {
        worldbookId: "wb",
        worldbookVersion: 1,
        worldbookActivatedEntryUids: [1],
      } as never,
    });

    expect(stageSceneState).toHaveBeenCalledTimes(1);
    expect(stageWorldState).toHaveBeenCalledTimes(1);
  });
});

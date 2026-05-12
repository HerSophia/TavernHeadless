import { describe, expect, it, vi } from "vitest";

import { ChatServiceError } from "../../chat/errors.js";
import { TurnSessionStateService } from "../../chat/turn-session-state-service.js";

describe("TurnSessionStateService", () => {
  const createError = (code: string, message: string, cause?: unknown, details?: unknown) => (
    new ChatServiceError(code, message, cause, details)
  );

  it("assertTurnSessionStateWritesAvailable throws when writes are present but service is unavailable", () => {
    const service = new TurnSessionStateService(undefined, createError);

    expect(() => service.assertTurnSessionStateWritesAvailable([
      { namespace: "custom", slot: "hero", value: { hp: 10 } },
    ])).toThrow(ChatServiceError);
  });

  it("stageTurnBoundSessionStateWrites forwards writes and delete semantics", () => {
    const stageClientCommitBoundValue = vi.fn();
    const service = new TurnSessionStateService(
      {
        stageClientCommitBoundValue,
        discardStagedMutationsForFloor: vi.fn(),
      } as never,
      createError,
    );

    service.stageTurnBoundSessionStateWrites({
      accountId: "acc",
      sessionId: "sess",
      branchId: "main",
      floorId: "floor-1",
      writes: [
        { namespace: "custom", slot: "hero", value: { hp: 10 } },
        { namespace: "custom", slot: "hero", delete: true },
      ],
    });

    expect(stageClientCommitBoundValue).toHaveBeenNthCalledWith(1, {
      accountId: "acc",
      sessionId: "sess",
      branchId: "main",
      sourceFloorId: "floor-1",
      namespace: "custom",
      slot: "hero",
      value: { hp: 10 },
      present: true,
      operationLog: undefined,
      operationIndex: 1,
      operationCount: 2,
    });
    expect(stageClientCommitBoundValue).toHaveBeenNthCalledWith(2, {
      accountId: "acc",
      sessionId: "sess",
      branchId: "main",
      sourceFloorId: "floor-1",
      namespace: "custom",
      slot: "hero",
      value: null,
      present: false,
      operationLog: undefined,
      operationIndex: 2,
      operationCount: 2,
    });
  });

  it("discardStagedSessionStateBestEffort swallows discard errors", () => {
    const service = new TurnSessionStateService(
      {
        stageClientCommitBoundValue: vi.fn(),
        discardStagedMutationsForFloor: vi.fn(() => {
          throw new Error("discard failed");
        }),
      } as never,
      createError,
    );

    expect(() => service.discardStagedSessionStateBestEffort("acc", "sess", "floor-1", "failed")).not.toThrow();
  });
});

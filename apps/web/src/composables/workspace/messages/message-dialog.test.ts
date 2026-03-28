import { computed, effectScope } from "vue";
import { describe, expect, it, vi } from "vitest";

import { useWorkspaceMessageDialog } from "./message-dialog";

describe("useWorkspaceMessageDialog", () => {
  it("opens the tool replay confirmation dialog and resubmits with confirmed execution ids", async () => {
    const addEvent = vi.fn();
    const retryMessageFloor = vi
      .fn()
      .mockResolvedValueOnce({
        apiSyncFailed: false,
        blockingExecutions: [
          {
            executionId: "exec-1",
            lifecycleState: "finished",
            providerId: "builtin",
            providerType: "builtin",
            reason: "tool mutates state",
            replaySafety: "confirm_on_replay",
            sideEffectLevel: "sandbox",
            status: "success",
            toolName: "set_variable"
          }
        ],
        ok: false,
        reason: "confirmation_required"
      })
      .mockResolvedValueOnce({
        apiSyncFailed: false,
        ok: true,
        result: {
          branchId: "branch-1",
          finalState: "committed",
          floorId: "floor-2",
          floorNo: 2,
          generatedText: "retry success",
          inputTokens: 6,
          outputTokens: 12,
          sourceFloorId: "floor-1",
          sourceMessageId: "message-1",
          summaries: [],
          totalTokens: 18,
          totalUsage: { inputTokens: 6, outputTokens: 12, totalTokens: 18 }
        }
      });

    const scope = effectScope();
    const state = scope.run(() => useWorkspaceMessageDialog({
      activeTimeline: computed(() => [
        {
          at: 1,
          content: "assistant reply",
          contentFormat: "text",
          floorId: "floor-1",
          floorNo: 1,
          floorState: "committed",
          id: "message-1",
          persisted: true,
          role: "assistant",
          seq: 0,
          source: "remote"
        }
      ]),
      addEvent,
      runtimeCharacterName: computed(() => "Seraphina"),
      t: (key, vars) => `${key}:${JSON.stringify(vars ?? {})}`,
      workspace: {
        deleteTimelineMessage: vi.fn(),
        editAndRegenerateFromMessage: vi.fn(),
        retryMessageFloor,
        updateTimelineMessage: vi.fn()
      }
    }));

    expect(state).toBeTruthy();
    state?.openRetryFloorDialog("message-1");
    expect(state?.messageDialog.retryOpen).toBe(true);

    await state?.confirmRetryFloor();

    expect(retryMessageFloor).toHaveBeenNthCalledWith(1, "message-1");
    expect(state?.messageDialog.retryOpen).toBe(false);
    expect(state?.toolReplayConfirmDialog.open).toBe(true);
    expect(state?.toolReplayConfirmDialog.blockingExecutions).toHaveLength(1);
    expect(addEvent).toHaveBeenCalledWith("events.messageRetryConfirmationRequired", "warn", { count: 1 });

    await state?.confirmToolReplay();

    expect(retryMessageFloor).toHaveBeenNthCalledWith(2, "message-1", {
      confirmedExecutionIds: ["exec-1"]
    });
    expect(state?.toolReplayConfirmDialog.open).toBe(false);
    expect(state?.messageDialog.targetId).toBe("");
    expect(addEvent).toHaveBeenCalledWith(
      "events.messageRetried",
      "success",
      expect.objectContaining({
        role: "Seraphina",
        tokens: 18
      })
    );

    scope.stop();
  });
});

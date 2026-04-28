import { describe, expect, it, vi } from "vitest";

import { ChatTurnWorkflowRunner } from "../../chat/turn-workflow-runner.js";

describe("ChatTurnWorkflowRunner", () => {
  it("delegates prepared workflow execution to the active strategy", async () => {
    const execute = vi.fn(async () => ({
      execution: { generatedText: "ok" },
      commit: { finalState: "committed" },
    }));
    const runner = new ChatTurnWorkflowRunner({ execute } as never);
    const payload = { floorId: "floor-1" };

    const result = await runner.runPreparedTurnWorkflow(payload as never);

    expect(execute).toHaveBeenCalledWith(payload);
    expect(result).toEqual({
      execution: { generatedText: "ok" },
      commit: { finalState: "committed" },
    });
  });
});

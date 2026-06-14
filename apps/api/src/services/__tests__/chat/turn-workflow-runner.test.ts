import { describe, expect, it, vi } from "vitest";

import { ChatTurnWorkflowRunner } from "../../chat/turn-workflow-runner.js";

describe("ChatTurnWorkflowRunner", () => {
  it("delegates prepared workflow execution to the resolved strategy", async () => {
    const execute = vi.fn(async () => ({
      execution: { generatedText: "ok" },
      commit: { finalState: "committed" },
    }));
    const resolveStrategy = vi.fn(() => ({ execute }));
    const runner = new ChatTurnWorkflowRunner(resolveStrategy as never);
    const payload = { floorId: "floor-1", turnStrategy: "naive" };

    const result = await runner.runPreparedTurnWorkflow(payload as never);

    expect(resolveStrategy).toHaveBeenCalledWith(payload);
    expect(execute).toHaveBeenCalledWith(payload);
    expect(result).toEqual({
      execution: { generatedText: "ok" },
      commit: { finalState: "committed" },
    });
  });
});

import { describe, expect, it } from "vitest";

import { InlineAgentExecutor, type InlineAgentRegistry } from "../inline-agent-executor.js";
import type {
  AgentInvocationPlan,
  AgentProcessor,
  AgentRunContext,
  AgentRunOutput,
  InlineAgentSpec,
} from "../inline-agent-types.js";

function makeSpec(overrides: Partial<InlineAgentSpec> & Pick<InlineAgentSpec, "id" | "roleKind">): InlineAgentSpec {
  return {
    phase: "pre_response",
    stabilityHint: "floor",
    failurePolicy: "fail_open",
    ...overrides,
  };
}

class StubProcessor implements AgentProcessor {
  constructor(
    public readonly spec: InlineAgentSpec,
    private readonly behavior: (context: AgentRunContext) => AgentRunOutput,
  ) {}

  prepare():void {
    return undefined;
  }

  execute(_prepared: unknown, context: AgentRunContext): AgentRunOutput {
 return this.behavior(context);
  }
}

class StubRegistry implements InlineAgentRegistry {
  constructor(private readonly processors: Map<string, AgentProcessor>) {}

  resolve(spec: InlineAgentSpec): AgentProcessor | undefined {
    return this.processors.get(spec.id);
  }
}

const baseContext = {
  sessionId: "sess_1",
  floorId: "floor_1",
  accountId: "acc_1",
};

describe("InlineAgentExecutor", () => {
  it("并行执行同组 Agent 并收集每个 Agent 的状态与耗时", async () => {
    const okSpec = makeSpec({ id: "a", roleKind: "scene_state" });
    const skipSpec = makeSpec({ id: "b", roleKind: "director" });
    const registry = new StubRegistry(
      new Map<string, AgentProcessor>([
        ["a", new StubProcessor(okSpec, () => ({ narratorConstraints: ["x"], summary: "ok" }))],
        ["b", new StubProcessor(skipSpec, () => ({ summary: "nothing" }))],
      ]),
    );
    const executor = new InlineAgentExecutor(registry);
    const plan: AgentInvocationPlan = {
      source: { kind:"respond_pre_response", sessionId: "sess_1", floorId: "floor_1" },
      phase: "pre_response",
      groups: [{ groupId: "g1", parallel: true, agents: [okSpec, skipSpec] }],
    };

    const result = await executor.execute(plan, baseContext);

    expect(result.aborted).toBe(false);
    expect(result.records).toHaveLength(2);
    expect(result.records.find((record) => record.agentId === "a")?.status).toBe("ok");
    expect(result.records.find((record) => record.agentId === "b")?.status).toBe("skipped");
    expect(result.records.every((record) => record.durationMs >= 0)).toBe(true);
  });

  it("fail_open Agent 抛错时记录 failed，但不中止执行", async () => {
    const failSpec = makeSpec({ id: "fail", roleKind: "scene_state", failurePolicy: "fail_open" });
    const okSpec = makeSpec({ id: "ok", roleKind: "director" });
    const registry = new StubRegistry(
      new Map<string, AgentProcessor>([
        [
          "fail",
          new StubProcessor(failSpec, () => {
            throw new Error("boom");
          }),
        ],
        ["ok", new StubProcessor(okSpec, () => ({ narratorConstraints: ["y"] }))],
      ]),
    );
    const executor = new InlineAgentExecutor(registry);
    const plan: AgentInvocationPlan = {
      source: { kind: "respond_pre_response", sessionId: "sess_1", floorId: "floor_1" },
      phase: "pre_response",
      groups: [{ groupId: "g1", parallel: true, agents: [failSpec, okSpec] }],
    };

    const result = await executor.execute(plan, baseContext);

    expect(result.aborted).toBe(false);
    expect(result.records.find((record) => record.agentId === "fail")?.status).toBe("failed");
    expect(result.records.find((record) => record.agentId === "fail")?.errorCode).toBe("agent_run_failed");
    expect(result.records.find((record) => record.agentId === "ok")?.status).toBe("ok");
  });

  it("缺少 processor 时标记为 skipped", async () => {
    const spec = makeSpec({ id: "missing", roleKind: "scene_state" });
    const executor = new InlineAgentExecutor(new StubRegistry(new Map()));
    const plan: AgentInvocationPlan = {
      source: { kind: "respond_pre_response", sessionId: "sess_1", floorId: "floor_1" },
      phase: "pre_response",
      groups: [{ groupId: "g1", parallel: false, agents: [spec] }],
    };

    const result = await executor.execute(plan, baseContext);
    expect(result.records[0]?.status).toBe("skipped");
  });

  it("串行组中 fail_closed Agent 失败会中止后续执行", async () => {
    const failSpec = makeSpec({
      id: "closed",
      roleKind: "scene_state",
      failurePolicy: "fail_closed",
    });
    const laterSpec = makeSpec({ id: "later", roleKind: "director" });
    const registry = new StubRegistry(
      new Map<string, AgentProcessor>([
        [
          "closed",
          new StubProcessor(failSpec,() => {
            throw new Error("hard fail");
          }),
        ],
        ["later", new StubProcessor(laterSpec, () => ({ narratorConstraints: ["z"] }))],
      ]),
    );
    const executor = new InlineAgentExecutor(registry);
    const plan: AgentInvocationPlan = {
  source: { kind: "respond_pre_response", sessionId: "sess_1", floorId: "floor_1" },
      phase: "pre_response",
      groups: [{ groupId: "g1", parallel: false, agents: [failSpec, laterSpec] }],
    };

    const result = await executor.execute(plan, baseContext);
    expect(result.aborted).toBe(true);
expect(result.records.find((record) => record.agentId === "later")).toBeUndefined();
  });
});

import type { NodeGraphDocument } from "@tavern/core";
import { describe, expect, it, vi } from "vitest";

import {
  createDefaultNodeGraphExecutor,
  type NodeGraphRuntimeContext,
  type NodeGraphSubgraphRunner,
} from "../node-graph-runtime/index.js";

function groupNodeGraph(): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: "parent",
    name: "Parent with NodeGroup",
    mode: "native_graph",
    nodes: [
      { id: "u", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
      {
        id: "g",
        type: "group.node",
        typeVersion: "1",
        phase: "pre_response",
        config: {
          ref: { graphId: "sub-1", versionId: "v1" },
          interface: {
            inputs: [{ name: "in_1", type: "text" }],
            outputs: [{ name: "out_1", type: "text" }],
          },
        },
      },
    ],
    edges: [{ id: "e_u_g", from: { nodeId: "u", port: "text" }, to: { nodeId: "g", port: "in_1" } }],
    policies: {},
  };
}

describe("group.node executor handler", () => {
  it("does not crash on a graph containing a group.node (dry-run synthetic)", async () => {
    const executor = createDefaultNodeGraphExecutor();
    const context: NodeGraphRuntimeContext = { accountId: "a", intent: "preview", dryRun: true, userInput: "hi" };
    const result = await executor.execute({ document: groupNodeGraph(), context });

    expect(result.status).toBe("succeeded");
    // 声明的输出端口以 null 兜底（下游可解析、不崩溃）。
    expect(result.nodeOutputs.g?.outputs).toBeDefined();
    expect((result.nodeOutputs.g?.outputs as { out_1?: unknown }).out_1).toBeNull();
  });

  it("recursively runs the referenced subgraph via the injected runner and maps boundary I/O", async () => {
    const runner = vi.fn<NodeGraphSubgraphRunner>(async () => ({
      status: "succeeded",
      outputsByPort: { out_1: "from-subgraph" },
    }));
    const executor = createDefaultNodeGraphExecutor();
    const context: NodeGraphRuntimeContext = {
      accountId: "a",
      intent: "normal",
      dryRun: false,
      userInput: "hello",
      subgraphRunner: runner,
    };

    const result = await executor.execute({ document: groupNodeGraph(), context });
    expect(result.status).toBe("succeeded");

    // runner 收到「按端口」的输入（in_1 = 上游 user_input 值）。
    expect(runner).toHaveBeenCalledTimes(1);
    const runArg = runner.mock.calls[0]?.[0];
    expect(runArg?.ref).toEqual({ graphId: "sub-1", versionId: "v1" });
    expect(runArg?.inputsByPort.in_1).toBe("hello");

    // 子图边界输出映射回实例输出端口（供下游边解析）。
    expect((result.nodeOutputs.g?.outputs as { out_1?: unknown }).out_1).toBe("from-subgraph");
  });

  it("fails the node (fail_closed) when the subgraph run fails", async () => {
    const runner: NodeGraphSubgraphRunner = async () => ({
      status: "failed",
      outputsByPort: {},
      diagnostics: [{ severity: "error", code: "boom", message: "subgraph exploded" }],
    });
    const executor = createDefaultNodeGraphExecutor();
    const context: NodeGraphRuntimeContext = {
      accountId: "a",
      intent: "normal",
      dryRun: false,
      userInput: "x",
      subgraphRunner: runner,
    };

    const result = await executor.execute({ document: groupNodeGraph(), context });
    expect(result.status).toBe("failed");
    expect(result.nodeRuns.find((run) => run.nodeId === "g")?.status).toBe("failed");
  });
});

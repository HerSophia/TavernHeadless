import type { NodeGraphDocument, NodeGraphNode } from "@tavern/core";
import { describe, expect, it, vi } from "vitest";

import {
  dispatchCarrierSubgraph,
  NARRATOR_SUBGRAPH_FAILED_CODE,
} from "../node-graph-runtime/handlers/carrier-subgraph-dispatch.js";
import {
  createDefaultNodeGraphExecutor,
  NodeGraphNodeExecutionError,
  type NodeGraphRuntimeContext,
  type NodeGraphSubgraphRunner,
} from "../node-graph-runtime/index.js";

/**
 * NG2-9：`narration.narrator` 承载来源 = subgraph 时的运行分派单测。
 *
 * 对照 `node-graph-group-node.test.ts` 的 `vi.fn<NodeGraphSubgraphRunner>` 注入样板，
 * 覆盖设计 §8 的 6 个用例（零回归 / 实运行 / dry-run / 无 runner / 分派失败 / 输出未映射）。
 */

/** 构造一张最小图：user_input → narrator（config 决定承载来源）。 */
function narratorGraph(config: Record<string, unknown>): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: "narrator-parent",
    name: "Narrator carrier",
    mode: "native_graph",
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: "u", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
      { id: "n", type: "narration.narrator", typeVersion: "1", phase: "response", config },
    ],
    edges: [
      { id: "e_u_n", kind: "data", from: { nodeId: "u", port: "text" }, to: { nodeId: "n", port: "user_input" } },
    ],
  };
}

describe("narration.narrator subgraph carrier dispatch (NG2-9)", () => {
  it("does not dispatch to the runner when the narrator has no subgraph carrier (zero regression)", async () => {
    const runner = vi.fn<NodeGraphSubgraphRunner>(async () => ({ status: "succeeded", outputsByPort: {} }));
    const executor = createDefaultNodeGraphExecutor();
    const context: NodeGraphRuntimeContext = {
      accountId: "a",
      intent: "normal",
      dryRun: false,
      userInput: "hello",
      subgraphRunner: runner,
    };

    const result = await executor.execute({ document: narratorGraph({}), context });

    expect(result.status).toBe("succeeded");
    // 缺省来源判为 preset → 走原 synthetic 文本分支，runner 一次都不调用。
    expect(runner).not.toHaveBeenCalled();
    const out = result.nodeOutputs.n?.outputs as { text?: string; carrier?: unknown };
    expect(out.text).toBe("[synthetic narrator]\n");
    expect(out.carrier).toBeUndefined();
  });

  it("dispatches to the subgraph runner and maps outputsByPort.text to the narrator text output", async () => {
    const runner = vi.fn<NodeGraphSubgraphRunner>(async () => ({
      status: "succeeded",
      outputsByPort: { text: "narrated via subgraph" },
    }));
    const executor = createDefaultNodeGraphExecutor();
    const context: NodeGraphRuntimeContext = {
      accountId: "a",
      intent: "normal",
      dryRun: false,
      userInput: "hello",
      subgraphRunner: runner,
    };

    const result = await executor.execute({
      document: narratorGraph({ source: "subgraph", subgraphRef: { graphId: "narrator-sub", versionId: "v1" } }),
      context,
    });

    expect(result.status).toBe("succeeded");
    // 复用 subgraphRunner：一次调用，入参 ref / inputsByPort / parentNode 正确。
    expect(runner).toHaveBeenCalledTimes(1);
    const runArg = runner.mock.calls[0]?.[0];
    expect(runArg?.ref).toEqual({ graphId: "narrator-sub", versionId: "v1" });
    expect(runArg?.inputsByPort.user_input).toBe("hello");
    expect(runArg?.parentNode.id).toBe("n");

    const out = result.nodeOutputs.n?.outputs as { text?: string; carrier?: { source?: string; ref?: unknown } };
    expect(out.text).toBe("narrated via subgraph");
    expect(out.carrier?.source).toBe("subgraph");
    expect(out.carrier?.ref).toEqual({ graphId: "narrator-sub", versionId: "v1" });
  });

  it("falls back to a dry-run placeholder without dispatching in dry-run mode", async () => {
    const runner = vi.fn<NodeGraphSubgraphRunner>(async () => ({ status: "succeeded", outputsByPort: { text: "x" } }));
    const executor = createDefaultNodeGraphExecutor();
    const context: NodeGraphRuntimeContext = {
      accountId: "a",
      intent: "preview",
      dryRun: true,
      userInput: "hello",
      subgraphRunner: runner,
    };

    const result = await executor.execute({
      document: narratorGraph({ source: "subgraph", subgraphRef: { graphId: "narrator-sub" } }),
      context,
    });

    expect(result.status).toBe("succeeded");
    expect(runner).not.toHaveBeenCalled();
    const out = result.nodeOutputs.n?.outputs as { carrier?: { dispatched?: boolean }; text?: string };
    expect(out.carrier?.dispatched).toBe(false);
    expect(out.text).toBe("[dry-run Narrator (subgraph)]");
  });

  it("falls back to synthetic output when no subgraph runner is injected (no throw)", async () => {
    const executor = createDefaultNodeGraphExecutor();
    const context: NodeGraphRuntimeContext = {
      accountId: "a",
      intent: "normal",
      dryRun: false,
      userInput: "hello",
    };

    const result = await executor.execute({
      document: narratorGraph({ source: "subgraph", subgraphRef: { graphId: "narrator-sub" } }),
      context,
    });

    expect(result.status).toBe("succeeded");
    const narrator = result.nodeRuns.find((run) => run.nodeId === "n");
    expect(narrator?.status).toBe("succeeded");
    const out = result.nodeOutputs.n?.outputs as { carrier?: { dispatched?: boolean } };
    expect(out.carrier?.dispatched).toBe(false);
  });

  it("fails the narrator node and passes subgraph diagnostics through when the run fails", async () => {
    const runner: NodeGraphSubgraphRunner = async () => ({
      status: "failed",
      outputsByPort: {},
      diagnostics: [{ severity: "error", code: "node_graph_subgraph_cycle", message: "cycle detected", nodeId: "n" }],
    });
    const executor = createDefaultNodeGraphExecutor();
    const context: NodeGraphRuntimeContext = {
      accountId: "a",
      intent: "normal",
      dryRun: false,
      userInput: "hello",
      subgraphRunner: runner,
    };

    const result = await executor.execute({
      document: narratorGraph({ source: "subgraph", subgraphRef: { graphId: "narrator-sub" } }),
      context,
    });

    expect(result.status).toBe("failed");
    const narrator = result.nodeRuns.find((run) => run.nodeId === "n");
    expect(narrator?.status).toBe("failed");
    // 子图边界诊断（环）原样透传到节点运行诊断，未被吞掉、未被放宽。
    expect(narrator?.diagnostics?.some((d) => d.code === "node_graph_subgraph_cycle")).toBe(true);
  });

  it("throws NodeGraphNodeExecutionError with the narrator-specific failed code (helper unit)", async () => {
    const runner: NodeGraphSubgraphRunner = async () => ({
      status: "failed",
      outputsByPort: {},
      diagnostics: [{ severity: "error", code: "node_graph_subgraph_depth_exceeded", message: "too deep" }],
    });
    const node = { id: "n", type: "narration.narrator", typeVersion: "1", phase: "response", config: {} } as NodeGraphNode;
    const context: NodeGraphRuntimeContext = { accountId: "a", intent: "normal", dryRun: false, subgraphRunner: runner };

    const error = await dispatchCarrierSubgraph({
      node,
      inputs: {},
      context,
      subgraphRef: { graphId: "narrator-sub", versionId: null },
      label: "Narrator (subgraph)",
      outputPortMapping: () => ({ value: "", outputs: {} }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NodeGraphNodeExecutionError);
    const failed = error as NodeGraphNodeExecutionError;
    expect(failed.code).toBe(NARRATOR_SUBGRAPH_FAILED_CODE);
    // 诊断透传（不换码、不吞掉底层子图边界诊断）。
    expect(failed.diagnostics.some((d) => d.code === "node_graph_subgraph_depth_exceeded")).toBe(true);
  });

  it("maps to empty text with an unmapped warning when the subgraph exposes no mappable output", async () => {
    const runner = vi.fn<NodeGraphSubgraphRunner>(async () => ({
      status: "succeeded",
      outputsByPort: { alpha: "a", beta: "b" },
    }));
    const executor = createDefaultNodeGraphExecutor();
    const context: NodeGraphRuntimeContext = {
      accountId: "a",
      intent: "normal",
      dryRun: false,
      userInput: "hello",
      subgraphRunner: runner,
    };

    const result = await executor.execute({
      document: narratorGraph({ source: "subgraph", subgraphRef: { graphId: "narrator-sub" } }),
      context,
    });

    expect(result.status).toBe("succeeded");
    expect(runner).toHaveBeenCalledTimes(1);
    const out = result.nodeOutputs.n?.outputs as { text?: string; diagnostics?: Array<{ code: string }> };
    expect(out.text).toBe("");
    expect(out.diagnostics?.some((d) => d.code === "node_graph_narrator_subgraph_output_unmapped")).toBe(true);
  });
});

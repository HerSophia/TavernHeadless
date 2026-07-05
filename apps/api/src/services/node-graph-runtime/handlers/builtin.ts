import {
  computeNodeGraphControlSignal,
  evaluateNodeGraphConditionWithTrace,
  readNodeGraphSubgraphRef,
  resolveNodeGraphAgentSource,
  type NodeGraphConditionExpr,
  type NodeGraphConditionTraceEntry,
  type NodeGraphDiagnostic,
  type NodeGraphNode,
  type NodeGraphNodeRunOutput,
} from "@tavern/core";

import type { AgentOutputDispatchRequest } from "../../agent-runtime/agent-output-dispatcher.js";
import type { AgentMediumSelection } from "../../agent-runtime/agent-medium-types.js";
import { NodeGraphNodeExecutionError } from "../executor.js";
import type {
  NodeGraphNodeHandler,
  NodeGraphNodeHandlerRegistry,
  NodeGraphNodeInputs,
  NodeGraphRuntimeContext,
} from "../node-handler-registry.js";
import { dispatchCarrierSubgraph } from "./carrier-subgraph-dispatch.js";
import { readString, textOutput } from "./handler-io.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readDialogueExamples(character: Record<string, unknown> | undefined): unknown {
  if (!character) {
    return "";
  }
  for (const key of ["exampleDialogue", "mes_example", "dialogueExamples", "examples"] as const) {
    const value = character[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }
  return "";
}

function firstInput(inputs: NodeGraphNodeInputs, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (inputs[key] !== undefined) {
      return inputs[key];
    }
  }
  return undefined;
}

function jsonOutput(
  title: string,
  value: unknown,
  source: "live" | "dry_run" | "synthetic" = "live",
  outputs: Record<string, unknown> = {},
): NodeGraphNodeRunOutput {
  return {
    value,
    outputs: { value, json: value, ...outputs },
    preview: {
      kind: "json",
      title,
      value,
      source,
    },
  };
}

function renderTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = key.split(".").reduce<unknown>((current, segment) => asRecord(current)[segment], variables);
    return readString(value);
  });
}

function buildBlock(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(readString).filter(Boolean).join("\n");
  }
  return readString(value);
}

function readCurrentInputValue(context: NodeGraphRuntimeContext): unknown {
  if (context.userInput !== undefined) {
    return context.userInput;
  }
  if (context.input && "user_input" in context.input) {
    return context.input.user_input;
  }
  if (context.input && "value" in context.input) {
    return context.input.value;
  }
  return context.input ?? "";
}

function makeHandler(
  type: string,
  execute: NodeGraphNodeHandler["execute"],
): NodeGraphNodeHandler {
  return { type, execute };
}

function makeCachedOnlyOutput(node: NodeGraphNode, context: NodeGraphRuntimeContext, title: string): NodeGraphNodeRunOutput {
  const cached = context.cachedNodeOutputs?.[node.id];
  if (cached) {
    return {
      ...cached,
      preview: cached.preview ? { ...cached.preview, stale: true, source: "cached" } : undefined,
    };
  }
  const planned = { planned: true, nodeId: node.id, nodeType: node.type };
  return jsonOutput(title, planned, "synthetic", { brief: planned, diagnostics: [] });
}

/**
 * NG2-9：把承载子图的边界输出（`outputsByPort`）映射为 narrator 的文本输出。
 *
 * 子图 `group.output` 端口按名称对齐：优先取名为 `text` 的输出；否则取子图**单一输出**兜底；
 * 仍缺（无 text 且非单一输出）则映射为空文本并附一条 `node_graph_narrator_subgraph_output_unmapped`
 * warning 诊断（不阻断）。
 */
function mapNarratorSubgraphText(
  node: NodeGraphNode,
  outputsByPort: Record<string, unknown>,
): { text: string; diagnostics: NodeGraphDiagnostic[] } {
  if (outputsByPort.text !== undefined && outputsByPort.text !== null) {
    return { text: readString(outputsByPort.text), diagnostics: [] };
  }
  const keys = Object.keys(outputsByPort);
  if (keys.length === 1) {
    const only = outputsByPort[keys[0]!];
    if (only !== undefined && only !== null) {
      return { text: readString(only), diagnostics: [] };
    }
  }
  return {
    text: "",
    diagnostics: [{
      severity: "warning",
      code: "node_graph_narrator_subgraph_output_unmapped",
      message: `Narrator subgraph for node '${node.id}' produced no mappable text output; mapped to empty text.`,
      nodeId: node.id,
    }],
  };
}

function buildMessagesFromInputs(inputs: NodeGraphNodeInputs, context: NodeGraphRuntimeContext): Array<{ role: string; content: string; source?: string }> {
  const existing = firstInput(inputs, ["messages"]);
  const messages = Array.isArray(existing) ? [...existing] as Array<{ role: string; content: string; source?: string }> : [];
  const blocks = Object.entries(inputs)
    .filter(([key]) => key !== "messages")
    .map(([, value]) => buildBlock(value))
    .filter(Boolean);
  for (const block of blocks) {
    messages.push({ role: "system", content: block, source: "node_graph:block" });
  }
  if (messages.length === 0 && context.userInput) {
    messages.push({ role: "user", content: context.userInput, source: "node_graph:user_input" });
  }
  return messages;
}

function toDispatchRequest(node: NodeGraphNode, inputs: NodeGraphNodeInputs, context: NodeGraphRuntimeContext): AgentOutputDispatchRequest | null {
  const config = asRecord(node.config);
  if (!context.projectId) {
    return null;
  }
  switch (node.type) {
    case "output.derived_output":
      return {
        target: "derived_output",
        actorAccountId: context.accountId,
        projectId: context.projectId,
        domain: readString(config.domain ?? "node_graph"),
        value: firstInput(inputs, ["value", "record", "summary"]) ?? {},
        status: "draft",
        sourceSessionId: context.sessionId ?? null,
        sourceFloorId: context.floorId ?? null,
        sourcePageId: context.pageId ?? null,
      };
    case "output.project_inbox":
      return {
        target: "project_inbox",
        actorAccountId: context.accountId,
        projectId: context.projectId,
        type: readString(config.type ?? "node_graph.proposal"),
        title: readString(config.title ?? "NodeGraph proposal"),
        payload: firstInput(inputs, ["payload", "value", "summary"]) ?? {},
        sourceSessionId: context.sessionId ?? null,
        sourceFloorId: context.floorId ?? null,
        sourcePageId: context.pageId ?? null,
      };
    case "output.session_state_proposal":
      if (!context.sessionId) {
        return null;
      }
      return {
        target: "session_state_proposal",
        accountId: context.accountId,
        sessionId: context.sessionId,
        summary: readString(config.summary ?? "NodeGraph session state proposal"),
        value: firstInput(inputs, ["proposal", "value"]) ?? {},
      };
    default:
      return null;
  }
}

function readMedium(config: Record<string, unknown>): AgentMediumSelection {
  const medium = asRecord(config.medium);
  const kind = medium.kind === "temporary_conversation" || medium.kind === "background_job"
    ? medium.kind
    : "single_call";
  return {
    kind,
    deliveryTarget: typeof medium.deliveryTarget === "string" ? medium.deliveryTarget as AgentMediumSelection["deliveryTarget"] : "return_inline",
  } as AgentMediumSelection;
}

function readBooleanInput(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * NG2-CORE：求值控制流节点的布尔判定。
 *
 * branch / gate 优先消费 `condition` 布尔输入；否则求值 config.condition；
 * condition 节点无 `condition` 输入端口，只用 config.condition。
 */
function evaluateControlNodeCondition(
  node: NodeGraphNode,
  inputs: NodeGraphNodeInputs,
  context: NodeGraphRuntimeContext,
): { result: boolean; trace: NodeGraphConditionTraceEntry[]; source: "input" | "config" | "none" } {
  const inputBoolean = readBooleanInput(firstInput(inputs, ["condition"]));
  if (inputBoolean !== undefined) {
    return { result: inputBoolean, trace: [], source: "input" };
  }
  const condition = asRecord(node.config).condition;
  if (condition && typeof condition === "object") {
    const conditionContext = context.conditionContext && typeof context.conditionContext === "object"
      ? context.conditionContext as Record<string, unknown>
      : {};
    const { result, trace } = evaluateNodeGraphConditionWithTrace(condition as NodeGraphConditionExpr, conditionContext);
    return { result, trace, source: "config" };
  }
  return { result: false, trace: [], source: "none" };
}

export function registerBuiltinNodeGraphHandlers(registry: NodeGraphNodeHandlerRegistry): void {
  registry.register(makeHandler("source.user_input", ({ context }) =>
    textOutput("User Input", context.userInput ?? readString(context.input?.user_input ?? ""))));

  registry.register(makeHandler("source.global_input", ({ context }) => {
    const value = readCurrentInputValue(context);
    if (typeof value === "string") {
      return textOutput("Global Input", value, "live", { value });
    }
    return jsonOutput("Global Input", value, "live", { value });
  }));

  registry.register(makeHandler("source.chat_history", ({ context }) => ({
    value: context.chatHistory ?? [],
    outputs: {
      messages: context.chatHistory ?? [],
      text: JSON.stringify(context.chatHistory ?? []),
    },
    preview: {
      kind: "messages",
      title: "Chat History",
      value: context.chatHistory ?? [],
      source: "live",
    },
  })));

  registry.register(makeHandler("source.character", ({ context }) =>
    jsonOutput("Character", context.character ?? {}, "live", {
      text: readString(context.character ?? {}),
    })));

  registry.register(makeHandler("source.persona", ({ context }) =>
    jsonOutput("Persona", context.persona ?? {}, "live", {
      text: readString(context.persona ?? {}),
    })));

  registry.register(makeHandler("source.dialogue_examples", ({ context }) => {
    const examples = readDialogueExamples(context.character);
    return jsonOutput("Dialogue Examples", examples, "live", {
      text: readString(examples),
    });
  }));

  registry.register(makeHandler("source.session_state", ({ context }) =>
    jsonOutput("Session State", context.sessionState ?? {}, "live", {
      state: context.sessionState ?? {},
    })));

  registry.register(makeHandler("select.worldbook_match", ({ inputs, context }) => {
    const selection = firstInput(inputs, ["entries"]) ?? context.worldbookEntries ?? [];
    return jsonOutput("Worldbook Selection", selection, "live", {
      selection,
      text: readString(selection),
    });
  }));

  registry.register(makeHandler("select.memory_retrieve", ({ context }) =>
    jsonOutput("Memory Selection", context.memorySelection ?? [], "live", {
      selection: context.memorySelection ?? [],
      text: readString(context.memorySelection ?? []),
    })));

  registry.register(makeHandler("compose.session_state_projection_block", ({ inputs }) => {
    const state = firstInput(inputs, ["state"]) ?? {};
    const block = `[Session State]\n${readString(state)}`;
    return textOutput("Session State Projection", block, "live", { block });
  }));

  registry.register(makeHandler("compose.template_render", ({ node, inputs, context }) => {
    const config = asRecord(node.config);
    const variables = {
      ...context.variables,
      ...asRecord(firstInput(inputs, ["data"])),
    };
    // `template` 为通用模板字段；导入的酒馆预设块把正文放在 `content`，二者择一作为提示词正文。
    const rendered = renderTemplate(readString(config.template ?? config.content ?? ""), variables);
    return textOutput("Template", rendered, "live", { block: rendered });
  }));

  registry.register(makeHandler("compose.text_to_block", ({ inputs }) => {
    const text = readString(firstInput(inputs, ["text", "value"]));
    return textOutput("Text to Block", text, "live", { block: text });
  }));

  registry.register(makeHandler("select.token_budget_allocator", ({ inputs }) => {
    const blocks = firstInput(inputs, ["blocks"]) ?? inputs;
    return jsonOutput("Token Budget", blocks, "live", { blocks, diagnostics: [] });
  }));

  registry.register(makeHandler("compose.final_messages", ({ inputs, context }) => {
    const messages = buildMessagesFromInputs(inputs, context);
    return {
      value: messages,
      outputs: {
        messages,
        prompt_ir: { kind: "node_graph_prompt_ir", messages },
        diagnostics: [],
      },
      preview: {
        kind: "messages",
        title: "Final Messages",
        summary: `${messages.length} message(s)`,
        value: messages,
        tokenEstimate: Math.ceil(JSON.stringify(messages).length / 4),
        source: context.dryRun ? "dry_run" : "live",
      },
    };
  }));

  registry.register(makeHandler("agent.director_plan", ({ node, context }) =>
    makeCachedOnlyOutput(node, context, "Director Plan")));

  registry.register(makeHandler("agent.player_agency_precheck", ({ node, context }) =>
    makeCachedOnlyOutput(node, context, "Player Agency Precheck")));

  registry.register(makeHandler("agent.call", async ({ node, inputs, context }) => {
    const cached = context.cachedNodeOutputs?.[node.id];
    const config = asRecord(node.config);
    const medium = readMedium(config);
    if (context.dryRun) {
      return cached ?? jsonOutput("Agent Call", {
        planned: true,
        medium,
        config: node.config ?? null,
      }, "synthetic", {
        result: { planned: true, medium },
        diagnostics: [],
      });
    }
    if (!context.agentRouter) {
      throw new NodeGraphNodeExecutionError(
        "agent.call requires AgentExecutorRouter in normal runs.",
        [{
          severity: "error",
          code: "node_graph_agent_router_missing",
          message: "agent.call requires AgentExecutorRouter in normal runs.",
          nodeId: node.id,
        }],
        "node_graph_agent_router_missing",
      );
    }
    if (medium.kind === "single_call") {
      throw new NodeGraphNodeExecutionError(
        "agent.call single_call medium requires an injectable inline executor and is not enabled in NodeGraph R5.1.",
        [{
          severity: "error",
          code: "node_graph_agent_call_single_call_unsupported",
          message: "agent.call single_call medium requires an injectable inline executor and is not enabled in NodeGraph R5.1.",
          nodeId: node.id,
        }],
        "node_graph_agent_call_single_call_unsupported",
      );
    }
    const route = await context.agentRouter.routeByMedium(medium, {
      temporaryConversationRequest: {
        ...asRecord(config.temporaryConversationRequest),
        accountId: context.accountId,
        spec: {
          id: node.id,
          roleKind: "director",
          phase: node.phase === "post_response" ? "post_response" : "pre_response",
          stabilityHint: node.phase === "pre_response" ? "floor" : "page",
          failurePolicy: "fail_closed",
          medium,
          ...asRecord(asRecord(config.temporaryConversationRequest).spec),
        },
        medium,
        source: context.projectId
          ? { kind: "project", projectId: context.projectId }
          : { kind: "session", sourceSessionId: context.sessionId ?? "" },
        inputMessage: readString(firstInput(inputs, ["input", "value"]) ?? context.input ?? ""),
      } as never,
      backgroundJobRequest: {
        accountId: context.accountId,
        workspaceId: context.workspaceId ?? "",
        projectId: context.projectId ?? "",
        agentBindingId: readString(config.agentBindingId),
        triggerReason: readString(config.triggerReason ?? "node_graph.agent_call"),
        actorClientId: context.actorClientId ?? null,
        dryRun: context.dryRun,
        inputJson: asRecord(firstInput(inputs, ["input", "value"]) ?? context.input ?? {}),
        // R6-1 nested lineage（缺口 3）：让入队的 agent.run 反查父级 graph run。
        rootRunId: context.rootRunId ?? context.graphRunId ?? null,
        parentRunId: context.graphRunId ?? null,
        parentRuntimeKind: context.graphRunId ? "node_graph_run" : null,
      },
    });
    if (route.kind === "background_job" && route.result.status === "rejected") {
      throw new NodeGraphNodeExecutionError(
        route.result.message,
        [{
          severity: "error",
          code: route.result.code,
          message: route.result.message,
          nodeId: node.id,
        }],
        route.result.code,
      );
    }
    return jsonOutput("Agent Call", route, "live", {
      result: route,
      brief: route,
      nested_job_refs: route.kind === "background_job" && route.result.status === "enqueued"
        ? [{
            jobId: route.result.jobId,
            medium: "background_job",
            created: route.result.created,
            dryRun: route.result.dryRun,
          }]
        : [],
      diagnostics: [],
    });
  }));

  // NG2-9：承载来源二选一（NG2-7 契约）。narrator 有效来源 = subgraph 且有合法 subgraphRef 时，
  // 走子图图链路（复用既有 subgraphRunner，边界原样透传）；preset / 缺省来源一字不差走原分支。
  // 分派只在执行器逐节点运行上下文（运行 job / 试运行 / 预览 / 子图引用）生效——真实主链 chat turn
  // 不逐节点执行图（属 NG2-14），故本分支不进真实正史；§10.4 Narrator 强制内联（透明摊平）延后 NG2-14。
  registry.register(makeHandler("narration.narrator", async ({ node, inputs, context }) => {
    const cached = context.cachedNodeOutputs?.[node.id];
    if (cached) {
      return cached;
    }

    const subgraphRef = resolveNodeGraphAgentSource(node) === "subgraph"
      ? readNodeGraphSubgraphRef(node)
      : null;
    if (subgraphRef) {
      return dispatchCarrierSubgraph({
        node,
        inputs,
        context,
        subgraphRef,
        label: "Narrator (subgraph)",
        outputPortMapping: (out) => {
          const { text, diagnostics } = mapNarratorSubgraphText(node, out);
          return textOutput("Narrator (subgraph)", text, "live", {
            carrier: { source: "subgraph", ref: subgraphRef },
            subgraph_outputs: out,
            diagnostics,
          });
        },
      });
    }

    // 原分支：preset / 缺省来源。真实生成由 NG2-8 传统链路（配方解析层）负责，此处仍为 synthetic / dry-run 文本。
    const messages = firstInput(inputs, ["messages"]);
    return textOutput(
      "Narrator",
      context.dryRun ? "[dry-run narrator output]" : `[synthetic narrator]\n${readString(messages)}`,
      context.dryRun ? "dry_run" : "synthetic",
    );
  }));

  registry.register(makeHandler("verify.continuity", ({ node, context }) =>
    makeCachedOnlyOutput(node, context, "Continuity Verification")));

  registry.register(makeHandler("verify.player_agency_postcheck", ({ node, context }) =>
    makeCachedOnlyOutput(node, context, "Player Agency Verification")));

  registry.register(makeHandler("output.commit_gate", ({ inputs, context }) =>
    jsonOutput("Commit Gate", {
      decision: context.dryRun ? "preview_only" : "proposal",
      text: firstInput(inputs, ["text"]),
      verifier: firstInput(inputs, ["verifier"]),
    }, context.dryRun ? "dry_run" : "live", {
      decision: {
        decision: context.dryRun ? "preview_only" : "proposal",
        text: firstInput(inputs, ["text"]),
        verifier: firstInput(inputs, ["verifier"]),
      },
      diagnostics: [],
    })));

  registry.register(makeHandler("output.graph_run_summary", ({ inputs }) =>
    jsonOutput("Graph Run Summary", inputs, "live", {
      summary: inputs,
      diagnostics: [],
    })));

  for (const type of ["output.derived_output", "output.project_inbox", "output.session_state_proposal"] as const) {
    registry.register(makeHandler(type, ({ node, inputs, context }) => {
      const request = toDispatchRequest(node, inputs, context);
      if (context.dryRun || !request) {
        return jsonOutput(type, { planned: true, request }, "dry_run", {
          record: null,
          proposal: request,
          diagnostics: [],
        });
      }
      return jsonOutput(type, { pendingDispatchRequest: request }, "synthetic", {
        record: { pendingDispatchRequest: request },
        proposal: { pendingDispatchRequest: request },
        diagnostics: [],
      });
    }));
  }

  registry.register(makeHandler("group.input", ({ node, context }) => {
    const config = asRecord(node.config);
    // NG2-β：单 Group Input 多端口（config.ports）。按 portName 从 context.input 取，
    // 输出到对应 outputs.<portName>，供下游边解析。
    if (Array.isArray(config.ports)) {
      const outputs: Record<string, unknown> = {};
      for (const port of config.ports) {
        const name = readString(asRecord(port).name);
        if (name) {
          outputs[name] = context.input?.[name];
        }
      }
      return jsonOutput("Group Input", outputs, "live", outputs);
    }
    // 旧式单端口兜底。
    const key = readString(config.portName ?? config.key ?? node.id);
    return jsonOutput("Group Input", context.input?.[key]);
  }));

  registry.register(makeHandler("group.output", ({ node, inputs }) => {
    const config = asRecord(node.config);
    // NG2-β：单 Group Output 多端口（config.ports）。收集各 portName 输入，回流到 outputs.<portName>，
    // 供 group.node runner 映射回实例输出端口。
    if (Array.isArray(config.ports)) {
      const outputs: Record<string, unknown> = {};
      for (const port of config.ports) {
        const name = readString(asRecord(port).name);
        if (name) {
          outputs[name] = inputs[name];
        }
      }
      return jsonOutput("Group Output", outputs, "live", outputs);
    }
    return jsonOutput("Group Output", firstInput(inputs, ["value"]));
  }));

  // NG2-β：NodeGroup 实例。把实例输入端口值映射为子图边界输入，递归执行被引用子图，
  // 再把子图边界输出映射回实例输出端口（outputs.<portName>，供下游边解析）。
  registry.register(makeHandler("group.node", async ({ node, inputs, context }) => {
    const config = asRecord(node.config);
    const ref = asRecord(config.ref);
    const graphId = readString(ref.graphId);
    const iface = asRecord(config.interface);
    const declaredOutputs = Array.isArray(iface.outputs) ? iface.outputs : [];

    // 实例输入端口值（剔除无数据边时的占位 __node_id）。
    const inputsByPort: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(inputs)) {
      if (key !== "__node_id") {
        inputsByPort[key] = value;
      }
    }

    // dry-run 或未注入 runner：合成兜底，按声明输出端口给出 null，避免下游解析崩溃。
    if (context.dryRun || !context.subgraphRunner) {
      const synthetic: Record<string, unknown> = {};
      for (const port of declaredOutputs) {
        const name = readString(asRecord(port).name);
        if (name) {
          synthetic[name] = null;
        }
      }
      return jsonOutput("Node Group", { planned: true, ref: { graphId } }, context.dryRun ? "dry_run" : "synthetic", {
        ...synthetic,
        diagnostics: [],
      });
    }

    const result = await context.subgraphRunner(
      {
        ref: { graphId, versionId: typeof ref.versionId === "string" ? ref.versionId : undefined },
        inputsByPort,
        parentNode: node,
      },
      context,
    );
    if (result.status === "failed") {
      throw new NodeGraphNodeExecutionError(
        `Node group '${node.id}' subgraph run failed.`,
        result.diagnostics ?? [{
          severity: "error",
          code: "node_graph_group_node_subgraph_failed",
          message: `Node group '${node.id}' subgraph run failed.`,
          nodeId: node.id,
        }],
        "node_graph_group_node_subgraph_failed",
      );
    }
    return jsonOutput("Node Group", result.outputsByPort, "live", {
      ...result.outputsByPort,
      diagnostics: result.diagnostics ?? [],
    });
  }));

  // NG2-CORE：控制流节点。condition 算 boolean；branch/gate 产出控制信号门控下游。
  registry.register(makeHandler("control.condition", ({ node, inputs, context }) => {
    const { result, trace, source } = evaluateControlNodeCondition(node, inputs, context);
    return {
      value: result,
      outputs: { result, controlTrace: trace, conditionSource: source },
      preview: {
        kind: "json",
        title: "Condition",
        summary: `result=${result}`,
        value: { result, trace },
        source: context.dryRun ? "dry_run" : "live",
      },
    };
  }));

  registry.register(makeHandler("control.branch", ({ node, inputs, context }) => {
    const { result, trace, source } = evaluateControlNodeCondition(node, inputs, context);
    const control = computeNodeGraphControlSignal("control.branch", result);
    return {
      value: result,
      outputs: { result, true: result, false: !result, control, controlTrace: trace, conditionSource: source },
      preview: {
        kind: "json",
        title: "Branch",
        summary: `→ ${result ? "true" : "false"}`,
        value: { result, activePorts: control.activePorts, trace },
        source: context.dryRun ? "dry_run" : "live",
      },
    };
  }));

  registry.register(makeHandler("control.gate", ({ node, inputs, context }) => {
    const { result, trace, source } = evaluateControlNodeCondition(node, inputs, context);
    const control = computeNodeGraphControlSignal("control.gate", result);
    const passthrough = firstInput(inputs, ["value"]);
    return {
      value: passthrough ?? result,
      outputs: { open: result, value: passthrough ?? null, control, controlTrace: trace, conditionSource: source },
      preview: {
        kind: "json",
        title: "Gate",
        summary: result ? "open" : "closed",
        value: { open: result, activePorts: control.activePorts, trace },
        source: context.dryRun ? "dry_run" : "live",
      },
    };
  }));
}

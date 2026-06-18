import type { NodeGraphNode, NodeGraphNodeRunOutput } from "@tavern/core";

import type { AgentOutputDispatchRequest } from "../../agent-runtime/agent-output-dispatcher.js";
import type { AgentMediumSelection } from "../../agent-runtime/agent-medium-types.js";
import { NodeGraphNodeExecutionError } from "../executor.js";
import type {
  NodeGraphNodeHandler,
  NodeGraphNodeHandlerRegistry,
  NodeGraphNodeInputs,
  NodeGraphRuntimeContext,
} from "../node-handler-registry.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : JSON.stringify(value);
}

function firstInput(inputs: NodeGraphNodeInputs, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (inputs[key] !== undefined) {
      return inputs[key];
    }
  }
  return undefined;
}

function textOutput(
  title: string,
  text: string,
  source: "live" | "dry_run" | "synthetic" = "live",
  outputs: Record<string, unknown> = {},
): NodeGraphNodeRunOutput {
  return {
    value: text,
    outputs: { text, ...outputs },
    preview: {
      kind: "text",
      title,
      value: text,
      tokenEstimate: Math.ceil(text.length / 4),
      source,
    },
  };
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

export function registerBuiltinNodeGraphHandlers(registry: NodeGraphNodeHandlerRegistry): void {
  registry.register(makeHandler("source.user_input", ({ context }) =>
    textOutput("User Input", context.userInput ?? readString(context.input?.user_input ?? ""))));

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
    const rendered = renderTemplate(readString(config.template ?? ""), variables);
    return textOutput("Template", rendered, "live", { block: rendered });
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

  registry.register(makeHandler("narration.narrator", ({ node, inputs, context }) => {
    const cached = context.cachedNodeOutputs?.[node.id];
    if (cached) {
      return cached;
    }
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
    return jsonOutput("Group Input", context.input?.[readString(config.key ?? node.id)]);
  }));

  registry.register(makeHandler("group.output", ({ inputs }) =>
    jsonOutput("Group Output", firstInput(inputs, ["value"]))));
}

import type {
  TokenCounter,
  ToolCallTransportKind,
  ToolDefinition,
} from "@tavern/core";
import {
  NATIVE_FUNCTION_CALL_TOOL_CALL_INSTRUCTIONS,
  TextProtocolToolListRenderer,
} from "@tavern/core";

import type { PromptRuntimeTrace } from "../prompt-assembler.js";

import type {
  FirstPartyStateContext,
  PromptRuntimeContributorOutput,
} from "./types.js";
import {
  buildFirstPartyStateProjectionRenderable,
  resolveContributorModeScope,
  type PromptRuntimeBuiltinContributorResult,
} from "./prompt-runtime-contributors.js";

const toolListRenderer = new TextProtocolToolListRenderer();

export function buildMemoryProjectionContributor(args: {
  promptMode: "compat_plus" | "native";
  memorySummary?: string;
  memoryTrace?: PromptRuntimeTrace["memory"];
}): PromptRuntimeBuiltinContributorResult {
  const summary = args.memorySummary?.trim();
  const structuredRenderable =
    !summary && args.memoryTrace
      ? buildStructuredMemorySelectionRenderable(args.memoryTrace)
      : undefined;
  if (!summary && !structuredRenderable) {
    return { kind: "memory_projection" };
  }

  const modeScope = resolveContributorModeScope(args.promptMode);
  const contributor: PromptRuntimeContributorOutput = {
    id: "builtin:memory_projection",
    kind: "memory_projection",
    sourceKind: "memory",
    modeScope,
    payload: {
      summary: summary ?? null,
      memoryTrace: args.memoryTrace ?? null,
    },
    promptRenderable: summary
      ? {
          title: "Memory summary",
          content: summary,
        }
      : structuredRenderable,
    trace: {
      deterministic: true,
      cacheScope: "floor",
    },
  };

  return { kind: "memory_projection", contributor };
}

function buildStructuredMemorySelectionRenderable(
  memoryTrace: NonNullable<PromptRuntimeTrace["memory"]>,
): { title: string; content: string } | undefined {
  const selectedItems = memoryTrace.selectedItems ?? [];
  if (selectedItems.length === 0) {
    return undefined;
  }

  return {
    title: "Memory selection",
    content: JSON.stringify(
      {
        selected_items: selectedItems.map((item) => ({
          memory_id: item.memoryId,
          scope: item.scope,
          scope_id: item.scopeId,
          branch_id: item.branchId ?? null,
          kind: item.kind,
          ...(item.source !== undefined ? { source: item.source } : {}),
          ...(item.score !== undefined ? { score: item.score } : {}),
          ...(item.tokenCount !== undefined
            ? { token_count: item.tokenCount }
            : {}),
        })),
      },
      null,
      2,
    ),
  };
}

export function buildStateProjectionContributor(args: {
  promptMode: "compat_plus" | "native";
  firstPartyStateContext?: FirstPartyStateContext;
}): PromptRuntimeBuiltinContributorResult {
  const renderable = buildFirstPartyStateProjectionRenderable(
    args.firstPartyStateContext,
  );
  if (!renderable) {
    return { kind: "state_projection" };
  }

  const modeScope = resolveContributorModeScope(args.promptMode);
  const contributor: PromptRuntimeContributorOutput = {
    id: "builtin:state_projection",
    kind: "state_projection",
    sourceKind: "state_projection",
    modeScope,
    payload: {
      scene: args.firstPartyStateContext?.scene ?? null,
      world: args.firstPartyStateContext?.world ?? null,
    },
    promptRenderable: renderable,
    trace: {
      deterministic: true,
      cacheScope: "floor",
    },
  };

  return { kind: "state_projection", contributor };
}

export function buildToolListContributor(args: {
  promptMode: "compat_strict" | "compat_plus" | "native";
  transport: ToolCallTransportKind;
  toolsForSlot: ToolDefinition[];
  tokenCounter?: TokenCounter;
}): PromptRuntimeBuiltinContributorResult {
  // native_function_call 走原生结构化工具通道，没有工具清单需要注入，但仍要给一段反幻觉
  // 协议说明：明确禁止模型在正文里写 <tool_call> / <tool_result> / <tool_response>
  // 文本块。这与 text_protocol 注入位置对称，避免「native 模式零协议说明」让模型脑补。
  if (args.transport === "native_function_call" && args.toolsForSlot.length > 0) {
    return buildNativeFunctionCallInstructionsContributor(args);
  }

  if (args.transport !== "text_protocol" || args.toolsForSlot.length === 0) {
    return { kind: "tool_list" };
  }

  const rendered = toolListRenderer.render({ tools: args.toolsForSlot });
  if (!rendered.content) {
    return { kind: "tool_list" };
  }

  // text_protocol 下，把工具调用协议说明前置到工具清单之前。清单只给出可用工具与
  // 参数 schema，协议说明才告诉模型该用什么格式输出 <tool_call>。主链路与图助手共用此入口。
  const content = `${toolListRenderer.renderInstructions()}\n\n${rendered.content}`;

  const modeScope = resolveContributorModeScope(args.promptMode);
  const contributor: PromptRuntimeContributorOutput = {
    id: "builtin:tool_list",
    kind: "tool_list",
    sourceKind: "tool_list",
    modeScope,
    payload: {
      transport: "text_protocol",
      toolNames: rendered.renderedToolNames,
      budgetGroup: "tool_list",
      ...(args.tokenCounter
        ? { tokenCount: args.tokenCounter.count(content) }
        : {}),
    },
    promptRenderable: {
      title: "Tool list",
      content,
    },
    trace: {
      deterministic: true,
      cacheScope: "floor",
    },
  };

  return { kind: "tool_list", contributor };
}

/**
 * native_function_call 模式下注入协议反幻觉说明。
 *
 * 与 text_protocol 的工具清单注入位置对称，但内容相反：text_protocol 教模型用文本块
 * 表达工具调用，native 则告诉模型工具调用走原生结构化通道、正文不要出现工具往返文本块。
 * native 模式没有 <tool_list> 清单（工具 schema 由 SDK 结构化下发），因此这里只注入说明文本。
 */
function buildNativeFunctionCallInstructionsContributor(args: {
  promptMode: "compat_strict" | "compat_plus" | "native";
  toolsForSlot: ToolDefinition[];
  tokenCounter?: TokenCounter;
}): PromptRuntimeBuiltinContributorResult {
  const content = NATIVE_FUNCTION_CALL_TOOL_CALL_INSTRUCTIONS;

  const modeScope = resolveContributorModeScope(args.promptMode);
  const contributor: PromptRuntimeContributorOutput = {
    id: "builtin:tool_list",
    kind: "tool_list",
    sourceKind: "tool_list",
    modeScope,
    payload: {
      transport: "native_function_call",
      toolNames: args.toolsForSlot.map((tool) => tool.name),
      budgetGroup: "tool_list",
      ...(args.tokenCounter
        ? { tokenCount: args.tokenCounter.count(content) }
        : {}),
    },
    promptRenderable: {
      title: "Tool calling protocol",
      content,
    },
    trace: {
      deterministic: true,
      cacheScope: "floor",
    },
  };

  return { kind: "tool_list", contributor };
}


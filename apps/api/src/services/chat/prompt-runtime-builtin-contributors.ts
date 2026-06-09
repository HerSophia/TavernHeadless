import type { ToolCallTransportKind, ToolDefinition } from "@tavern/core";
import { TextProtocolToolListRenderer } from "@tavern/core";

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
  const structuredRenderable = !summary && args.memoryTrace
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
    content: JSON.stringify({
      selected_items: selectedItems.map((item) => ({
        memory_id: item.memoryId,
        scope: item.scope,
        scope_id: item.scopeId,
        branch_id: item.branchId ?? null,
        kind: item.kind,
        ...(item.source !== undefined ? { source: item.source } : {}),
        ...(item.score !== undefined ? { score: item.score } : {}),
        ...(item.tokenCount !== undefined ? { token_count: item.tokenCount } : {}),
      })),
    }, null, 2),
  };
}

export function buildStateProjectionContributor(args: {
  promptMode: "compat_plus" | "native";
  firstPartyStateContext?: FirstPartyStateContext;
}): PromptRuntimeBuiltinContributorResult {
  const renderable = buildFirstPartyStateProjectionRenderable(args.firstPartyStateContext);
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
  promptMode: "compat_plus" | "native";
  transport: ToolCallTransportKind;
  toolsForSlot: ToolDefinition[];
}): PromptRuntimeBuiltinContributorResult {
  if (args.transport !== "text_protocol" || args.toolsForSlot.length === 0) {
    return { kind: "tool_list" };
  }

  const rendered = toolListRenderer.render({ tools: args.toolsForSlot });
  if (!rendered.content) {
    return { kind: "tool_list" };
  }

  const modeScope = resolveContributorModeScope(args.promptMode);
  const contributor: PromptRuntimeContributorOutput = {
    id: "builtin:tool_list",
    kind: "tool_list",
    sourceKind: "tool_list",
    modeScope,
    payload: {
      transport: "text_protocol",
      toolNames: rendered.renderedToolNames,
    },
    promptRenderable: {
      title: "Tool list",
      content: rendered.content,
    },
    trace: {
      deterministic: true,
      cacheScope: "floor",
    },
  };

  return { kind: "tool_list", contributor };
}

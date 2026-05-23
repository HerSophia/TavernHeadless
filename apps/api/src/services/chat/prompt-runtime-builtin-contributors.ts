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

export function buildMemoryProjectionContributor(args: {
  promptMode: "compat_plus" | "native";
  memorySummary?: string;
  memoryTrace?: PromptRuntimeTrace["memory"];
}): PromptRuntimeBuiltinContributorResult {
  const summary = args.memorySummary?.trim();
  if (!summary) {
    return { kind: "memory_projection" };
  }

  const modeScope = resolveContributorModeScope(args.promptMode);
  const contributor: PromptRuntimeContributorOutput = {
    id: "builtin:memory_projection",
    kind: "memory_projection",
    sourceKind: "memory",
    modeScope,
    payload: {
      summary,
      memoryTrace: args.memoryTrace ?? null,
    },
    promptRenderable: {
      title: "Memory summary",
      content: summary,
    },
    trace: {
      deterministic: true,
      cacheScope: "floor",
    },
  };

  return { kind: "memory_projection", contributor };
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

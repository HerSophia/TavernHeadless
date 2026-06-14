import type { ToolCallTransportKind, ToolDefinition } from "@tavern/core";

import type { PromptRuntimeTrace } from "../prompt-assembler.js";

import type {
  PromptRuntimeInjectionPromptMode,
} from "../prompt-runtime-injection-types.js";
import type {
  FirstPartyStateContext,
  PromptRuntimeContributorOutput,
} from "./types.js";
import { isContributorModeEnabled } from "./prompt-runtime-contributors.js";
import {
  buildMemoryProjectionContributor,
  buildStateProjectionContributor,
  buildToolListContributor,
} from "./prompt-runtime-builtin-contributors.js";

export interface PromptRuntimeContributorResolveArgs {
  promptMode: PromptRuntimeInjectionPromptMode;
  memorySummary?: string;
  memoryTrace?: PromptRuntimeTrace["memory"];
  firstPartyStateContext?: FirstPartyStateContext;
  transport?: ToolCallTransportKind;
  toolsForSlot?: ToolDefinition[];
  /**
   * R1 Agent Runtime（inline_mvp）的 aggregator 产出的额外 contributor。
   * 默认为空，不影响现有行为；仅在 AgenticTurnStrategy 打开时由上层传入。
   * 注入的 contributor 仍受 prompt mode 装配规则约束，compat_strict 不会渲染它们。
   */
  agentContributors?: PromptRuntimeContributorOutput[];
}

export interface PromptRuntimeContributorResolveResult {
  contributors: PromptRuntimeContributorOutput[];
}

export class PromptRuntimeContributorRunner {
  resolve(args: PromptRuntimeContributorResolveArgs): PromptRuntimeContributorResolveResult {
    const contributorModeEnabled = isContributorModeEnabled(args.promptMode);
    const promptMode = args.promptMode === "native" ? "native" : "compat_plus";
    const contributors: PromptRuntimeContributorOutput[] = [];

    if (contributorModeEnabled) {
      const memory = buildMemoryProjectionContributor({
        promptMode,
        memorySummary: args.memorySummary,
        memoryTrace: args.memoryTrace,
      });
      if (memory.contributor) {
        contributors.push(memory.contributor);
      }

      const state = buildStateProjectionContributor({
        promptMode,
        firstPartyStateContext: args.firstPartyStateContext,
      });
      if (state.contributor) {
        contributors.push(state.contributor);
      }
    }

    const toolList = buildToolListContributor({
      promptMode: args.promptMode,
      transport: args.transport ?? "none",
      toolsForSlot: args.toolsForSlot ?? [],
    });
    if (toolList.contributor) {
      contributors.push(toolList.contributor);
    }

    if (contributorModeEnabled && args.agentContributors?.length) {
      contributors.push(...args.agentContributors);
    }

    return { contributors };
  }
}

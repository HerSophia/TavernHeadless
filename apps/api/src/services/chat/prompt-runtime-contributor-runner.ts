import type { PromptRuntimeTrace } from "../prompt-assembler.js";

import type {
  FirstPartyStateContext,
  PromptRuntimeContributorOutput,
} from "./types.js";
import { isContributorModeEnabled } from "./prompt-runtime-contributors.js";
import {
  buildMemoryProjectionContributor,
  buildStateProjectionContributor,
} from "./prompt-runtime-builtin-contributors.js";

export interface PromptRuntimeContributorResolveArgs {
  promptMode: "compat_strict" | "compat_plus" | "native";
  memorySummary?: string;
  memoryTrace?: PromptRuntimeTrace["memory"];
  firstPartyStateContext?: FirstPartyStateContext;
}

export interface PromptRuntimeContributorResolveResult {
  contributors: PromptRuntimeContributorOutput[];
}

export class PromptRuntimeContributorRunner {
  resolve(args: PromptRuntimeContributorResolveArgs): PromptRuntimeContributorResolveResult {
    if (!isContributorModeEnabled(args.promptMode)) {
      return { contributors: [] };
    }

    const promptMode = args.promptMode === "native" ? "native" : "compat_plus";
    const contributors: PromptRuntimeContributorOutput[] = [];
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

    return { contributors };
  }
}

import type {
  PromptRuntimeClientInjectionInput,
  PromptRuntimeInjectionBuildResult,
  PromptRuntimeInjectionTraceItem,
  PromptRuntimeInjectionPromptMode,
} from "../prompt-runtime-injection-types.js";
import {
  PROMPT_RUNTIME_INJECTION_PLACEMENTS,
} from "../prompt-runtime-injection-types.js";
import { PromptRuntimeInjectionPlacementResolver } from "./prompt-runtime-injection-placement-resolver.js";

const DEFAULT_INJECTION_ORDER = 100;
const UNRESOLVED_PLACEMENT_PRIORITY = Number.MAX_SAFE_INTEGER;

const INTERNAL_PLACEMENT_PRIORITY = new Map(
  PROMPT_RUNTIME_INJECTION_PLACEMENTS.map((placement, index) => {
    const internalKey = new PromptRuntimeInjectionPlacementResolver().resolve({
      placement,
      promptMode: "compat_plus",
    }).internalKey;
    return [internalKey ?? placement, index] as const;
  }),
);

export interface PromptRuntimeInjectionContributorBuilderArgs {
  promptMode: PromptRuntimeInjectionPromptMode;
  injections?: PromptRuntimeClientInjectionInput[];
}

export class PromptRuntimeInjectionContributorBuilder {
  constructor(
    private readonly resolver: PromptRuntimeInjectionPlacementResolver = new PromptRuntimeInjectionPlacementResolver(),
  ) {}

  build(
    args: PromptRuntimeInjectionContributorBuilderArgs,
  ): PromptRuntimeInjectionBuildResult {
    const evaluated = (args.injections ?? []).map((injection, requestIndex) => {
      const scope = injection.scope ?? "request";
      const orderRequested = injection.order ?? DEFAULT_INJECTION_ORDER;
      const title = injection.title.trim();
      const content = injection.content.trim();
      const resolvedPlacement = this.resolver.resolve({
        placement: injection.placement,
        promptMode: args.promptMode,
      });

      const item: PromptRuntimeInjectionTraceItem = {
        requestIndex,
        sourceKind: injection.sourceKind,
        scope,
        placementRequested: injection.placement,
        orderRequested,
        title,
        contentLength: content.length,
        applied: false,
        ...(resolvedPlacement.internalKey
          ? { placementResolved: resolvedPlacement.internalKey }
          : {}),
      };

      const internalKey = resolvedPlacement.internalKey;
      if (!resolvedPlacement.resolved) {
        item.notAppliedReason = resolvedPlacement.reason;
        return { item, priority: UNRESOLVED_PLACEMENT_PRIORITY };
      }

      if (!title || !content || !internalKey) {
        item.notAppliedReason = "empty_title_or_content";
        return {
          item,
          priority: internalKey
            ? INTERNAL_PLACEMENT_PRIORITY.get(internalKey) ?? UNRESOLVED_PLACEMENT_PRIORITY
            : UNRESOLVED_PLACEMENT_PRIORITY,
        };
      }

      item.applied = true;
      return {
        item,
        priority: INTERNAL_PLACEMENT_PRIORITY.get(internalKey) ?? UNRESOLVED_PLACEMENT_PRIORITY,
        renderable: {
          sourceKind: injection.sourceKind,
          title,
          content,
          internalPlacementKey: internalKey,
          requestIndex,
          requestedPlacement: injection.placement,
          requestedOrder: orderRequested,
          scope,
        },
      };
    });

    const sorted = [...evaluated].sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      if (left.item.orderRequested !== right.item.orderRequested) {
        return left.item.orderRequested - right.item.orderRequested;
      }
      return left.item.requestIndex - right.item.requestIndex;
    });

    return {
      renderables: sorted
        .filter((entry) => entry.renderable !== undefined)
        .map((entry) => entry.renderable!),
      items: sorted.map((entry) => entry.item),
    };
  }
}

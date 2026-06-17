import type {
  PromptRuntimeInjectionBuildResult,
  PromptRuntimeInjectionBuilderInput,
  PromptRuntimeInjectionTraceItem,
  PromptRuntimeInjectionPromptMode,
  PromptRuntimeInjectionScope,
} from "../prompt-runtime-injection-types.js";
import {
  PROMPT_RUNTIME_INJECTION_PLACEMENTS,
} from "../prompt-runtime-injection-types.js";
import {
  INTERNAL_PLACEMENT_KEYS,
  PromptRuntimeInjectionPlacementResolver,
} from "./prompt-runtime-injection-placement-resolver.js";

const DEFAULT_INJECTION_ORDER = 100;
const UNRESOLVED_PLACEMENT_PRIORITY = Number.MAX_SAFE_INTEGER;
const INJECTION_SCOPE_PRIORITY: Record<PromptRuntimeInjectionScope, number> = {
  session: 0,
  branch: 1,
  request: 2,
};

/**
 *来源优先级，仅作为「同 placement、同 order、同 scope」时的次级兜底排序键。
 * 不改变跨位置语义，也不构成对外可滥用面（客户端无法声明 system_override）。
 */
function sourceKindPriority(sourceKind: string): number {
  switch (sourceKind) {
    case "system_override":
      return 0;
    case "agent_injection":
    case "client_injection":
      return 1;
    case "debug_injection":
      return 2;
    default:
      return 1;
  }
}

const INTERNAL_PLACEMENT_PRIORITY = new Map(
 PROMPT_RUNTIME_INJECTION_PLACEMENTS.map((placement, index) => {
    return [INTERNAL_PLACEMENT_KEYS[placement], index] as const;
  }),
);

export interface PromptRuntimeInjectionContributorBuilderArgs {
  promptMode: PromptRuntimeInjectionPromptMode;
  injections?: PromptRuntimeInjectionBuilderInput[];
  now?: number;
}

export class PromptRuntimeInjectionContributorBuilder {
  constructor(
    private readonly resolver: PromptRuntimeInjectionPlacementResolver = new PromptRuntimeInjectionPlacementResolver(),
  ) {}

  build(
    args: PromptRuntimeInjectionContributorBuilderArgs,
  ): PromptRuntimeInjectionBuildResult {
    const now = args.now ?? Date.now();
    const evaluated = (args.injections ?? []).map((injection, requestIndex) => {
      const scope = injection.scope?? "request";
      const enabled = injection.enabled ?? true;
      const orderRequested = injection.order ?? DEFAULT_INJECTION_ORDER;
      const title = injection.title.trim();
      const content = injection.content.trim();
      const resolvedPlacement = this.resolver.resolve({
        placement: injection.placement,
        promptMode: args.promptMode,
        placementParams: injection.placementParams,
      });

      const item: PromptRuntimeInjectionTraceItem = {
        requestIndex,
        sourceKind: injection.sourceKind,
        ...(injection.injectionId ? { injectionId: injection.injectionId } : {}),
        enabled,
        scope,
        placementRequested: injection.placement,
        ...(injection.placementParams ? { placementParamsRequested: injection.placementParams } : {}),
        orderRequested,
        title,
        contentLength: content.length,
        applied: false,
        ...(resolvedPlacement.internalKey
          ? { placementResolved: resolvedPlacement.internalKey }
          : {}),
        ...(resolvedPlacement.anchor ? { anchorResolved: resolvedPlacement.anchor } : {}),
        ...(injection.sourceChain ? { sourceChain: injection.sourceChain } : {}),
      };

      const internalKey = resolvedPlacement.internalKey;
      const placementPriority = internalKey
        ? INTERNAL_PLACEMENT_PRIORITY.get(internalKey) ?? UNRESOLVED_PLACEMENT_PRIORITY
        : UNRESOLVED_PLACEMENT_PRIORITY;
      const createdAt = injection.createdAt ?? Number.MAX_SAFE_INTEGER;
      const scopePriority = INJECTION_SCOPE_PRIORITY[scope];
      const sourcePriority = sourceKindPriority(injection.sourceKind);

      if (!enabled) {
        item.notAppliedReason = "disabled";
        return { item, priority: placementPriority, scopePriority, sourcePriority, createdAt };
      }

      if (isExpiredInjection(injection, now)) {
        item.notAppliedReason = "expired";
        return { item, priority: placementPriority, scopePriority, sourcePriority, createdAt };
      }

      if (injection.modeScope && injection.modeScope !== args.promptMode) {
        item.notAppliedReason = "mode_scope_mismatch";
        return { item, priority: placementPriority, scopePriority, sourcePriority, createdAt };
      }

      if (!resolvedPlacement.resolved) {
        item.notAppliedReason = resolvedPlacement.reason;
        return {
          item,
          priority: placementPriority === UNRESOLVED_PLACEMENT_PRIORITY ? UNRESOLVED_PLACEMENT_PRIORITY : placementPriority,
          scopePriority,
          sourcePriority,
          createdAt,
        };
      }

      if (!title || !content || !internalKey) {
        item.notAppliedReason = "empty_title_or_content";
        return { item, priority: placementPriority, scopePriority, sourcePriority, createdAt };
      }

      item.applied = true;
      return {
        item,
        priority: placementPriority,
        scopePriority,
        sourcePriority,
        createdAt,
        renderable: {
          sourceKind: injection.sourceKind,
          title,
          content,
          internalPlacementKey: internalKey,
          requestIndex,
          requestedPlacement: injection.placement,
          requestedOrder: orderRequested,
          scope,
          ...(resolvedPlacement.anchor ? { anchor: resolvedPlacement.anchor } : {}),
          ...(injection.sourceChain ? { sourceChain: injection.sourceChain } : {}),
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
      if (left.scopePriority !== right.scopePriority) {
        return left.scopePriority - right.scopePriority;
      }
      if (left.sourcePriority !== right.sourcePriority) {
        return left.sourcePriority - right.sourcePriority;
      }
      if (left.item.scope !== "request" && right.item.scope !== "request" && left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
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

function isExpiredInjection(
  injection: PromptRuntimeInjectionBuilderInput,
  now: number,
): boolean {
  if (injection.ttlMs === undefined || injection.ttlMs === null) {
    return false;
  }

  if (injection.createdAt === undefined) {
    return false;
  }

  return injection.createdAt + injection.ttlMs <= now;
}

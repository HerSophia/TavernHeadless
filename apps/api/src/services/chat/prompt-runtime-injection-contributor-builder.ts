import type { TokenCounter } from "@tavern/core";

import {
  PROMPT_RUNTIME_INJECTION_BUDGET_GROUP,
  PROMPT_RUNTIME_INJECTION_LIMITS,
  getPromptRuntimeInjectionScopeLimit,
  resolveInjectionVisibility,
  type PromptRuntimeInjectionGovernanceLimits,
} from "../prompt-runtime/injection-governance.js";
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
  tokenCounter?: TokenCounter;
  limits?: PromptRuntimeInjectionGovernanceLimits;
}

export class PromptRuntimeInjectionContributorBuilder {
  constructor(
    private readonly resolver: PromptRuntimeInjectionPlacementResolver = new PromptRuntimeInjectionPlacementResolver(),
  ) {}

  build(
    args: PromptRuntimeInjectionContributorBuilderArgs,
  ): PromptRuntimeInjectionBuildResult {
    const now = args.now ?? Date.now();
    const limits = args.limits ?? PROMPT_RUNTIME_INJECTION_LIMITS;
    const scopeSeenCount: Record<PromptRuntimeInjectionScope, number> = {
      request: 0,
      session: 0,
      branch: 0,
    };
    let totalAcceptedTokens = 0;
    const evaluated = (args.injections ?? []).map((injection, requestIndex) => {
      const scope = injection.scope?? "request";
      const enabled = injection.enabled ?? true;
      const orderRequested = injection.order ?? DEFAULT_INJECTION_ORDER;
      const title = injection.title.trim();
      const content = injection.content.trim();
      const tokenCount = args.tokenCounter?.count(content) ?? content.length;
      scopeSeenCount[scope] += 1;
      const resolvedPlacement = this.resolver.resolve({
        placement: injection.placement,
        promptMode: args.promptMode,
        placementParams: injection.placementParams,
      });

      const item: PromptRuntimeInjectionTraceItem = {
        requestIndex,
        sourceKind: injection.sourceKind,
        visibility: resolveInjectionVisibility(injection.sourceKind),
        ...(injection.injectionId ? { injectionId: injection.injectionId } : {}),
        enabled,
        scope,
        placementRequested: injection.placement,
        ...(injection.placementParams ? { placementParamsRequested: injection.placementParams } : {}),
        orderRequested,
        title,
        contentLength: content.length,
        tokenCount,
        budgetGroup: PROMPT_RUNTIME_INJECTION_BUDGET_GROUP,
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

      const scopeLimit = getPromptRuntimeInjectionScopeLimit(limits, scope);
      if (scopeSeenCount[scope] > scopeLimit) {
        item.notAppliedReason = "scope_quota_exceeded";
        item.budgetStatus = "rejected_by_item_limit";
        return { item, priority: placementPriority, scopePriority, sourcePriority, createdAt };
      }

      if (content.length > limits.contentMaxLength) {
        item.notAppliedReason = "content_length_exceeded";
        return { item, priority: placementPriority, scopePriority, sourcePriority, createdAt };
      }

      if (tokenCount > limits.contentMaxTokens) {
        item.notAppliedReason = "content_token_limit_exceeded";
        item.budgetStatus = "rejected_by_item_limit";
        return { item, priority: placementPriority, scopePriority, sourcePriority, createdAt };
      }

      if (totalAcceptedTokens + tokenCount > limits.totalMaxTokens) {
        item.notAppliedReason = "total_token_limit_exceeded";
        item.budgetStatus = "rejected_by_total_limit";
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
      item.budgetStatus = "within_budget";
      totalAcceptedTokens += tokenCount;
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
          tokenCount,
          budgetGroup: PROMPT_RUNTIME_INJECTION_BUDGET_GROUP,
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

    const items = sorted.map((entry) => entry.item);
    const renderables = sorted
      .filter((entry) => entry.renderable !== undefined)
      .map((entry) => entry.renderable!);

    return {
      renderables,
      items,
      requestedCount: items.length,
      appliedCount: items.filter((item) => item.applied).length,
      rejectedCount: items.filter((item) => !item.applied).length,
      tokenCount: items.filter((item) => item.applied).reduce((sum, item) => sum + (item.tokenCount ?? 0), 0),
      budgetGroup: PROMPT_RUNTIME_INJECTION_BUDGET_GROUP,
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

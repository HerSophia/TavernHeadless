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
import { PromptRuntimeInjectionPlacementResolver } from "./prompt-runtime-injection-placement-resolver.js";

const DEFAULT_INJECTION_ORDER = 100;
const UNRESOLVED_PLACEMENT_PRIORITY = Number.MAX_SAFE_INTEGER;
const INJECTION_SCOPE_PRIORITY: Record<PromptRuntimeInjectionScope, number> = {
  session: 0,
  branch: 1,
  request: 2,
};

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
      const scope = injection.scope ?? "request";
      const enabled = injection.enabled ?? true;
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
        ...(injection.injectionId ? { injectionId: injection.injectionId } : {}),
        enabled,
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
      const placementPriority = internalKey
        ? INTERNAL_PLACEMENT_PRIORITY.get(internalKey) ?? UNRESOLVED_PLACEMENT_PRIORITY
        : UNRESOLVED_PLACEMENT_PRIORITY;
      const createdAt = injection.createdAt ?? Number.MAX_SAFE_INTEGER;
      const scopePriority = INJECTION_SCOPE_PRIORITY[scope];

      if (!enabled) {
        item.notAppliedReason = "disabled";
        return { item, priority: placementPriority, scopePriority, createdAt };
      }

      if (isExpiredInjection(injection, now)) {
        item.notAppliedReason = "expired";
        return { item, priority: placementPriority, scopePriority, createdAt };
      }

      if (injection.modeScope && injection.modeScope !== args.promptMode) {
        item.notAppliedReason = "mode_scope_mismatch";
        return { item, priority: placementPriority, scopePriority, createdAt };
      }

      if (!resolvedPlacement.resolved) {
        item.notAppliedReason = resolvedPlacement.reason;
        return { item, priority: UNRESOLVED_PLACEMENT_PRIORITY, scopePriority, createdAt };
      }

      if (!title || !content || !internalKey) {
        item.notAppliedReason = "empty_title_or_content";
        return { item, priority: placementPriority, scopePriority, createdAt };
      }

      item.applied = true;
      return {
        item,
        priority: placementPriority,
        scopePriority,
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

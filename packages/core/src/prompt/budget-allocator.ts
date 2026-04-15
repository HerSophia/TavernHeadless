import type { PromptTrimReason } from './types.js';

import {
  resolvePromptRuntimeBudgetGroupDefaults,
  resolvePromptRuntimeBudgetGroupTraceLabel,
} from './runtime-registry.js';

export interface PromptBudgetGroupPolicy {
  group: string;
  minTokens?: number;
  maxTokens?: number;
  targetTokens?: number;
  weight?: number;
  /** 数值越小表示越早进入裁剪序列。 */
  pruneOrder?: number;
}

interface ResolvedPromptBudgetGroupPolicy {
  minTokens: number;
  maxTokens?: number;
  targetTokens?: number;
  weight: number;
  pruneOrder: number;
}

export interface PromptBudgetAllocatorInput {
  availableTokens: number;
  estimatedByGroup: Record<string, number>;
  groupPolicies?: PromptBudgetGroupPolicy[];
}

export interface PromptBudgetAllocatorGroupResult {
  group: string;
  estimatedTokens: number;
  allocatedTokens: number;
  hardCapTokens: number;
  policy: ResolvedPromptBudgetGroupPolicy;
}

export interface PromptBudgetAllocatorResult {
  estimatedByGroup: Record<string, number>;
  allocatedByGroup: Record<string, number>;
  groupResults: PromptBudgetAllocatorGroupResult[];
}

interface GroupAllocationState {
  group: string;
  estimatedTokens: number;
  hardCapTokens: number;
  minTokens: number;
  targetTokens: number;
  weight: number;
  pruneOrder: number;
}

function normalizeGroupName(group: string): string {
  return group.trim();
}

function normalizeNonNegativeInt(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.floor(value));
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  const normalized = normalizeNonNegativeInt(value);
  return normalized && normalized > 0 ? normalized : fallback;
}

function resolvePromptBudgetGroupPolicy(
  group: string,
  policy: PromptBudgetGroupPolicy | undefined,
): ResolvedPromptBudgetGroupPolicy {
  const defaults = resolvePromptRuntimeBudgetGroupDefaults(group);
  const maxTokens = normalizeNonNegativeInt(policy?.maxTokens);
  let minTokens = normalizeNonNegativeInt(policy?.minTokens) ?? 0;
  let targetTokens = normalizeNonNegativeInt(policy?.targetTokens);

  if (maxTokens !== undefined) {
    minTokens = Math.min(minTokens, maxTokens);
    if (targetTokens !== undefined) {
      targetTokens = Math.min(targetTokens, maxTokens);
    }
  }

  if (targetTokens !== undefined) {
    targetTokens = Math.max(targetTokens, minTokens);
  }

  return {
    minTokens,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(targetTokens !== undefined ? { targetTokens } : {}),
    weight: normalizePositiveInt(policy?.weight, defaults.weight),
    pruneOrder: normalizeNonNegativeInt(policy?.pruneOrder) ?? defaults.pruneOrder,
  };
}

function compareProtectedGroups(left: GroupAllocationState, right: GroupAllocationState): number {
  if (left.pruneOrder !== right.pruneOrder) {
    return right.pruneOrder - left.pruneOrder;
  }

  if (left.weight !== right.weight) {
    return right.weight - left.weight;
  }

  return left.group.localeCompare(right.group);
}

function distributeWeightedTokens(args: {
  groups: GroupAllocationState[];
  allocatedByGroup: Record<string, number>;
  remainingTokens: number;
  limitSelector: (group: GroupAllocationState) => number;
}): number {
  let remainingTokens = args.remainingTokens;

  while (remainingTokens > 0) {
    const activeGroups = args.groups.filter((group) => {
      const current = args.allocatedByGroup[group.group] ?? 0;
      return args.limitSelector(group) > current;
    });

    if (activeGroups.length === 0) {
      break;
    }

    const totalWeight = activeGroups.reduce((sum, group) => sum + group.weight, 0);
    const roundBudget = remainingTokens;
    const sharePlans = activeGroups.map((group) => {
      const limit = args.limitSelector(group);
      const current = args.allocatedByGroup[group.group] ?? 0;
      const deficit = Math.max(0, limit - current);
      const rawShare = roundBudget * (group.weight / totalWeight);
      const wholeShare = Math.min(deficit, Math.floor(rawShare));

      return {
        group,
        deficit,
        wholeShare,
        remainder: Math.max(0, Math.min(deficit, rawShare) - wholeShare),
      };
    });

    let grantedThisRound = 0;
    for (const plan of sharePlans) {
      if (plan.wholeShare <= 0) {
        continue;
      }

      args.allocatedByGroup[plan.group.group] = (args.allocatedByGroup[plan.group.group] ?? 0) + plan.wholeShare;
      remainingTokens -= plan.wholeShare;
      grantedThisRound += plan.wholeShare;
    }

    if (remainingTokens <= 0) {
      break;
    }

    const remainderPlans = sharePlans
      .filter((plan) => {
        const current = args.allocatedByGroup[plan.group.group] ?? 0;
        return current < args.limitSelector(plan.group);
      })
      .sort((left, right) => {
        if (left.remainder !== right.remainder) {
          return right.remainder - left.remainder;
        }

        return compareProtectedGroups(left.group, right.group);
      });

    let grantedByRemainder = 0;
    for (const plan of remainderPlans) {
      if (remainingTokens <= 0) {
        break;
      }

      const limit = args.limitSelector(plan.group);
      const current = args.allocatedByGroup[plan.group.group] ?? 0;
      if (current >= limit) {
        continue;
      }

      args.allocatedByGroup[plan.group.group] = current + 1;
      remainingTokens -= 1;
      grantedByRemainder += 1;
    }

    if (grantedThisRound === 0 && grantedByRemainder === 0) {
      const fallbackGroup = [...activeGroups].sort(compareProtectedGroups)[0];
      if (!fallbackGroup) {
        break;
      }

      args.allocatedByGroup[fallbackGroup.group] = (args.allocatedByGroup[fallbackGroup.group] ?? 0) + 1;
      remainingTokens -= 1;
    }
  }

  return remainingTokens;
}

export function allocatePromptBudget(args: PromptBudgetAllocatorInput): PromptBudgetAllocatorResult {
  const availableTokens = Math.max(0, Math.floor(args.availableTokens));
  const policyByGroup = new Map<string, PromptBudgetGroupPolicy>();

  for (const policy of args.groupPolicies ?? []) {
    const group = normalizeGroupName(policy.group);
    if (!group) {
      continue;
    }

    policyByGroup.set(group, { ...policy, group });
  }

  const groups = Object.entries(args.estimatedByGroup ?? {}).map(([group, estimatedTokens]) => {
    const normalizedGroup = normalizeGroupName(group);
    const safeEstimatedTokens = Math.max(0, Math.floor(estimatedTokens));
    const policy = resolvePromptBudgetGroupPolicy(normalizedGroup, policyByGroup.get(normalizedGroup));
    const hardCapTokens = policy.maxTokens !== undefined
      ? Math.min(safeEstimatedTokens, policy.maxTokens)
      : safeEstimatedTokens;
    const minTokens = Math.min(policy.minTokens, hardCapTokens);
    const targetTokens = Math.max(
      minTokens,
      Math.min(policy.targetTokens ?? hardCapTokens, hardCapTokens),
    );

    return {
      group: normalizedGroup,
      estimatedTokens: safeEstimatedTokens,
      hardCapTokens,
      minTokens,
      targetTokens,
      weight: policy.weight,
      pruneOrder: policy.pruneOrder,
    } satisfies GroupAllocationState;
  });

  const allocatedByGroup = Object.fromEntries(groups.map((group) => [group.group, 0]));
  let remainingTokens = availableTokens;

  for (const group of [...groups].sort(compareProtectedGroups)) {
    if (remainingTokens <= 0) {
      break;
    }

    const grant = Math.min(group.minTokens, remainingTokens);
    allocatedByGroup[group.group] = (allocatedByGroup[group.group] ?? 0) + grant;
    remainingTokens -= grant;
  }

  remainingTokens = distributeWeightedTokens({
    groups,
    allocatedByGroup,
    remainingTokens,
    limitSelector: (group) => group.targetTokens,
  });

  distributeWeightedTokens({
    groups,
    allocatedByGroup,
    remainingTokens,
    limitSelector: (group) => group.hardCapTokens,
  });

  return {
    estimatedByGroup: Object.fromEntries(groups.map((group) => [group.group, group.estimatedTokens])),
    allocatedByGroup,
    groupResults: groups
      .map((group) => ({
        group: group.group,
        estimatedTokens: group.estimatedTokens,
        allocatedTokens: allocatedByGroup[group.group] ?? 0,
        hardCapTokens: group.hardCapTokens,
        policy: {
          minTokens: group.minTokens,
          ...(group.hardCapTokens < group.estimatedTokens ? { maxTokens: group.hardCapTokens } : {}),
          ...(group.targetTokens < group.hardCapTokens ? { targetTokens: group.targetTokens } : {}),
          weight: group.weight,
          pruneOrder: group.pruneOrder,
        },
      }))
      .sort((left, right) => left.group.localeCompare(right.group)),
  };
}

export function buildPromptBudgetTrimReasons(args: {
  availableTokens: number;
  groupResults: PromptBudgetAllocatorGroupResult[];
  retainedByGroup: Record<string, number>;
}): PromptTrimReason[] {
  const reasons: PromptTrimReason[] = [];

  for (const groupResult of args.groupResults) {
    const retainedTokens = args.retainedByGroup[groupResult.group] ?? 0;
    if (retainedTokens >= groupResult.estimatedTokens) {
      continue;
    }

    const prunedTokenCount = Math.max(0, groupResult.estimatedTokens - retainedTokens);
    const hardCapTriggered = groupResult.hardCapTokens < groupResult.estimatedTokens;
    const groupLabel = resolvePromptRuntimeBudgetGroupTraceLabel(groupResult.group);
    const detail = hardCapTriggered
      ? `Budget allocator capped group '${groupLabel}' at ${groupResult.hardCapTokens} tokens and retained ${retainedTokens} of ${groupResult.estimatedTokens} estimated tokens.`
      : `Budget allocator retained ${retainedTokens} of ${groupResult.estimatedTokens} estimated tokens in group '${groupLabel}' within ${Math.max(0, Math.floor(args.availableTokens))} available prunable tokens.`;

    reasons.push({
      group: groupResult.group,
      reason: hardCapTriggered ? 'group_limit_exceeded' : 'budget_exceeded',
      detail,
      prunedTokenCount,
    });
  }

  return reasons.sort((left, right) => left.group.localeCompare(right.group));
}

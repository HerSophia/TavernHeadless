import type { PromptRuntimeSourceKind } from './types.js';

/**
 * Prompt Runtime 来源的治理级别。
 *
 * 用于内部描述某类 source 在本轮装配中的保护强度，供装配器 / explain 侧
 * 在未来演进 prunable 策略时参考。首轮不开放为公共 API 类型，默认行为保持
 * 原样（即相关 section 仍 `prunable: false`）。
 *
 * 语义约定：
 *
 * - `hard_required`：主链路必需，不允许被 budget 裁剪。例如 nativeSystem / 主
 *   指令文本。即便 budget 收紧，也应优先裁其他 source。
 * - `soft_required`：对外治理面允许通过 `sourceSelection.*.enabled` 或
 *   `visibility` 显式关掉，但进入装配后不宜被 budget 裁剪。当前 memory 属于
 *   这一类：默认注入，用户可关；一旦进入装配就视为语义必须项。
 * - `budget_prunable`：允许 budget 在必要时裁剪。典型场景是 history、worldbook、
 *   examples，这些 source 的对外治理与 budget 之间需要协作。
 */
export type PromptRuntimeSourceGovernanceLevel =
  | 'hard_required'
  | 'soft_required'
  | 'budget_prunable';

/**
 * Prompt Runtime 来源描述符。
 *
 * 这是内部 registry 的只读描述对象，用来集中声明某个来源的默认预算组、
 * trace 标签和可映射的 exclusion source。
 */
export interface PromptRuntimeSourceDescriptor {
  /** 来源注册名。首轮允许使用精确名称或前缀通配，例如 `section:*`。 */
  readonly kind: string;
  /** 该来源默认落入的预算组。 */
  readonly defaultBudgetGroup: string;
  /** trace / 诊断详情里使用的稳定标签。 */
  readonly traceLabel: string;
  /** 如需暴露到 excludedSources.source，则在这里声明对应公开来源名。 */
  readonly exclusionSource?: PromptRuntimeSourceKind;
  /**
   * 默认治理级别。
   *
   * 首轮仅作为装配器 / explain 侧的参考描述，不直接决定 IR message 的
   * `prunable` 值。后续可以把这里的级别与 `prunable` 决策串起来，例如
   * `budget_prunable` 源默认允许 trim。
   */
  readonly defaultGovernanceLevel?: PromptRuntimeSourceGovernanceLevel;
}

/**
 * Prompt Runtime 预算组描述符。
 *
 * 这是内部 registry 的只读描述对象，用来集中声明预算组的默认保护顺序和权重。
 */
export interface PromptRuntimeBudgetGroupDescriptor {
  /** 预算组名。首轮允许使用精确名称或前缀通配，例如 `section:*`。 */
  readonly group: string;
  /** 默认裁剪顺序。数值越小越早进入裁剪。 */
  readonly defaultPruneOrder?: number;
  /** 默认保护权重。数值越大越受保护。 */
  readonly defaultWeight?: number;
}

const PROMPT_RUNTIME_SECTION_BUDGET_GROUP_PATTERN = 'section:*';
const PROMPT_RUNTIME_SECTION_BUDGET_GROUP_PREFIX = PROMPT_RUNTIME_SECTION_BUDGET_GROUP_PATTERN.slice(0, -1);
const DEFAULT_PROMPT_RUNTIME_BUDGET_GROUP_DEFAULTS = {
  weight: 1,
  pruneOrder: 150,
} as const;

/**
 * 统一的 memory section 名称。
 *
 * native pipeline 与 compat_plus assembler 都应该用这个名字输出 IR section，
 * 避免下游按 section name 过滤时出现 `memorySummary` / `memory` 两种写法并存。
 */
export const PROMPT_MEMORY_SECTION_NAME = 'memory' as const;

/**
 * 统一的 memory IR message `source` 归因。
 *
 * native pipeline 与 compat_plus assembler 注入的 memory 消息都应使用这个 source，
 * 以便 runtimeTrace / explain 在 memory 归因上保持一致，不再区分 `native:memory` 与 `memory`。
 */
export const PROMPT_MEMORY_MESSAGE_SOURCE = 'memory' as const;

const PROMPT_RUNTIME_SOURCE_REGISTRY: readonly PromptRuntimeSourceDescriptor[] = [
  {
    kind: 'history',
    defaultBudgetGroup: 'history',
    traceLabel: 'history',
    exclusionSource: 'history',
    defaultGovernanceLevel: 'budget_prunable',
  },
  {
    kind: 'memory',
    defaultBudgetGroup: 'memory',
    traceLabel: 'memory',
    exclusionSource: 'memory',
    defaultGovernanceLevel: 'soft_required',
  },
  {
    kind: 'worldbook',
    defaultBudgetGroup: 'worldbook',
    traceLabel: 'worldbook',
    exclusionSource: 'worldbook',
    defaultGovernanceLevel: 'budget_prunable',
  },
  {
    kind: 'examples',
    defaultBudgetGroup: 'examples',
    traceLabel: 'examples',
    exclusionSource: 'examples',
    defaultGovernanceLevel: 'budget_prunable',
  },
  {
    kind: PROMPT_RUNTIME_SECTION_BUDGET_GROUP_PATTERN,
    defaultBudgetGroup: PROMPT_RUNTIME_SECTION_BUDGET_GROUP_PATTERN,
    traceLabel: 'section',
  },
];

const PROMPT_RUNTIME_BUDGET_GROUP_REGISTRY: readonly PromptRuntimeBudgetGroupDescriptor[] = [
  { group: 'examples', defaultWeight: 1, defaultPruneOrder: 100 },
  { group: 'worldbook', defaultWeight: 2, defaultPruneOrder: 200 },
  { group: 'memory', defaultWeight: 2, defaultPruneOrder: 250 },
  { group: PROMPT_RUNTIME_SECTION_BUDGET_GROUP_PATTERN, defaultWeight: 1, defaultPruneOrder: 300 },
  { group: 'history', defaultWeight: 4, defaultPruneOrder: 400 },
];

function normalizePromptRuntimeRegistryKey(value: string): string {
  return value.trim();
}

function matchesPromptRuntimeRegistryPattern(pattern: string, value: string): boolean {
  const normalizedPattern = normalizePromptRuntimeRegistryKey(pattern);
  const normalizedValue = normalizePromptRuntimeRegistryKey(value);
  if (normalizedPattern.length === 0 || normalizedValue.length === 0) {
    return false;
  }

  if (!normalizedPattern.includes('*')) {
    return normalizedPattern === normalizedValue;
  }

  if (!normalizedPattern.endsWith('*')) {
    return normalizedPattern === normalizedValue;
  }

  return normalizedValue.startsWith(normalizedPattern.slice(0, -1));
}

function resolveRegistryDescriptorByPattern<T extends PromptRuntimeSourceDescriptor | PromptRuntimeBudgetGroupDescriptor>(
  descriptors: readonly T[],
  getPattern: (descriptor: T) => string,
  value: string,
): T | undefined {
  const normalizedValue = normalizePromptRuntimeRegistryKey(value);
  if (normalizedValue.length === 0) {
    return undefined;
  }

  return descriptors.find((descriptor) => {
    const pattern = getPattern(descriptor);
    return pattern.length > 0
      && !pattern.includes('*')
      && matchesPromptRuntimeRegistryPattern(pattern, normalizedValue);
  }) ?? descriptors.find((descriptor) => {
    const pattern = getPattern(descriptor);
    return pattern.length > 0
      && pattern.includes('*')
      && matchesPromptRuntimeRegistryPattern(pattern, normalizedValue);
  });
}

function resolvePromptRuntimeSourceDescriptorByBudgetGroup(
  group: string,
): PromptRuntimeSourceDescriptor | undefined {
  const normalizedGroup = normalizePromptRuntimeRegistryKey(group);
  if (normalizedGroup.length === 0) {
    return undefined;
  }

  return PROMPT_RUNTIME_SOURCE_REGISTRY.find((descriptor) => (
    !descriptor.defaultBudgetGroup.includes('*')
    && matchesPromptRuntimeRegistryPattern(descriptor.defaultBudgetGroup, normalizedGroup)
  )) ?? PROMPT_RUNTIME_SOURCE_REGISTRY.find((descriptor) => (
    descriptor.defaultBudgetGroup.includes('*')
    && matchesPromptRuntimeRegistryPattern(descriptor.defaultBudgetGroup, normalizedGroup)
  ));
}

/**
 * 构造未显式声明 budgetGroup 的 section fallback 组名。
 */
export function buildPromptRuntimeSectionBudgetGroup(sectionName: string): string {
  return `${PROMPT_RUNTIME_SECTION_BUDGET_GROUP_PREFIX}${sectionName}`;
}

/**
 * 解析来源描述符。
 */
export function resolvePromptRuntimeSourceDescriptor(
  kind: string,
): PromptRuntimeSourceDescriptor | undefined {
  return resolveRegistryDescriptorByPattern(PROMPT_RUNTIME_SOURCE_REGISTRY, (descriptor) => descriptor.kind, kind);
}

/**
 * 读取某类来源的默认治理级别。
 *
 * 首轮仅用于装配器 / explain 侧的参考描述，不直接决定 IR message 的
 * `prunable` 值。如果未命中 registry，返回 `undefined` 表示未定义治理意图。
 *
 * @example
 * ```ts
 * resolvePromptRuntimeSourceGovernanceLevel('memory');   // 'soft_required'
 * resolvePromptRuntimeSourceGovernanceLevel('worldbook'); // 'budget_prunable'
 * resolvePromptRuntimeSourceGovernanceLevel('unknown');   // undefined
 * ```
 */
export function resolvePromptRuntimeSourceGovernanceLevel(
  kind: string,
): PromptRuntimeSourceGovernanceLevel | undefined {
  return resolvePromptRuntimeSourceDescriptor(kind)?.defaultGovernanceLevel;
}

/**
 * 解析预算组描述符。
 */
export function resolvePromptRuntimeBudgetGroupDescriptor(
  group: string,
): PromptRuntimeBudgetGroupDescriptor | undefined {
  return resolveRegistryDescriptorByPattern(PROMPT_RUNTIME_BUDGET_GROUP_REGISTRY, (descriptor) => descriptor.group, group);
}

/**
 * 读取预算组的默认保护参数。
 */
export function resolvePromptRuntimeBudgetGroupDefaults(group: string): {
  weight: number;
  pruneOrder: number;
} {
  const descriptor = resolvePromptRuntimeBudgetGroupDescriptor(group);
  return {
    weight: descriptor?.defaultWeight ?? DEFAULT_PROMPT_RUNTIME_BUDGET_GROUP_DEFAULTS.weight,
    pruneOrder: descriptor?.defaultPruneOrder ?? DEFAULT_PROMPT_RUNTIME_BUDGET_GROUP_DEFAULTS.pruneOrder,
  };
}

/**
 * 把预算组映射到可公开解释的 exclusion source。
 */
export function resolvePromptRuntimeBudgetGroupExclusionSource(
  group: string,
): PromptRuntimeSourceKind | undefined {
  return resolvePromptRuntimeSourceDescriptorByBudgetGroup(group)?.exclusionSource;
}

/**
 * 读取预算组在 trace / 诊断详情中的稳定标签。
 *
 * 对通配 fallback（例如 `section:*`）保持具体组名不变，避免丢失上下文。
 */
export function resolvePromptRuntimeBudgetGroupTraceLabel(group: string): string {
  const normalizedGroup = normalizePromptRuntimeRegistryKey(group);
  if (normalizedGroup.length === 0) {
    return group;
  }

  const sourceDescriptor = resolvePromptRuntimeSourceDescriptorByBudgetGroup(normalizedGroup);
  if (sourceDescriptor) {
    return sourceDescriptor.defaultBudgetGroup.includes('*')
      ? normalizedGroup
      : sourceDescriptor.traceLabel;
  }

  const budgetDescriptor = resolvePromptRuntimeBudgetGroupDescriptor(normalizedGroup);
  if (!budgetDescriptor) {
    return normalizedGroup;
  }

  return budgetDescriptor.group.includes('*')
    ? normalizedGroup
    : budgetDescriptor.group;
}

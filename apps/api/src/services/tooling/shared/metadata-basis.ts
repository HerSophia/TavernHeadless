import type {
  InstanceSlot,
  ToolReplaySafety,
  ToolSideEffectLevel,
} from '@tavern/core';

export const RUNTIME_METADATA_BASIS_VALUES = [
  'tool_declared',
  'account_override',
  'server_default',
  'platform_default',
  'inferred_from_execution_policy',
  'shallow_schema_projection',
] as const;

export const RUNTIME_METADATA_SCOPE_VALUES = [
  'tool',
  'server',
  'platform',
  'local',
  'projection',
  'inference',
] as const;

export type RuntimeMetadataBasis = (typeof RUNTIME_METADATA_BASIS_VALUES)[number];
export type RuntimeMetadataScope = (typeof RUNTIME_METADATA_SCOPE_VALUES)[number];

export interface RuntimeMetadataBasisEntry {
  basis: RuntimeMetadataBasis;
  scope: RuntimeMetadataScope;
}

export interface RuntimeMetadataBasisDetail {
  sideEffectLevel?: RuntimeMetadataBasisEntry;
  allowedSlots?: RuntimeMetadataBasisEntry;
  parameterSchema?: RuntimeMetadataBasisEntry;
  replaySafety?: RuntimeMetadataBasisEntry;
}

const SIDE_EFFECT_LEVEL_RANK: Record<ToolSideEffectLevel, number> = {
  none: 0,
  sandbox: 1,
  irreversible: 2,
};

const REPLAY_SAFETY_RANK: Record<ToolReplaySafety, number> = {
  safe: 0,
  confirm_on_replay: 1,
  never_auto_replay: 2,
  uncertain: 3,
};

export function createRuntimeMetadataBasisEntry(
  basis: RuntimeMetadataBasis,
  scope: RuntimeMetadataScope,
): RuntimeMetadataBasisEntry {
  return { basis, scope };
}

export function pickMoreConservativeSideEffectLevel(
  left: ToolSideEffectLevel,
  right: ToolSideEffectLevel,
): ToolSideEffectLevel {
  return SIDE_EFFECT_LEVEL_RANK[left] >= SIDE_EFFECT_LEVEL_RANK[right]
    ? left
    : right;
}

export function pickMoreConservativeReplaySafety(
  left: ToolReplaySafety,
  right: ToolReplaySafety,
): ToolReplaySafety {
  return REPLAY_SAFETY_RANK[left] >= REPLAY_SAFETY_RANK[right]
    ? left
    : right;
}

function uniqueSlots(slots: InstanceSlot[]): InstanceSlot[] {
  return Array.from(new Set(slots));
}

/**
 * 允许更严格的 slot overlay，但不允许因为空交集把结果意外放宽。
 *
 * 当前 `allowedSlots=[]` 仍表示“未限制 / 平台默认全部可用”，
 * 无法表达 deny-all，因此空交集时保守回退到原始声明值。
 */
export function intersectAllowedSlots(
  declaredSlots: InstanceSlot[],
  overrideSlots: InstanceSlot[],
): InstanceSlot[] {
  const normalizedDeclared = uniqueSlots(declaredSlots);
  const normalizedOverride = uniqueSlots(overrideSlots);

  if (normalizedOverride.length === 0) {
    return normalizedDeclared;
  }

  if (normalizedDeclared.length === 0) {
    return normalizedOverride;
  }

  const overrideSet = new Set(normalizedOverride);
  const intersection = normalizedDeclared.filter((slot) => overrideSet.has(slot));
  return intersection.length > 0 ? intersection : normalizedDeclared;
}

export function sameAllowedSlots(left: InstanceSlot[], right: InstanceSlot[]): boolean {
  const normalizedLeft = uniqueSlots(left).sort();
  const normalizedRight = uniqueSlots(right).sort();
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((slot, index) => slot === normalizedRight[index]);
}

import type { ToolPermissions } from "@tavern/core";

export interface SessionBaseToolPermissionsRecord {
  enabled?: boolean;
  max_calls_per_turn?: number;
  max_steps_per_generation?: number;
  allow_irreversible?: boolean;
  slot_allow_list?: Record<string, string[]>;
  slot_deny_list?: Record<string, string[]>;
}

export type ToolPermissionOverlay = Partial<ToolPermissions>;

type ToolPermissionShape = {
  enabled?: boolean;
  maxCallsPerTurn?: number;
  maxStepsPerGeneration?: number;
  allowIrreversible?: boolean;
  slotAllowList?: ToolPermissions["slotAllowList"];
  slotDenyList?: ToolPermissions["slotDenyList"];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneStringArray(values: string[]): string[] {
  return [...values];
}

function cloneSlotRecord(record?: Record<string, string[]>): Record<string, string[]> | undefined {
  if (!record) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, values]) => [key, cloneStringArray(values)]),
  );
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value) {
    if (typeof item !== "string" || seen.has(item)) {
      continue;
    }

    seen.add(item);
    normalized.push(item);
  }

  return normalized;
}

function normalizeSlotRecord(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const normalized: Record<string, string[]> = {};

  for (const [slot, item] of Object.entries(value)) {
    const items = normalizeStringArray(item);
    if (items === undefined) {
      continue;
    }

    normalized[slot] = items;
  }

  return normalized;
}

function intersectStringArrays(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function unionStringArrays(left: string[], right: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const item of [...left, ...right]) {
    if (seen.has(item)) {
      continue;
    }

    seen.add(item);
    merged.push(item);
  }

  return merged;
}

function mergeAllowLists(
  base?: Record<string, string[]>,
  overlay?: Record<string, string[]>,
): Record<string, string[]> | undefined {
  if (!base && !overlay) {
    return undefined;
  }

  const keys = new Set<string>([
    ...Object.keys(base ?? {}),
    ...Object.keys(overlay ?? {}),
  ]);
  const merged: Record<string, string[]> = {};

  for (const key of keys) {
    const baseValues = base?.[key];
    const overlayValues = overlay?.[key];

    if (baseValues && overlayValues) {
      merged[key] = intersectStringArrays(baseValues, overlayValues);
      continue;
    }

    if (overlayValues) {
      merged[key] = cloneStringArray(overlayValues);
      continue;
    }

    if (baseValues) {
      merged[key] = cloneStringArray(baseValues);
    }
  }

  return merged;
}

function mergeDenyLists(
  base?: Record<string, string[]>,
  overlay?: Record<string, string[]>,
): Record<string, string[]> | undefined {
  if (!base && !overlay) {
    return undefined;
  }

  const keys = new Set<string>([
    ...Object.keys(base ?? {}),
    ...Object.keys(overlay ?? {}),
  ]);
  const merged: Record<string, string[]> = {};

  for (const key of keys) {
    const baseValues = base?.[key] ?? [];
    const overlayValues = overlay?.[key] ?? [];
    merged[key] = unionStringArrays(baseValues, overlayValues);
  }

  return merged;
}

function resolveConservativeBoolean(
  base: boolean | undefined,
  overlay: boolean | undefined,
): boolean | undefined {
  if (base === false || overlay === false) {
    return false;
  }

  if (overlay === true) {
    return true;
  }

  if (base === true) {
    return true;
  }

  return undefined;
}

function resolveConservativeNumber(
  base: number | undefined,
  overlay: number | undefined,
): number | undefined {
  if (typeof base === "number" && typeof overlay === "number") {
    return Math.min(base, overlay);
  }

  return overlay ?? base;
}

export function normalizeSessionBaseToolPermissionsRecord(
  value: unknown,
): SessionBaseToolPermissionsRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const normalized: SessionBaseToolPermissionsRecord = {};

  if (typeof value.enabled === "boolean") {
    normalized.enabled = value.enabled;
  }

  if (typeof value.max_calls_per_turn === "number") {
    normalized.max_calls_per_turn = value.max_calls_per_turn;
  }

  if (typeof value.max_steps_per_generation === "number") {
    normalized.max_steps_per_generation = value.max_steps_per_generation;
  }

  if (typeof value.allow_irreversible === "boolean") {
    normalized.allow_irreversible = value.allow_irreversible;
  }

  const slotAllowList = normalizeSlotRecord(value.slot_allow_list);
  if (slotAllowList !== undefined) {
    normalized.slot_allow_list = slotAllowList;
  }

  const slotDenyList = normalizeSlotRecord(value.slot_deny_list);
  if (slotDenyList !== undefined) {
    normalized.slot_deny_list = slotDenyList;
  }

  return normalized;
}

export function mergeSessionBaseToolPermissionsPatch(
  base: SessionBaseToolPermissionsRecord,
  patch: SessionBaseToolPermissionsRecord,
): SessionBaseToolPermissionsRecord {
  const normalizedBase = normalizeSessionBaseToolPermissionsRecord(base) ?? {};
  const normalizedPatch = normalizeSessionBaseToolPermissionsRecord(patch) ?? {};
  const merged: SessionBaseToolPermissionsRecord = {
    ...normalizedBase,
  };

  if (normalizedPatch.enabled !== undefined) {
    merged.enabled = normalizedPatch.enabled;
  }

  if (normalizedPatch.max_calls_per_turn !== undefined) {
    merged.max_calls_per_turn = normalizedPatch.max_calls_per_turn;
  }

  if (normalizedPatch.max_steps_per_generation !== undefined) {
    merged.max_steps_per_generation = normalizedPatch.max_steps_per_generation;
  }

  if (normalizedPatch.allow_irreversible !== undefined) {
    merged.allow_irreversible = normalizedPatch.allow_irreversible;
  }

  if (normalizedPatch.slot_allow_list !== undefined) {
    merged.slot_allow_list = {
      ...(cloneSlotRecord(normalizedBase.slot_allow_list) ?? {}),
      ...(cloneSlotRecord(normalizedPatch.slot_allow_list) ?? {}),
    };
  }

  if (normalizedPatch.slot_deny_list !== undefined) {
    merged.slot_deny_list = {
      ...(cloneSlotRecord(normalizedBase.slot_deny_list) ?? {}),
      ...(cloneSlotRecord(normalizedPatch.slot_deny_list) ?? {}),
    };
  }

  return normalizeSessionBaseToolPermissionsRecord(merged) ?? {};
}

export function mapSessionBaseToolPermissionsRecordToOverlay(
  value: unknown,
): ToolPermissionOverlay | undefined {
  const normalized = normalizeSessionBaseToolPermissionsRecord(value);
  if (normalized === undefined) {
    return undefined;
  }

  return {
    ...(normalized.enabled !== undefined ? { enabled: normalized.enabled } : {}),
    ...(normalized.max_calls_per_turn !== undefined
      ? { maxCallsPerTurn: normalized.max_calls_per_turn }
      : {}),
    ...(normalized.max_steps_per_generation !== undefined
      ? { maxStepsPerGeneration: normalized.max_steps_per_generation }
      : {}),
    ...(normalized.allow_irreversible !== undefined
      ? { allowIrreversible: normalized.allow_irreversible }
      : {}),
    ...(normalized.slot_allow_list !== undefined ? { slotAllowList: cloneSlotRecord(normalized.slot_allow_list) } : {}),
    ...(normalized.slot_deny_list !== undefined ? { slotDenyList: cloneSlotRecord(normalized.slot_deny_list) } : {}),
  };
}

export function mapSessionBaseToolPermissionsRecordToCorePermissions(
  value: unknown,
): ToolPermissions | undefined {
  const overlay = mapSessionBaseToolPermissionsRecordToOverlay(value);
  if (!overlay || overlay.enabled === undefined) {
    return undefined;
  }

  return {
    enabled: overlay.enabled,
    ...(overlay.maxCallsPerTurn !== undefined ? { maxCallsPerTurn: overlay.maxCallsPerTurn } : {}),
    ...(overlay.maxStepsPerGeneration !== undefined
      ? { maxStepsPerGeneration: overlay.maxStepsPerGeneration }
      : {}),
    ...(overlay.allowIrreversible !== undefined
      ? { allowIrreversible: overlay.allowIrreversible }
      : {}),
    ...(overlay.slotAllowList !== undefined ? { slotAllowList: cloneSlotRecord(overlay.slotAllowList) } : {}),
    ...(overlay.slotDenyList !== undefined ? { slotDenyList: cloneSlotRecord(overlay.slotDenyList) } : {}),
  };
}

export function cloneToolPermissions(
  permissions?: ToolPermissions | ToolPermissionOverlay | null,
): ToolPermissionShape | undefined {
  if (!permissions) {
    return undefined;
  }

  return {
    ...(permissions.enabled !== undefined ? { enabled: permissions.enabled } : {}),
    ...(permissions.maxCallsPerTurn !== undefined
      ? { maxCallsPerTurn: permissions.maxCallsPerTurn }
      : {}),
    ...(permissions.maxStepsPerGeneration !== undefined
      ? { maxStepsPerGeneration: permissions.maxStepsPerGeneration }
      : {}),
    ...(permissions.allowIrreversible !== undefined
      ? { allowIrreversible: permissions.allowIrreversible }
      : {}),
    ...(permissions.slotAllowList !== undefined
      ? { slotAllowList: cloneSlotRecord(permissions.slotAllowList) }
      : {}),
    ...(permissions.slotDenyList !== undefined
      ? { slotDenyList: cloneSlotRecord(permissions.slotDenyList) }
      : {}),
  };
}

export function resolveEffectiveToolPermissions(
  sessionBasePermissions?: ToolPermissions | null,
  overlay?: ToolPermissionOverlay | null,
): ToolPermissions | undefined {
  const base = cloneToolPermissions(sessionBasePermissions);
  const normalizedOverlay = cloneToolPermissions(overlay);

  if (!base && !normalizedOverlay) {
    return undefined;
  }

  const enabled = resolveConservativeBoolean(base?.enabled, normalizedOverlay?.enabled);
  if (enabled === undefined) {
    return undefined;
  }

  return {
    enabled,
    ...(resolveConservativeNumber(base?.maxCallsPerTurn, normalizedOverlay?.maxCallsPerTurn) !== undefined
      ? { maxCallsPerTurn: resolveConservativeNumber(base?.maxCallsPerTurn, normalizedOverlay?.maxCallsPerTurn) }
      : {}),
    ...(resolveConservativeNumber(base?.maxStepsPerGeneration, normalizedOverlay?.maxStepsPerGeneration) !== undefined
      ? { maxStepsPerGeneration: resolveConservativeNumber(base?.maxStepsPerGeneration, normalizedOverlay?.maxStepsPerGeneration) }
      : {}),
    ...(resolveConservativeBoolean(base?.allowIrreversible, normalizedOverlay?.allowIrreversible) !== undefined
      ? { allowIrreversible: resolveConservativeBoolean(base?.allowIrreversible, normalizedOverlay?.allowIrreversible) }
      : {}),
    ...(mergeAllowLists(base?.slotAllowList, normalizedOverlay?.slotAllowList) !== undefined
      ? { slotAllowList: mergeAllowLists(base?.slotAllowList, normalizedOverlay?.slotAllowList) }
      : {}),
    ...(mergeDenyLists(base?.slotDenyList, normalizedOverlay?.slotDenyList) !== undefined
      ? { slotDenyList: mergeDenyLists(base?.slotDenyList, normalizedOverlay?.slotDenyList) }
      : {}),
  };
}

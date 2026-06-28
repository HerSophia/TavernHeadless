import {
  SESSION_STATE_NAMESPACE_GAME_STATE,
  type NormalizedFirstPartyCombatState,
  type NormalizedFirstPartyInventoryState,
  type SessionStateReplaySafety,
  type SessionStateVisibilityMode,
  type SessionStateWriteMode,
} from "./session-state-types.js";

/**
 * WP-D2：为内建 `game_state.inventory` / `game_state.combat` slot 固定 schema 与读写边界。
 *
 * 这两个 slot 在 slot registry 中已登记为 `internal_only`（`clientReadable=false`、
 * `clientWritable=false`），但此前没有 value schema、没有 normalizer、也没有显式读写边界。
 * 本模块补齐三件事：
 *
 * 1. value schema（写入版本 + reader 可解析的最低版本）。
 * 2. 严格 normalizer，确保只承载会话正史状态、拒绝混入运行产物的非法 payload。
 * 3. 读写边界元数据（谁能写、当前是否对客户端可读/可写、公开前置条件）。
 *
 * 在边界与 schema 明确之前，这两个 slot 不应对外公开；本模块即“明确”的载体。
 */

export const FIRST_PARTY_INVENTORY_STATE_WRITER_SCHEMA_VERSION = 1;
export const FIRST_PARTY_INVENTORY_STATE_MIN_SUPPORTED_SCHEMA_VERSION = 1;
export const FIRST_PARTY_COMBAT_STATE_WRITER_SCHEMA_VERSION = 1;
export const FIRST_PARTY_COMBAT_STATE_MIN_SUPPORTED_SCHEMA_VERSION = 1;

export type BuiltInGameStateSlot = "inventory" | "combat";

/**
 * 内建 game_state slot 的读写边界声明。
 *
 * 与 slot registry 的 capabilities 互补：registry 负责运行期的 visibility / write / replay /
 * budget；本边界负责“schema 契约 + 公开策略”，回答 WP-D2 的“读写边界与使用场景”。
 */
export interface BuiltInGameStateSlotBoundary {
  namespace: typeof SESSION_STATE_NAMESPACE_GAME_STATE;
  slot: BuiltInGameStateSlot;
  ownerKind: "built_in";
  /** 当前仍为 internal_only：schema 已定义，但读写边界尚未对外公开。 */
  exposureLifecycle: "internal_only";
  visibilityMode: SessionStateVisibilityMode;
  defaultWriteMode: SessionStateWriteMode;
  defaultReplaySafety: SessionStateReplaySafety;
  writerSchemaVersion: number;
  minSupportedSchemaVersion: number;
  /** 内部受信写入方（first-party turn / agent runtime 等），客户端不在其中。 */
  internalWriters: readonly string[];
  /** 客户端读写边界：公开前均为 false。 */
  clientReadable: boolean;
  clientWritable: boolean;
  /** 在满足这些条件前不得公开（clientReadable / clientWritable 置为 true）。 */
  publicExposurePrerequisites: readonly string[];
}

export const BUILTIN_GAME_STATE_SLOT_BOUNDARIES: Readonly<
  Record<BuiltInGameStateSlot, BuiltInGameStateSlotBoundary>
> = {
  inventory: {
    namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
    slot: "inventory",
    ownerKind: "built_in",
    exposureLifecycle: "internal_only",
    visibilityMode: "fork_on_branch",
    defaultWriteMode: "commit_bound",
    defaultReplaySafety: "safe",
    writerSchemaVersion: FIRST_PARTY_INVENTORY_STATE_WRITER_SCHEMA_VERSION,
    minSupportedSchemaVersion: FIRST_PARTY_INVENTORY_STATE_MIN_SUPPORTED_SCHEMA_VERSION,
    internalWriters: ["first_party_turn", "agent_runtime"],
    clientReadable: false,
    clientWritable: false,
    publicExposurePrerequisites: [
      "schema 与读写边界稳定并文档化",
      "客户端读路径经 capability 控制",
      "如开放写入，需定义受控 clientWritable 与 allowedWriteModes",
    ],
  },
  combat: {
    namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
    slot: "combat",
    ownerKind: "built_in",
    exposureLifecycle: "internal_only",
    visibilityMode: "fork_on_branch",
    defaultWriteMode: "commit_bound",
    defaultReplaySafety: "safe",
    writerSchemaVersion: FIRST_PARTY_COMBAT_STATE_WRITER_SCHEMA_VERSION,
    minSupportedSchemaVersion: FIRST_PARTY_COMBAT_STATE_MIN_SUPPORTED_SCHEMA_VERSION,
    internalWriters: ["first_party_turn", "agent_runtime"],
    clientReadable: false,
    clientWritable: false,
    publicExposurePrerequisites: [
      "schema 与读写边界稳定并文档化",
      "客户端读路径经 capability 控制",
      "如开放写入，需定义受控 clientWritable 与 allowedWriteModes",
    ],
  },
};

export function getBuiltInGameStateSlotBoundary(
  slot: string,
): BuiltInGameStateSlotBoundary | null {
  if (slot === "inventory" || slot === "combat") {
    return BUILTIN_GAME_STATE_SLOT_BOUNDARIES[slot];
  }
  return null;
}

export class BuiltInGameStateSlotSchemaError extends Error {
  constructor(
    readonly code:
      | "first_party_inventory_payload_invalid"
      | "first_party_combat_payload_invalid",
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "BuiltInGameStateSlotSchemaError";
  }
}

const INVENTORY_ERROR_CODE = "first_party_inventory_payload_invalid" as const;
const COMBAT_ERROR_CODE = "first_party_combat_payload_invalid" as const;

export function normalizeInventoryValue(rawValue: unknown): NormalizedFirstPartyInventoryState {
  const record = requireRecord(rawValue, INVENTORY_ERROR_CODE, "Inventory");

  const kind = requireString(record, "kind", INVENTORY_ERROR_CODE, "Inventory");
  if (kind !== "first_party_inventory_state") {
    throw new BuiltInGameStateSlotSchemaError(
      INVENTORY_ERROR_CODE,
      409,
      `Unsupported inventory payload kind '${kind}'`,
    );
  }

  const schemaVersion = requireNonNegativeInteger(record, "schemaVersion", INVENTORY_ERROR_CODE, "Inventory");
  if (schemaVersion < FIRST_PARTY_INVENTORY_STATE_MIN_SUPPORTED_SCHEMA_VERSION) {
    throw new BuiltInGameStateSlotSchemaError(
      INVENTORY_ERROR_CODE,
      409,
      `Inventory payload schemaVersion '${schemaVersion}' is below the minimum supported version '${FIRST_PARTY_INVENTORY_STATE_MIN_SUPPORTED_SCHEMA_VERSION}'`,
    );
  }

  return {
    kind: "first_party_inventory_state",
    schemaVersion,
    sessionId: requireString(record, "sessionId", INVENTORY_ERROR_CODE, "Inventory"),
    branchId: requireString(record, "branchId", INVENTORY_ERROR_CODE, "Inventory"),
    floorId: requireString(record, "floorId", INVENTORY_ERROR_CODE, "Inventory"),
    items: normalizeInventoryItems(record.items),
    updatedAt: optionalNonNegativeInteger(record, "updatedAt", 0, INVENTORY_ERROR_CODE, "Inventory"),
  };
}

export function normalizeCombatValue(rawValue: unknown): NormalizedFirstPartyCombatState {
  const record = requireRecord(rawValue, COMBAT_ERROR_CODE, "Combat");

  const kind = requireString(record, "kind", COMBAT_ERROR_CODE, "Combat");
  if (kind !== "first_party_combat_state") {
    throw new BuiltInGameStateSlotSchemaError(
      COMBAT_ERROR_CODE,
      409,
      `Unsupported combat payload kind '${kind}'`,
    );
  }

  const schemaVersion = requireNonNegativeInteger(record, "schemaVersion", COMBAT_ERROR_CODE, "Combat");
  if (schemaVersion < FIRST_PARTY_COMBAT_STATE_MIN_SUPPORTED_SCHEMA_VERSION) {
    throw new BuiltInGameStateSlotSchemaError(
      COMBAT_ERROR_CODE,
      409,
      `Combat payload schemaVersion '${schemaVersion}' is below the minimum supported version '${FIRST_PARTY_COMBAT_STATE_MIN_SUPPORTED_SCHEMA_VERSION}'`,
    );
  }

  return {
    kind: "first_party_combat_state",
    schemaVersion,
    sessionId: requireString(record, "sessionId", COMBAT_ERROR_CODE, "Combat"),
    branchId: requireString(record, "branchId", COMBAT_ERROR_CODE, "Combat"),
    floorId: requireString(record, "floorId", COMBAT_ERROR_CODE, "Combat"),
    active: optionalBoolean(record, "active", false, COMBAT_ERROR_CODE, "Combat"),
    round: optionalNonNegativeInteger(record, "round", 0, COMBAT_ERROR_CODE, "Combat"),
    participants: normalizeCombatParticipants(record.participants),
    updatedAt: optionalNonNegativeInteger(record, "updatedAt", 0, COMBAT_ERROR_CODE, "Combat"),
  };
}

function normalizeInventoryItems(value: unknown): NormalizedFirstPartyInventoryState["items"] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BuiltInGameStateSlotSchemaError(
      INVENTORY_ERROR_CODE,
      409,
      "Inventory payload field 'items' must be an array when present",
    );
  }

  return value.map((entry, index) => {
    const itemRecord = asRecord(entry);
    if (!itemRecord) {
      throw new BuiltInGameStateSlotSchemaError(
        INVENTORY_ERROR_CODE,
        409,
        `Inventory payload field 'items[${index}]' must be an object`,
      );
    }
    return {
      itemId: requireString(itemRecord, "itemId", INVENTORY_ERROR_CODE, `Inventory items[${index}]`),
      name: requireString(itemRecord, "name", INVENTORY_ERROR_CODE, `Inventory items[${index}]`),
      quantity: requireNonNegativeInteger(itemRecord, "quantity", INVENTORY_ERROR_CODE, `Inventory items[${index}]`),
      metadata: optionalRecord(itemRecord, "metadata", INVENTORY_ERROR_CODE, `Inventory items[${index}]`),
    };
  });
}

function normalizeCombatParticipants(value: unknown): NormalizedFirstPartyCombatState["participants"] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BuiltInGameStateSlotSchemaError(
      COMBAT_ERROR_CODE,
      409,
      "Combat payload field 'participants' must be an array when present",
    );
  }

  return value.map((entry, index) => {
    const participantRecord = asRecord(entry);
    if (!participantRecord) {
      throw new BuiltInGameStateSlotSchemaError(
        COMBAT_ERROR_CODE,
        409,
        `Combat payload field 'participants[${index}]' must be an object`,
      );
    }
    const hp = requireNonNegativeInteger(participantRecord, "hp", COMBAT_ERROR_CODE, `Combat participants[${index}]`);
    const maxHp = requireNonNegativeInteger(participantRecord, "maxHp", COMBAT_ERROR_CODE, `Combat participants[${index}]`);
    if (maxHp < hp) {
      throw new BuiltInGameStateSlotSchemaError(
        COMBAT_ERROR_CODE,
        409,
        `Combat payload field 'participants[${index}].maxHp' must be greater than or equal to 'hp'`,
      );
    }
    return {
      participantId: requireString(participantRecord, "participantId", COMBAT_ERROR_CODE, `Combat participants[${index}]`),
      name: requireString(participantRecord, "name", COMBAT_ERROR_CODE, `Combat participants[${index}]`),
      hp,
      maxHp,
      statuses: optionalStringArray(participantRecord, "statuses", COMBAT_ERROR_CODE, `Combat participants[${index}]`),
    };
  });
}

type BuiltInSchemaErrorCode =
  | typeof INVENTORY_ERROR_CODE
  | typeof COMBAT_ERROR_CODE;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireRecord(value: unknown, code: BuiltInSchemaErrorCode, label: string): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) {
    throw new BuiltInGameStateSlotSchemaError(code, 409, `${label} payload must be an object`);
  }
  return record;
}

function requireString(
  record: Record<string, unknown>,
  fieldName: string,
  code: BuiltInSchemaErrorCode,
  label: string,
): string {
  const value = record[fieldName];
  if (typeof value !== "string" || value.length === 0) {
    throw new BuiltInGameStateSlotSchemaError(
      code,
      409,
      `${label} payload field '${fieldName}' must be a non-empty string`,
    );
  }
  return value;
}

function requireNonNegativeInteger(
  record: Record<string, unknown>,
  fieldName: string,
  code: BuiltInSchemaErrorCode,
  label: string,
): number {
  const value = record[fieldName];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new BuiltInGameStateSlotSchemaError(
      code,
      409,
      `${label} payload field '${fieldName}' must be a non-negative number`,
    );
  }
  return Math.trunc(value);
}

function optionalNonNegativeInteger(
  record: Record<string, unknown>,
  fieldName: string,
  fallback: number,
  code: BuiltInSchemaErrorCode,
  label: string,
): number {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new BuiltInGameStateSlotSchemaError(
      code,
      409,
      `${label} payload field '${fieldName}' must be a non-negative number when present`,
    );
  }
  return Math.trunc(value);
}

function optionalBoolean(
  record: Record<string, unknown>,
  fieldName: string,
  fallback: boolean,
  code: BuiltInSchemaErrorCode,
  label: string,
): boolean {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new BuiltInGameStateSlotSchemaError(
      code,
      409,
      `${label} payload field '${fieldName}' must be a boolean when present`,
    );
  }
  return value;
}

function optionalStringArray(
  record: Record<string, unknown>,
  fieldName: string,
  code: BuiltInSchemaErrorCode,
  label: string,
): string[] {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new BuiltInGameStateSlotSchemaError(
      code,
      409,
      `${label} payload field '${fieldName}' must be a string array when present`,
    );
  }
  return [...value] as string[];
}

function optionalRecord(
  record: Record<string, unknown>,
  fieldName: string,
  code: BuiltInSchemaErrorCode,
  label: string,
): Record<string, unknown> | null {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return null;
  }
  const nested = asRecord(value);
  if (!nested) {
    throw new BuiltInGameStateSlotSchemaError(
      code,
      409,
      `${label} payload field '${fieldName}' must be an object when present`,
    );
  }
  return nested;
}

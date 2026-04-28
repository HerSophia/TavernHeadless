import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import {
  buildQueryString,
  readArray,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readNumber,
  readRecord,
  readString,
} from "./utils.js";

export type SessionStateOwnerKind = "built_in" | "custom";
export type SessionStateExposureLifecycle = "public_stable" | "candidate" | "internal_only";
export type SessionStateVisibilityMode = "session_shared" | "branch_local" | "fork_on_branch";
export type SessionStateWriteMode = "direct" | "commit_bound";
export type SessionStateReplaySafety = "safe" | "confirm_on_replay" | "never_auto_replay" | "uncertain";
export type SessionStateResolveSource = "none" | "live_head" | "latest_branch_snapshot" | "source_floor_snapshot" | "latest_main_snapshot";
export type SessionStateLogicalOwnerType = string;
export type SessionStateReplayPolicySource = string;

export type SessionStateSlotCapabilities = {
  clientReadable: boolean;
  clientWritable: boolean;
  allowedWriteModes: SessionStateWriteMode[];
  supportsSnapshot: boolean;
  supportsDiff: boolean;
};

export type SessionStateSlotDefinition = {
  slot: string;
  exposureLifecycle: SessionStateExposureLifecycle;
  visibilityMode: SessionStateVisibilityMode;
  defaultWriteMode: SessionStateWriteMode;
  defaultReplaySafety: SessionStateReplaySafety;
  schemaVersion: number;
  sizeBudgetBytes: number;
  capabilities: SessionStateSlotCapabilities;
};

export type SessionStateCustomNamespaceDefaultSlotTemplate = {
  defaultVisibilityMode: SessionStateVisibilityMode;
  defaultWriteMode: SessionStateWriteMode;
  defaultReplaySafety: SessionStateReplaySafety;
  clientWritable: boolean;
  allowedWriteModes: SessionStateWriteMode[];
  supportsSnapshot: boolean;
  supportsDiff: boolean;
  replayPolicySource: SessionStateReplayPolicySource;
};

export type SessionStateBuiltInNamespaceDefinition = {
  namespace: string;
  ownerKind: "built_in";
  slots: SessionStateSlotDefinition[];
};

export type SessionStateCustomNamespaceDefinition = {
  namespace: string;
  ownerKind: "custom";
  logicalOwnerType: SessionStateLogicalOwnerType;
  logicalOwnerId: string;
  defaultSlotTemplate: SessionStateCustomNamespaceDefaultSlotTemplate;
  slots: SessionStateSlotDefinition[];
};

export type SessionStateNamespaceDefinition = SessionStateBuiltInNamespaceDefinition | SessionStateCustomNamespaceDefinition;

export type SessionStateResolvedValue = {
  namespace: string;
  slot: string;
  source: SessionStateResolveSource;
  visibilityMode: SessionStateVisibilityMode;
  schemaVersion: number | null;
  present: boolean;
  value: unknown | null;
  sessionId: string;
  branchId: string;
  floorId: string | null;
  sourceMutationIds: string[];
  updatedAt: number | null;
};

export type SessionStateSnapshotValue = {
  namespace: string;
  slot: string;
  visibilityMode: SessionStateVisibilityMode;
  schemaVersion: number | null;
  present: boolean;
  value: unknown | null;
  sessionId: string;
  branchId: string;
  floorId: string;
  sourceMutationIds: string[];
  committedAt: number | null;
};

export type SessionStateDiffChangeType = "added" | "removed" | "changed" | "unchanged";

export type SessionStateDiffEntry = {
  namespace: string;
  slot: string;
  changeType: SessionStateDiffChangeType;
  leftFloorId: string | null;
  rightFloorId: string | null;
  leftPresent: boolean;
  rightPresent: boolean;
  leftValue: unknown | null;
  rightValue: unknown | null;
};

export type SessionStateListNamespacesOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
};

export type SessionStateResolveOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
  branchId: string;
  namespace?: string;
  slot?: string;
  sourceFloorId?: string;
};

export type SessionStateGetFloorSnapshotsOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
  floorId: string;
  namespace?: string;
  slot?: string;
};

export type SessionStateDiffOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
  floorId: string;
  namespace?: string;
  slot?: string;
  against:
    | { kind: "live"; branchId: string }
    | { kind: "floor"; floorId: string };
};

export type SessionStateRegisterNamespaceOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
  namespace: string;
  logicalOwnerType: SessionStateLogicalOwnerType;
  logicalOwnerId: string;
};

export type SessionStateWriteValueOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
  branchId: string;
  namespace: string;
  slot: string;
  value: unknown | null;
};

export type SessionStateDeleteValueOptions = Omit<
  SessionStateWriteValueOptions,
  "value"
>;

export type SessionStateResource = {
  listNamespaces(options: SessionStateListNamespacesOptions): Promise<SessionStateNamespaceDefinition[]>;
  registerNamespace(options: SessionStateRegisterNamespaceOptions): Promise<SessionStateCustomNamespaceDefinition>;
  writeValue(options: SessionStateWriteValueOptions): Promise<SessionStateResolvedValue>;
  deleteValue(options: SessionStateDeleteValueOptions): Promise<SessionStateResolvedValue>;
  resolve(options: SessionStateResolveOptions): Promise<SessionStateResolvedValue[]>;
  getFloorSnapshots(options: SessionStateGetFloorSnapshotsOptions): Promise<SessionStateSnapshotValue[]>;
  diff(options: SessionStateDiffOptions): Promise<SessionStateDiffEntry[]>;
};

export function createSessionStateResource(client: TransportClient): SessionStateResource {
  return {
    async listNamespaces(options): Promise<SessionStateNamespaceDefinition[]> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/state/namespaces`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      return readArray(readRecord(response.body)?.data)
        .map(mapNamespaceDefinition)
        .filter((item): item is SessionStateNamespaceDefinition => item !== null);
    },
    async registerNamespace(options): Promise<SessionStateCustomNamespaceDefinition> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/state/namespaces`,
        {
          body: {
            namespace: options.namespace,
            logical_owner_type: options.logicalOwnerType,
            logical_owner_id: options.logicalOwnerId,
          },
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const mapped = mapNamespaceDefinition(readRecord(response.body)?.data);
      if (!mapped || mapped.ownerKind !== "custom") {
        throw new Error("sessionState.registerNamespace received an invalid namespace payload");
      }
      return mapped;
    },
    async writeValue(options): Promise<SessionStateResolvedValue> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/state/values/write`,
        {
          body: {
            branch_id: options.branchId,
            namespace: options.namespace,
            slot: options.slot,
            value: options.value,
          },
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const mapped = mapResolvedValue(readRecord(response.body)?.data);
      if (!mapped) {
        throw new Error("sessionState.writeValue received an invalid resolved value payload");
      }
      return mapped;
    },
    async deleteValue(options): Promise<SessionStateResolvedValue> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/state/values`,
        {
          body: {
            branch_id: options.branchId,
            namespace: options.namespace,
            slot: options.slot,
          },
          headers: buildAccountHeaders(options.accountId),
          method: "DELETE",
        },
      );

      const mapped = mapResolvedValue(readRecord(response.body)?.data);
      if (!mapped) {
        throw new Error("sessionState.deleteValue received an invalid resolved value payload");
      }
      return mapped;
    },
    async resolve(options): Promise<SessionStateResolvedValue[]> {
      if (options.slot && !options.namespace) {
        throw new Error("sessionState.resolve requires namespace when slot is provided");
      }

      const query = buildQueryString({
        branch_id: options.branchId,
        namespace: options.namespace,
        slot: options.slot,
        source_floor_id: options.sourceFloorId,
      });
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/state/resolve${query ? `?${query}` : ""}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      return readArray(readRecord(response.body)?.data)
        .map(mapResolvedValue)
        .filter((item): item is SessionStateResolvedValue => item !== null);
    },
    async getFloorSnapshots(options): Promise<SessionStateSnapshotValue[]> {
      if (options.slot && !options.namespace) {
        throw new Error("sessionState.getFloorSnapshots requires namespace when slot is provided");
      }

      const query = buildQueryString({
        namespace: options.namespace,
        slot: options.slot,
      });
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/state/floors/${encodeURIComponent(options.floorId)}/snapshot${query ? `?${query}` : ""}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      return readArray(readRecord(response.body)?.data)
        .map(mapSnapshotValue)
        .filter((item): item is SessionStateSnapshotValue => item !== null);
    },
    async diff(options): Promise<SessionStateDiffEntry[]> {
      if (options.slot && !options.namespace) {
        throw new Error("sessionState.diff requires namespace when slot is provided");
      }

      const query = buildQueryString({
        against: options.against.kind === "live" ? "live" : `floor:${options.against.floorId}`,
        branch_id: options.against.kind === "live" ? options.against.branchId : undefined,
        floor_id: options.floorId,
        namespace: options.namespace,
        slot: options.slot,
      });
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/state/diff${query ? `?${query}` : ""}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      return readArray(readRecord(response.body)?.data)
        .map(mapDiffEntry)
        .filter((item): item is SessionStateDiffEntry => item !== null);
    },
  };
}

function mapNamespaceDefinition(value: unknown): SessionStateNamespaceDefinition | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const ownerKind = readOwnerKind(record.owner_kind);
  const slots = readArray(record.slots)
    .map(mapSlotDefinition)
    .filter((item): item is SessionStateSlotDefinition => item !== null);

  if (ownerKind === "custom") {
    return {
      namespace: readString(record.namespace),
      ownerKind,
      logicalOwnerType: readString(record.logical_owner_type),
      logicalOwnerId: readString(record.logical_owner_id),
      defaultSlotTemplate: mapDefaultSlotTemplate(record.default_slot_template),
      slots,
    };
  }

  return {
    namespace: readString(record.namespace),
    ownerKind,
    slots,
  };
}

function mapDefaultSlotTemplate(value: unknown): SessionStateCustomNamespaceDefaultSlotTemplate {
  const record = readRecord(value);
  const allowedWriteModes = readArray(record?.allowed_write_modes)
    .map(readWriteMode)
    .filter((item, index, items) => items.indexOf(item) === index);
  return {
    defaultVisibilityMode: readVisibilityMode(record?.default_visibility_mode),
    defaultWriteMode: readWriteMode(record?.default_write_mode),
    defaultReplaySafety: readReplaySafety(record?.default_replay_safety),
    clientWritable: readBoolean(record?.client_writable, true),
    allowedWriteModes,
    supportsSnapshot: readBoolean(record?.supports_snapshot, true),
    supportsDiff: readBoolean(record?.supports_diff, true),
    replayPolicySource: readString(record?.replay_policy_source, "system_default"),
  };
}

function mapSlotDefinition(value: unknown): SessionStateSlotDefinition | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const capabilities = readRecord(record.capabilities);
  return {
    slot: readString(record.slot),
    exposureLifecycle: readExposureLifecycle(record.exposure_lifecycle),
    visibilityMode: readVisibilityMode(record.visibility_mode),
    defaultWriteMode: readWriteMode(record.default_write_mode),
    defaultReplaySafety: readReplaySafety(record.default_replay_safety),
    schemaVersion: readNumber(record.schema_version),
    sizeBudgetBytes: readNumber(record.size_budget_bytes),
    capabilities: {
      clientReadable: readBoolean(capabilities?.client_readable),
      clientWritable: readBoolean(capabilities?.client_writable),
      allowedWriteModes: readArray(capabilities?.allowed_write_modes)
        .map(readWriteMode)
        .filter((item, index, items) => items.indexOf(item) === index),
      supportsSnapshot: readBoolean(capabilities?.supports_snapshot),
      supportsDiff: readBoolean(capabilities?.supports_diff),
    },
  };
}

function mapResolvedValue(value: unknown): SessionStateResolvedValue | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    namespace: readString(record.namespace),
    slot: readString(record.slot),
    source: readResolveSource(record.source),
    visibilityMode: readVisibilityMode(record.visibility_mode),
    schemaVersion: readNullableNumber(record.schema_version),
    present: readBoolean(record.present),
    value: record.value ?? null,
    sessionId: readString(record.session_id),
    branchId: readString(record.branch_id),
    floorId: readNullableString(record.floor_id),
    sourceMutationIds: readArray(record.source_mutation_ids).map((item) => readString(item)).filter((item) => item.length > 0),
    updatedAt: readNullableNumber(record.updated_at),
  };
}

function mapSnapshotValue(value: unknown): SessionStateSnapshotValue | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    namespace: readString(record.namespace),
    slot: readString(record.slot),
    visibilityMode: readVisibilityMode(record.visibility_mode),
    schemaVersion: readNullableNumber(record.schema_version),
    present: readBoolean(record.present),
    value: record.value ?? null,
    sessionId: readString(record.session_id),
    branchId: readString(record.branch_id),
    floorId: readString(record.floor_id),
    sourceMutationIds: readArray(record.source_mutation_ids).map((item) => readString(item)).filter((item) => item.length > 0),
    committedAt: readNullableNumber(record.committed_at),
  };
}

function mapDiffEntry(value: unknown): SessionStateDiffEntry | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    namespace: readString(record.namespace),
    slot: readString(record.slot),
    changeType: readDiffChangeType(record.change_type),
    leftFloorId: readNullableString(record.left_floor_id),
    rightFloorId: readNullableString(record.right_floor_id),
    leftPresent: readBoolean(record.left_present),
    rightPresent: readBoolean(record.right_present),
    leftValue: record.left_value ?? null,
    rightValue: record.right_value ?? null,
  };
}

function readOwnerKind(value: unknown): SessionStateOwnerKind {
  return value === "custom" ? "custom" : "built_in";
}

function readExposureLifecycle(value: unknown): SessionStateExposureLifecycle {
  if (value === "candidate" || value === "internal_only") {
    return value;
  }
  return "public_stable";
}

function readVisibilityMode(value: unknown): SessionStateVisibilityMode {
  if (value === "session_shared" || value === "branch_local") {
    return value;
  }
  return "fork_on_branch";
}

function readWriteMode(value: unknown): SessionStateWriteMode {
  return value === "direct" ? "direct" : "commit_bound";
}

function readReplaySafety(value: unknown): SessionStateReplaySafety {
  if (value === "confirm_on_replay" || value === "never_auto_replay" || value === "uncertain") {
    return value;
  }
  return "safe";
}

function readResolveSource(value: unknown): SessionStateResolveSource {
  if (
    value === "live_head"
    || value === "latest_branch_snapshot"
    || value === "source_floor_snapshot"
    || value === "latest_main_snapshot"
  ) {
    return value;
  }
  return "none";
}

function readDiffChangeType(value: unknown): SessionStateDiffChangeType {
  if (value === "added" || value === "removed" || value === "changed") {
    return value;
  }
  return "unchanged";
}

import { errorResponseJsonSchema } from "./common.js";
import {
  SESSION_STATE_LOGICAL_OWNER_ID_PATTERN,
  SESSION_STATE_LOGICAL_OWNER_TYPE_PATTERN,
  SESSION_STATE_NAMESPACE_PATTERN,
} from "../../session-state/session-state-types.js";

const sessionStateVisibilityModeValues = [
  "session_shared",
  "branch_local",
  "fork_on_branch",
] as const;

const sessionStateWriteModeValues = [
  "direct",
  "commit_bound",
] as const;

const sessionStateReplaySafetyValues = [
  "safe",
  "confirm_on_replay",
  "never_auto_replay",
  "uncertain",
] as const;

const sessionStateExposureLifecycleValues = [
  "public_stable",
  "candidate",
  "internal_only",
] as const;

const sessionStateResolvedSourceValues = [
  "live_head",
  "latest_branch_snapshot",
  "source_floor_snapshot",
  "latest_main_snapshot",
  "none",
] as const;

const sessionStateDiffChangeTypeValues = [
  "added",
  "removed",
  "changed",
  "unchanged",
] as const;

const nullableStringJsonSchema = {
  anyOf: [{ type: "string" }, { type: "null" }],
} as const;

const nullableIntegerJsonSchema = {
  anyOf: [{ type: "integer" }, { type: "null" }],
} as const;

const builtinNamespaceExample = {
  namespace: "game_state",
  owner_kind: "built_in",
  slots: [
    {
      slot: "scene",
      exposure_lifecycle: "public_stable",
      visibility_mode: "fork_on_branch",
      default_write_mode: "commit_bound",
      default_replay_safety: "safe",
      schema_version: 1,
      size_budget_bytes: 262144,
      capabilities: {
        client_readable: true,
        client_writable: false,
        allowed_write_modes: [],
        supports_snapshot: true,
        supports_diff: true,
      },
    },
    {
      slot: "world",
      exposure_lifecycle: "public_stable",
      visibility_mode: "fork_on_branch",
      default_write_mode: "commit_bound",
      default_replay_safety: "safe",
      schema_version: 1,
      size_budget_bytes: 524288,
      capabilities: {
        client_readable: true,
        client_writable: false,
        allowed_write_modes: [],
        supports_snapshot: true,
        supports_diff: true,
      },
    },
  ],
} as const;

const customNamespaceExample = {
  namespace: "quest_flags",
  owner_kind: "custom",
  logical_owner_type: "plugin",
  logical_owner_id: "quest-plugin",
  default_slot_template: {
    default_visibility_mode: "fork_on_branch",
    default_write_mode: "direct",
    default_replay_safety: "safe",
    client_writable: true,
    allowed_write_modes: ["direct", "commit_bound"],
    supports_snapshot: true,
    supports_diff: true,
    replay_policy_source: "system_default",
  },
  slots: [
    {
      slot: "companion",
      exposure_lifecycle: "public_stable",
      visibility_mode: "fork_on_branch",
      default_write_mode: "direct",
      default_replay_safety: "safe",
      schema_version: 1,
      size_budget_bytes: 1048576,
      capabilities: {
        client_readable: true,
        client_writable: true,
        allowed_write_modes: ["direct", "commit_bound"],
        supports_snapshot: true,
        supports_diff: true,
      },
    },
  ],
} as const;

const resolvedValueExample = {
  namespace: "quest_flags",
  slot: "companion",
  source: "live_head",
  visibility_mode: "fork_on_branch",
  schema_version: 1,
  present: true,
  value: { mood: "ally" },
  session_id: "sess_demo",
  branch_id: "main",
  floor_id: "floor_demo_2",
  source_mutation_ids: ["ssm_demo_1"],
  updated_at: 1714300000000,
} as const;

const snapshotValueExample = {
  namespace: "game_state",
  slot: "scene",
  visibility_mode: "fork_on_branch",
  schema_version: 1,
  present: true,
  value: { scene: "floor1-scene" },
  session_id: "sess_demo",
  branch_id: "main",
  floor_id: "floor_demo_1",
  source_mutation_ids: ["ssm_demo_scene_1"],
  committed_at: 1714300000000,
} as const;

const diffEntryExample = {
  namespace: "game_state",
  slot: "scene",
  change_type: "changed",
  left_floor_id: null,
  right_floor_id: "floor_demo_1",
  left_present: true,
  right_present: true,
  left_value: { scene: "floor2-scene" },
  right_value: { scene: "floor1-scene" },
} as const;

export const sessionStateSessionIdParamsJsonSchema = {
  type: "object",
  required: ["sessionId"],
  properties: {
    sessionId: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const sessionStateSnapshotParamsJsonSchema = {
  type: "object",
  required: ["sessionId", "floorId"],
  properties: {
    sessionId: { type: "string", minLength: 1 },
    floorId: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const registerSessionStateNamespaceBodyJsonSchema = {
  type: "object",
  required: ["namespace", "logical_owner_type", "logical_owner_id"],
  properties: {
    namespace: { type: "string", minLength: 1, maxLength: 128, pattern: SESSION_STATE_NAMESPACE_PATTERN.source },
    logical_owner_type: { type: "string", minLength: 1, maxLength: 128, pattern: SESSION_STATE_LOGICAL_OWNER_TYPE_PATTERN.source },
    logical_owner_id: { type: "string", minLength: 1, maxLength: 256, pattern: SESSION_STATE_LOGICAL_OWNER_ID_PATTERN.source },
  },
  examples: [
    {
      namespace: "quest_flags",
      logical_owner_type: "plugin",
      logical_owner_id: "quest-plugin",
    },
  ],
  additionalProperties: false,
} as const;

export const writeSessionStateValueBodyJsonSchema = {
  type: "object",
  required: ["branch_id", "namespace", "slot", "value"],
  properties: {
    branch_id: { type: "string", minLength: 1 },
    namespace: { type: "string", minLength: 1, maxLength: 128, pattern: SESSION_STATE_NAMESPACE_PATTERN.source },
    slot: { type: "string", minLength: 1, maxLength: 256 },
    value: {},
  },
  examples: [
    {
      branch_id: "main",
      namespace: "quest_flags",
      slot: "companion",
      value: { mood: "ally" },
    },
  ],
  additionalProperties: false,
} as const;

export const deleteSessionStateValueBodyJsonSchema = {
  type: "object",
  required: ["branch_id", "namespace", "slot"],
  properties: {
    branch_id: { type: "string", minLength: 1 },
    namespace: { type: "string", minLength: 1, maxLength: 128, pattern: SESSION_STATE_NAMESPACE_PATTERN.source },
    slot: { type: "string", minLength: 1, maxLength: 256 },
  },
  examples: [
    {
      branch_id: "main",
      namespace: "quest_flags",
      slot: "companion",
    },
  ],
  additionalProperties: false,
} as const;

export const resolveSessionStateQueryJsonSchema = {
  type: "object",
  required: ["branch_id"],
  properties: {
    branch_id: { type: "string", minLength: 1 },
    namespace: { type: "string", minLength: 1, pattern: SESSION_STATE_NAMESPACE_PATTERN.source },
    slot: { type: "string", minLength: 1 },
    source_floor_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const snapshotSessionStateQueryJsonSchema = {
  type: "object",
  properties: {
    namespace: { type: "string", minLength: 1, pattern: SESSION_STATE_NAMESPACE_PATTERN.source },
    slot: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const diffSessionStateQueryJsonSchema = {
  type: "object",
  required: ["floor_id", "against"],
  properties: {
    floor_id: { type: "string", minLength: 1 },
    against: { type: "string", pattern: "^(floor:.+|live)$" },
    branch_id: { type: "string", minLength: 1 },
    namespace: { type: "string", minLength: 1, pattern: SESSION_STATE_NAMESPACE_PATTERN.source },
    slot: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const sessionStateSlotCapabilitiesJsonSchema = {
  type: "object",
  required: [
    "client_readable",
    "client_writable",
    "allowed_write_modes",
    "supports_snapshot",
    "supports_diff",
  ],
  properties: {
    client_readable: { type: "boolean" },
    client_writable: { type: "boolean" },
    allowed_write_modes: {
      type: "array",
      items: { type: "string", enum: [...sessionStateWriteModeValues] },
    },
    supports_snapshot: { type: "boolean" },
    supports_diff: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const sessionStateDefaultSlotTemplateJsonSchema = {
  type: "object",
  required: [
    "default_visibility_mode",
    "default_write_mode",
    "default_replay_safety",
    "client_writable",
    "allowed_write_modes",
    "supports_snapshot",
    "supports_diff",
    "replay_policy_source",
  ],
  properties: {
    default_visibility_mode: { type: "string", enum: [...sessionStateVisibilityModeValues] },
    default_write_mode: { type: "string", enum: [...sessionStateWriteModeValues] },
    default_replay_safety: { type: "string", enum: [...sessionStateReplaySafetyValues] },
    client_writable: { type: "boolean" },
    allowed_write_modes: {
      type: "array",
      items: { type: "string", enum: [...sessionStateWriteModeValues] },
    },
    supports_snapshot: { type: "boolean" },
    supports_diff: { type: "boolean" },
    replay_policy_source: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const sessionStatePublicSlotDefinitionJsonSchema = {
  type: "object",
  required: [
    "slot",
    "exposure_lifecycle",
    "visibility_mode",
    "default_write_mode",
    "default_replay_safety",
    "schema_version",
    "size_budget_bytes",
    "capabilities",
  ],
  properties: {
    slot: { type: "string", minLength: 1 },
    exposure_lifecycle: { type: "string", enum: [...sessionStateExposureLifecycleValues] },
    visibility_mode: { type: "string", enum: [...sessionStateVisibilityModeValues] },
    default_write_mode: { type: "string", enum: [...sessionStateWriteModeValues] },
    default_replay_safety: { type: "string", enum: [...sessionStateReplaySafetyValues] },
    schema_version: { type: "integer", minimum: 0 },
    size_budget_bytes: { type: "integer", minimum: 0 },
    capabilities: sessionStateSlotCapabilitiesJsonSchema,
  },
  additionalProperties: false,
} as const;

const sessionStateBuiltInNamespaceDefinitionJsonSchema = {
  type: "object",
  required: ["namespace", "owner_kind", "slots"],
  properties: {
    namespace: { type: "string", minLength: 1 },
    owner_kind: { type: "string", enum: ["built_in"] },
    slots: {
      type: "array",
      items: sessionStatePublicSlotDefinitionJsonSchema,
    },
  },
  additionalProperties: false,
} as const;

const sessionStateCustomNamespaceDefinitionJsonSchema = {
  type: "object",
  required: [
    "namespace",
    "owner_kind",
    "logical_owner_type",
    "logical_owner_id",
    "default_slot_template",
    "slots",
  ],
  properties: {
    namespace: { type: "string", minLength: 1 },
    owner_kind: { type: "string", enum: ["custom"] },
    logical_owner_type: { type: "string", minLength: 1 },
    logical_owner_id: { type: "string", minLength: 1 },
    default_slot_template: sessionStateDefaultSlotTemplateJsonSchema,
    slots: {
      type: "array",
      items: sessionStatePublicSlotDefinitionJsonSchema,
    },
  },
  additionalProperties: false,
} as const;

export const sessionStateNamespaceDefinitionJsonSchema = {
  oneOf: [
    sessionStateBuiltInNamespaceDefinitionJsonSchema,
    sessionStateCustomNamespaceDefinitionJsonSchema,
  ],
  examples: [builtinNamespaceExample, customNamespaceExample],
} as const;

export const sessionStateResolvedValueJsonSchema = {
  type: "object",
  required: [
    "namespace",
    "slot",
    "source",
    "visibility_mode",
    "schema_version",
    "present",
    "value",
    "session_id",
    "branch_id",
    "floor_id",
    "source_mutation_ids",
    "updated_at",
  ],
  properties: {
    namespace: { type: "string", minLength: 1 },
    slot: { type: "string", minLength: 1 },
    source: { type: "string", enum: [...sessionStateResolvedSourceValues] },
    visibility_mode: { type: "string", enum: [...sessionStateVisibilityModeValues] },
    schema_version: nullableIntegerJsonSchema,
    present: { type: "boolean" },
    value: {},
    session_id: { type: "string", minLength: 1 },
    branch_id: { type: "string", minLength: 1 },
    floor_id: nullableStringJsonSchema,
    source_mutation_ids: { type: "array", items: { type: "string", minLength: 1 } },
    updated_at: nullableIntegerJsonSchema,
  },
  examples: [resolvedValueExample],
  additionalProperties: false,
} as const;

export const sessionStateSnapshotValueJsonSchema = {
  type: "object",
  required: [
    "namespace",
    "slot",
    "visibility_mode",
    "schema_version",
    "present",
    "value",
    "session_id",
    "branch_id",
    "floor_id",
    "source_mutation_ids",
    "committed_at",
  ],
  properties: {
    namespace: { type: "string", minLength: 1 },
    slot: { type: "string", minLength: 1 },
    visibility_mode: { type: "string", enum: [...sessionStateVisibilityModeValues] },
    schema_version: nullableIntegerJsonSchema,
    present: { type: "boolean" },
    value: {},
    session_id: { type: "string", minLength: 1 },
    branch_id: { type: "string", minLength: 1 },
    floor_id: { type: "string", minLength: 1 },
    source_mutation_ids: { type: "array", items: { type: "string", minLength: 1 } },
    committed_at: nullableIntegerJsonSchema,
  },
  examples: [snapshotValueExample],
  additionalProperties: false,
} as const;

export const sessionStateDiffEntryJsonSchema = {
  type: "object",
  required: [
    "namespace",
    "slot",
    "change_type",
    "left_floor_id",
    "right_floor_id",
    "left_present",
    "right_present",
    "left_value",
    "right_value",
  ],
  properties: {
    namespace: { type: "string", minLength: 1 },
    slot: { type: "string", minLength: 1 },
    change_type: { type: "string", enum: [...sessionStateDiffChangeTypeValues] },
    left_floor_id: nullableStringJsonSchema,
    right_floor_id: nullableStringJsonSchema,
    left_present: { type: "boolean" },
    right_present: { type: "boolean" },
    left_value: {},
    right_value: {},
  },
  examples: [diffEntryExample],
  additionalProperties: false,
} as const;

export const registerSessionStateNamespaceResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: sessionStateNamespaceDefinitionJsonSchema,
  },
  examples: [{ data: customNamespaceExample }],
  additionalProperties: false,
} as const;

export const listSessionStateNamespacesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "array",
      items: sessionStateNamespaceDefinitionJsonSchema,
    },
  },
  examples: [{ data: [builtinNamespaceExample, customNamespaceExample] }],
  additionalProperties: false,
} as const;

export const sessionStateResolvedValueResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: sessionStateResolvedValueJsonSchema,
  },
  examples: [{ data: resolvedValueExample }],
  additionalProperties: false,
} as const;

export const resolveSessionStateValuesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "array",
      items: sessionStateResolvedValueJsonSchema,
    },
  },
  examples: [{ data: [resolvedValueExample] }],
  additionalProperties: false,
} as const;

export const snapshotSessionStateValuesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "array",
      items: sessionStateSnapshotValueJsonSchema,
    },
  },
  examples: [{ data: [snapshotValueExample] }],
  additionalProperties: false,
} as const;

export const diffSessionStateValuesResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "array",
      items: sessionStateDiffEntryJsonSchema,
    },
  },
  examples: [{ data: [diffEntryExample] }],
  additionalProperties: false,
} as const;

export const sessionStateRouteErrorResponses = {
  400: errorResponseJsonSchema,
  404: errorResponseJsonSchema,
  409: errorResponseJsonSchema,
  500: errorResponseJsonSchema,
} as const;

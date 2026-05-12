import { z } from 'zod';

export const TH_BACKUP_SPEC = 'tavern_headless_backup' as const;
export const TH_BACKUP_SPEC_VERSION = '1.0.0' as const;
export const TH_BACKUP_KIND = 'account_core_assets' as const;
export const TH_BACKUP_DOMAINS = ['characters', 'presets', 'worldbooks', 'regex_profiles', 'sessions'] as const;

export type ThBackupDomain = (typeof TH_BACKUP_DOMAINS)[number];

const thBackupDomainSchema = z.enum(TH_BACKUP_DOMAINS);
const nullableStringSchema = z.string().min(1).nullable().optional();

export const thBackupSourceSchema = z.object({
  account_id: z.string().min(1),
  app_version: z.string().min(1).optional(),
});

export type ThBackupSource = z.infer<typeof thBackupSourceSchema>;

export const thBackupOptionsSchema = z.object({
  include_secrets: z.literal(false).default(false),
});

export type ThBackupOptions = z.infer<typeof thBackupOptionsSchema>;

export const thBackupSecretsExtensionSchema = z.object({
  mode: z.literal('excluded'),
});

export type ThBackupSecretsExtension = z.infer<typeof thBackupSecretsExtensionSchema>;

export const thBackupCharacterVersionSourceArtifactSchema = z.object({
  data: z.unknown().nullable().optional(),
  format: z.string().nullable().optional(),
  digest: z.string().nullable().optional(),
});

export type ThBackupCharacterVersionSourceArtifact = z.infer<
  typeof thBackupCharacterVersionSourceArtifactSchema
>;

export const thBackupCharacterVersionSchema = z.object({
  id: z.string().min(1),
  version_no: z.number().int().min(1),
  data: z.unknown(),
  content_hash: z.string().min(1),
  source_artifact: thBackupCharacterVersionSourceArtifactSchema.optional(),
  created_at: z.number(),
});

export type ThBackupCharacterVersion = z.infer<typeof thBackupCharacterVersionSchema>;

export const thBackupCharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['active', 'deleted']),
  source: z.string().min(1),
  created_at: z.number(),
  updated_at: z.number(),
  latest_version_no: z.number().int().min(1),
  versions: z.array(thBackupCharacterVersionSchema),
});

export type ThBackupCharacter = z.infer<typeof thBackupCharacterSchema>;

export const thBackupWorldbookEntrySchema = z.object({
  id: z.string().min(1),
  uid: z.number().int(),
  comment: z.string(),
  content: z.string(),
  keys: z.array(z.string()),
  keys_secondary: z.array(z.string()),
  selective: z.boolean(),
  selective_logic: z.number().int(),
  constant: z.boolean(),
  position: z.number().int(),
  order: z.number().int(),
  depth: z.number().int(),
  role: z.number().int(),
  disable: z.boolean(),
  scan_depth: z.number().int().nullable().optional(),
  case_sensitive: z.boolean().nullable().optional(),
  match_whole_words: z.boolean().nullable().optional(),
  exclude_recursion: z.boolean(),
  prevent_recursion: z.boolean(),
  delay_until_recursion: z.number().int().nullable().optional(),
  outlet_name: z.string(),
  extra: z.unknown().nullable().optional(),
  created_at: z.number(),
  updated_at: z.number(),
});

export type ThBackupWorldbookEntry = z.infer<typeof thBackupWorldbookEntrySchema>;

export const thBackupPromptAssetVersionSchema = z.object({
  id: z.string().min(1),
  parent_version_id_ref: z.string().min(1).nullable().optional(),
  version_no: z.number().int().min(1),
  data: z.unknown(),
  content_hash: z.string().min(1),
  created_by_operation_id: z.string().min(1).nullable().optional(),
  created_at: z.number(),
});

export type ThBackupPromptAssetVersion = z.infer<typeof thBackupPromptAssetVersionSchema>;

export const thBackupPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.string().min(1),
  created_at: z.number(),
  updated_at: z.number(),
  version: z.number().int().min(1),
  data: z.unknown(),
  versions: z.array(thBackupPromptAssetVersionSchema).default([]),
});

export type ThBackupPreset = z.infer<typeof thBackupPresetSchema>;

export const thBackupWorldbookSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.string().min(1),
  created_at: z.number(),
  updated_at: z.number(),
  version: z.number().int().min(1),
  data: z.unknown().nullable().optional(),
  entries: z.array(thBackupWorldbookEntrySchema),
  versions: z.array(thBackupPromptAssetVersionSchema).default([]),
});

export type ThBackupWorldbook = z.infer<typeof thBackupWorldbookSchema>;

export const thBackupRegexProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.string().min(1),
  created_at: z.number(),
  updated_at: z.number(),
  version: z.number().int().min(1),
  data: z.unknown(),
  versions: z.array(thBackupPromptAssetVersionSchema).default([]),
});

export type ThBackupRegexProfile = z.infer<typeof thBackupRegexProfileSchema>;

export const thBackupSessionBranchSchema = z.object({
  branch_id: z.string().min(1),
  source_floor_id_ref: nullableStringSchema,
  source_branch_id: nullableStringSchema,
  created_at: z.number(),
  updated_at: z.number(),
});

export type ThBackupSessionBranch = z.infer<typeof thBackupSessionBranchSchema>;

export const thBackupMessageSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().min(0),
  role: z.enum(['user', 'assistant', 'system', 'narrator']),
  content: z.string(),
  content_format: z.enum(['text', 'markdown', 'json']),
  token_count: z.number().int().min(0),
  is_hidden: z.boolean(),
  source: z.string().nullable(),
  created_at: z.number(),
});

export type ThBackupMessage = z.infer<typeof thBackupMessageSchema>;

export const thBackupPageSchema = z.object({
  id: z.string().min(1),
  page_no: z.number().int().min(0),
  page_kind: z.enum(['input', 'output', 'mixed']),
  is_active: z.boolean(),
  version: z.number().int().min(1),
  checksum: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  messages: z.array(thBackupMessageSchema),
});

export type ThBackupPage = z.infer<typeof thBackupPageSchema>;

export const thBackupFloorSchema = z.object({
  id: z.string().min(1),
  floor_no: z.number().int().min(0),
  branch_id: z.string().min(1),
  parent_floor_id_ref: nullableStringSchema,
  superseded_at: z.number().nullable().optional(),
  superseded_by_floor_id_ref: nullableStringSchema,
  state: z.enum(['draft', 'generating', 'committed', 'failed']),
  token_in: z.number().int().min(0),
  token_out: z.number().int().min(0),
  metadata: z.unknown().nullable().optional(),
  created_at: z.number(),
  updated_at: z.number(),
  pages: z.array(thBackupPageSchema),
});

export type ThBackupFloor = z.infer<typeof thBackupFloorSchema>;

export const thBackupVariableSchema = z.object({
  scope: z.enum(['chat', 'branch', 'floor', 'page']),
  scope_id_ref: z.string().nullable(),
  key: z.string().min(1),
  value: z.unknown(),
  updated_at: z.number(),
});

export type ThBackupVariable = z.infer<typeof thBackupVariableSchema>;

export const thBackupBranchLocalVariableProvenanceSchema = z.object({
  source_scope: z.enum(['chat', 'branch', 'floor', 'page', 'global']),
  source_scope_id_ref: z.string().nullable().optional(),
  source_variable_id: z.string().optional(),
  source_updated_at: z.number().optional(),
  inherited_from_floor_id_ref: z.string().nullable().optional(),
  inherited_from_branch_id: z.string().optional(),
  origin_kind: z.enum(['authored', 'inherited', 'unknown']),
});

export type ThBackupBranchLocalVariableProvenance = z.infer<
  typeof thBackupBranchLocalVariableProvenanceSchema
>;

export const thBackupBranchLocalVariableSnapshotSchema = z.object({
  floor_id_ref: z.string().min(1),
  branch_id: z.string().min(1),
  snapshot_version: z.union([z.literal(1), z.literal(2)]).default(1),
  values: z.record(z.unknown()),
  provenance: z.record(thBackupBranchLocalVariableProvenanceSchema).optional(),
  created_at: z.number(),
});

export type ThBackupBranchLocalVariableSnapshot = z.infer<
  typeof thBackupBranchLocalVariableSnapshotSchema
>;

export const thBackupMemoryItemSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(['chat', 'branch', 'floor']),
  scope_id_ref: z.string().nullable(),
  type: z.enum(['fact', 'summary', 'open_loop']),
  summary_tier: z.enum(['micro', 'macro']).nullable().optional(),
  content: z.unknown(),
  importance: z.number(),
  confidence: z.number(),
  source_floor_id_ref: z.string().nullable(),
  source_message_id_ref: z.string().nullable(),
  status: z.enum(['active', 'deprecated']),
  lifecycle_status: z.enum(['active', 'compacted', 'deprecated']).optional(),
  source_job_id: z.string().nullable().optional(),
  token_count_estimate: z.number().int().min(0).nullable().optional(),
  last_used_at: z.number().int().min(0).nullable().optional(),
  coverage_start_floor_no: z.number().int().min(0).nullable().optional(),
  coverage_end_floor_no: z.number().int().min(0).nullable().optional(),
  derived_from_count: z.number().int().min(0).nullable().optional(),
  created_at: z.number(),
  updated_at: z.number(),
});

export type ThBackupMemoryItem = z.infer<typeof thBackupMemoryItemSchema>;

export const thBackupMemoryEdgeSchema = z.object({
  from_id_ref: z.string().min(1),
  to_id_ref: z.string().min(1),
  relation: z.enum(['supports', 'contradicts', 'updates', 'derived_from', 'compacts', 'resolves']),
  created_at: z.number(),
});

export type ThBackupMemoryEdge = z.infer<typeof thBackupMemoryEdgeSchema>;

export const thBackupMemoriesSchema = z.object({
  items: z.array(thBackupMemoryItemSchema),
  edges: z.array(thBackupMemoryEdgeSchema),
});

export type ThBackupMemories = z.infer<typeof thBackupMemoriesSchema>;

export const thBackupSessionCharacterBindingSchema = z.object({
  character_id_ref: z.string().min(1).nullable().optional(),
  character_version_id_ref: z.string().min(1).nullable().optional(),
  character_sync_policy: z.enum(['pin', 'manual', 'force']),
  snapshot: z.unknown().nullable().optional(),
});

export type ThBackupSessionCharacterBinding = z.infer<typeof thBackupSessionCharacterBindingSchema>;

export const thBackupSessionUserBindingSchema = z.object({
  user_id: z.string().min(1).nullable().optional(),
  snapshot: z.unknown().nullable().optional(),
});

export type ThBackupSessionUserBinding = z.infer<typeof thBackupSessionUserBindingSchema>;

export const thBackupSessionProfileBindingSchema = z.object({
  worldbook_id_ref: z.string().min(1).nullable().optional(),
  worldbook_version_id_ref: z.string().min(1).nullable().optional(),
  preset_id_ref: z.string().min(1).nullable().optional(),
  preset_version_id_ref: z.string().min(1).nullable().optional(),
  regex_profile_id_ref: z.string().min(1).nullable().optional(),
  regex_profile_version_id_ref: z.string().min(1).nullable().optional(),
  deep_binding: z.boolean().default(false),
  preset_id: z.string().min(1).nullable().optional(),
  regex_profile_id: z.string().min(1).nullable().optional(),
});

export type ThBackupSessionProfileBinding = z.infer<typeof thBackupSessionProfileBindingSchema>;

export const thBackupSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  created_at: z.number(),
  updated_at: z.number(),
  prompt_mode: z.enum(['compat_strict', 'compat_plus', 'native']).nullable().optional(),
  model_provider: z.string().nullable().optional(),
  model_name: z.string().nullable().optional(),
  model_params: z.unknown().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  character_binding: thBackupSessionCharacterBindingSchema,
  user_binding: thBackupSessionUserBindingSchema,
  profile_binding: thBackupSessionProfileBindingSchema,
  branches: z.array(thBackupSessionBranchSchema),
  floors: z.array(thBackupFloorSchema),
  variables: z.array(thBackupVariableSchema).default([]),
  branch_local_variable_snapshots: z.array(thBackupBranchLocalVariableSnapshotSchema).default([]),
  memories: thBackupMemoriesSchema.default({ items: [], edges: [] }),
});

export type ThBackupSession = z.infer<typeof thBackupSessionSchema>;

export const thBackupResourcesSchema = z.object({
  characters: z.array(thBackupCharacterSchema).default([]),
  presets: z.array(thBackupPresetSchema).default([]),
  worldbooks: z.array(thBackupWorldbookSchema).default([]),
  regex_profiles: z.array(thBackupRegexProfileSchema).default([]),
});

export type ThBackupResources = z.infer<typeof thBackupResourcesSchema>;

export const thBackupFileSchema = z.object({
  spec: z.literal(TH_BACKUP_SPEC),
  spec_version: z.string().min(1),
  backup_kind: z.literal(TH_BACKUP_KIND),
  created_at: z.number(),
  source: thBackupSourceSchema,
  included_domains: z.array(thBackupDomainSchema).default([...TH_BACKUP_DOMAINS]),
  options: thBackupOptionsSchema.default({ include_secrets: false }),
  resources: thBackupResourcesSchema.default({ characters: [], presets: [], worldbooks: [], regex_profiles: [] }),
  sessions: z.array(thBackupSessionSchema).default([]),
  extensions: z.object({
    secrets: thBackupSecretsExtensionSchema.default({ mode: 'excluded' }),
  }).default({ secrets: { mode: 'excluded' } }),
});

export type ThBackupFile = z.infer<typeof thBackupFileSchema>;

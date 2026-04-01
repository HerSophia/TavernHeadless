import { z } from 'zod';

// ── 常量 ──────────────────────────────────────────────

export const TH_CHAT_SPEC = 'tavern_headless_chat' as const;
export const TH_CHAT_SPEC_VERSION = '1.0.0' as const;

// ── Message ───────────────────────────────────────────

export const thChatMessageSchema = z.object({
  seq: z.number().int().min(0),
  role: z.enum(['user', 'assistant', 'system', 'narrator']),
  content: z.string(),
  content_format: z.enum(['text', 'markdown', 'json']),
  token_count: z.number().int().min(0),
  is_hidden: z.boolean(),
  source: z.string().nullable(),
  created_at: z.number(),
  _original_id: z.string(),
});

export type ThChatMessage = z.infer<typeof thChatMessageSchema>;

// ── Page ──────────────────────────────────────────────

export const thChatPageSchema = z.object({
  page_no: z.number().int().min(0),
  page_kind: z.enum(['input', 'output', 'mixed']),
  is_active: z.boolean(),
  version: z.number().int().min(1),
  checksum: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  _original_id: z.string(),
  messages: z.array(thChatMessageSchema),
});

export type ThChatPage = z.infer<typeof thChatPageSchema>;

// ── Floor ─────────────────────────────────────────────

export const thChatFloorSchema = z.object({
  floor_no: z.number().int().min(0),
  branch_id: z.string(),
  parent_floor_id_ref: z.string().nullable(),
  state: z.enum(['draft', 'generating', 'committed', 'failed']),
  token_in: z.number().int().min(0),
  token_out: z.number().int().min(0),
  metadata: z.unknown().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  _original_id: z.string(),
  pages: z.array(thChatPageSchema),
});

export type ThChatFloor = z.infer<typeof thChatFloorSchema>;

// ── Variable ──────────────────────────────────────────

export const thChatVariableSchema = z.object({
  scope: z.enum(['chat', 'floor', 'branch', 'page']),
  scope_id_ref: z.string().nullable(),
  key: z.string(),
  value: z.unknown(),
  updated_at: z.number(),
});

export type ThChatVariable = z.infer<typeof thChatVariableSchema>;

// ── Memory ────────────────────────────────────────────

export const thChatMemoryItemSchema = z.object({
  _original_id: z.string(),
  scope: z.enum(['chat', 'floor']),
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

export type ThChatMemoryItem = z.infer<typeof thChatMemoryItemSchema>;

export const thChatMemoryEdgeSchema = z.object({
  from_id_ref: z.string(),
  to_id_ref: z.string(),
  relation: z.enum(['supports', 'contradicts', 'updates', 'derived_from', 'compacts', 'resolves']),
  created_at: z.number(),
});

export type ThChatMemoryEdge = z.infer<typeof thChatMemoryEdgeSchema>;

export const thChatMemoriesSchema = z.object({
  items: z.array(thChatMemoryItemSchema),
  edges: z.array(thChatMemoryEdgeSchema),
});

export type ThChatMemories = z.infer<typeof thChatMemoriesSchema>;

// ── Data 层 ───────────────────────────────────────────

export const thChatDataSchema = z.object({
  title: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  created_at: z.number(),
  updated_at: z.number(),

  character_snapshot: z.record(z.unknown()).nullable(),
  user_snapshot: z.record(z.unknown()).nullable(),
  character_sync_policy: z.enum(['pin', 'manual', 'force']),

  preset_name: z.string().nullable().optional(),
  prompt_mode: z.enum(['compat_strict', 'compat_plus', 'native']).nullable().optional(),
  model_provider: z.string().nullable().optional(),
  model_name: z.string().nullable().optional(),

  metadata: z.unknown().nullable(),

  floors: z.array(thChatFloorSchema),

  variables: z.array(thChatVariableSchema).optional(),
  memories: thChatMemoriesSchema.optional(),
});

export type ThChatData = z.infer<typeof thChatDataSchema>;

// ── 信封层（完整文件） ────────────────────────────────

export const thChatFileSchema = z.object({
  spec: z.literal(TH_CHAT_SPEC),
  spec_version: z.string(),
  exported_at: z.number(),
  export_source: z.string().optional(),
  export_app_version: z.string().optional(),
  data: thChatDataSchema,
});

export type ThChatFile = z.infer<typeof thChatFileSchema>;

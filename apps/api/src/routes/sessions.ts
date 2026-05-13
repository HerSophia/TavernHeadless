import { and, asc, count, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { SimpleTokenCounter } from "@tavern/core";
import { z } from "zod";

import type { AppDb, DatabaseConnection, DbExecutor } from "../db/client";
import { errorResponseJsonSchema, idParamsJsonSchema, batchIdArraySchema, batchDeleteBodyJsonSchema, batchStatusBodyJsonSchema, batchResultResponseJsonSchema } from "./schemas/common.js";
import { accountUsers, characters, characterVersions, floors, llmProfileBindings, messagePages, messages, sessions } from "../db/schema";
import { ensureOptionalObjectBody, parseJsonField, parseWithSchema, requireRow, sendError, stringifyJsonField } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";
import { getRequestAuthContext } from "../plugins/auth";
import { FloorRunService } from "../services/floor-run-service";
import type { FloorRunServiceOptions } from "../services/floor-run-service.js";
import { FloorLineageService } from "../services/floor-lineage-service.js";
import {
  getGreetingCandidates,
  getPrimaryGreeting,
  hasAnyGreeting,
  normalizeSessionCharacterSnapshot,
  parseSessionCharacterSnapshot,
  sessionCharacterSnapshotSchema as characterSnapshotSchema,
  type SessionCharacterSnapshot,
} from "../lib/character-snapshot.js";
import { deleteVariablesForSession } from "../services/variables/cleanup/variable-owned-resource-cleanup.js";
import { SessionBranchRegistryService } from "../services/variables/host/session-branch-registry-service.js";
import type { ClientDataConfig } from "../client-data/client-data-service.js";
import { SessionStateService } from "../session-state/session-state-service.js";
import { SessionAssetBindingService } from "../services/session-asset-binding-service.js";
import {
  OperationLogService,
  type OperationLogRecord,
  operationActorFromRequest,
  operationRequestIdFromRequest,
} from "../services/operation-log-service.js";
import { VcDiffService } from "../services/vc-diff-service.js";
import {
  ProjectEventService,
  ProjectEventServiceError,
  type ProjectEventRecord,
} from "../services/project-event-service.js";
import { ProjectAccessService, ProjectAccessServiceError } from "../services/project-access-service.js";
import type { ProjectEventLiveHub } from "../services/project-event-live-hub.js";
import { ProjectScopeServiceError } from "../services/project-scope-service.js";
import { SessionScopeResolver } from "../services/session-scope-resolver.js";
import { WorkspaceScopeService, WorkspaceScopeServiceError } from "../services/workspace-scope-service.js";

const sessionStatusSchema = z.enum(["active", "archived"]);
const promptModeSchema = z.enum(["compat_strict", "compat_plus", "native"]);
const characterSyncPolicySchema = z.enum(["pin", "manual", "force"]);

const userSnapshotSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional()
}).passthrough();

const sessionParamsSchema = z.object({
  id: z.string().min(1)
});

const listSessionsQuerySchema = listQuerySchemaBase.extend({
  status: sessionStatusSchema.optional(),
  keyword: z.string().trim().min(1).max(200).optional(),
  sort_by: z.enum(["created_at", "updated_at"]).default("created_at")
});

const createSessionSchema = z.object({
  project_id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  status: sessionStatusSchema.optional(),
  character_id: z.string().trim().min(1).optional(),
  character_version_id: z.string().trim().min(1).optional(),
  character_sync_policy: characterSyncPolicySchema.optional(),
  character_snapshot: characterSnapshotSchema.optional(),
  user_id: z.string().trim().min(1).optional(),
  user_snapshot: userSnapshotSchema.optional(),
  preset_id: z.string().trim().min(1).nullable().optional(),
  regex_profile_id: z.string().trim().min(1).nullable().optional(),
  worldbook_profile_id: z.string().trim().min(1).nullable().optional(),
  deep_binding: z.boolean().optional(),
  preset_version_id: z.string().trim().min(1).nullable().optional(),
  regex_profile_version_id: z.string().trim().min(1).nullable().optional(),
  worldbook_version_id: z.string().trim().min(1).nullable().optional(),
  model_provider: z.string().trim().min(1).optional(),
  model_name: z.string().trim().min(1).optional(),
  model_params: z.unknown().optional(),
  prompt_mode: promptModeSchema.optional(),
  metadata: z.unknown().optional()
});

const updateSessionSchema = createSessionSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const syncSessionCharacterSchema = z.object({
  force: z.boolean().optional()
});

const timelineQuerySchema = z.object({
  branch_id: z.string().min(1).default("main"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const listBranchesQuerySchema = listQuerySchemaBase.extend({
  sort_by: z.enum(["branch_id", "floor_count", "latest_floor_no", "updated_at"]).default("updated_at")
});

const branchDiffQuerySchema = z.object({
  base_branch_id: z.string().min(1).default("main"),
  target_branch_id: z.string().min(1)
});



const listMetaJsonSchema = {
  type: "object",
  required: ["total", "limit", "offset", "has_more", "sort_by", "sort_order"],
  properties: {
    total: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1 },
    offset: { type: "integer", minimum: 0 },
    has_more: { type: "boolean" },
    sort_by: { type: "string" },
    sort_order: { type: "string", enum: ["asc", "desc"] },
  },
  additionalProperties: false,
} as const;

const sessionBodyExample = {
  title: "Campfire Planning",
  status: "active",
  character_id: "char_hero",
  character_sync_policy: "pin",
  user_id: "usr_demo",
  project_id: "proj_main",
  preset_id: "preset_story",
  regex_profile_id: "regex_safe",
  worldbook_profile_id: "wb_world",
  deep_binding: false,
  preset_version_id: null,
  regex_profile_version_id: null,
  worldbook_version_id: null,
  model_provider: "openai",
  model_name: "gpt-4o-mini",
  model_params: {
    temperature: 0.7,
    top_p: 0.9,
  },
  prompt_mode: "native",
  metadata: {
    source: "demo",
    tags: ["beta", "docs"],
  },
} as const;

const sessionExample = {
  id: "sess_demo",
  title: "Campfire Planning",
  status: "active",
  character_binding: {
    character_id: "char_hero",
    character_version_id: "charver_hero_v3",
    sync_policy: "pin",
    snapshot_summary: {
      name: "Hero",
      has_greeting: true,
    },
  },
  user_binding: {
    user_id: "usr_demo",
    snapshot_summary: {
      name: "Alice",
    },
  },
  preset_id: "preset_story",
  regex_profile_id: "regex_safe",
  worldbook_profile_id: "wb_world",
  deep_binding: false,
  preset_version_id: null,
  regex_profile_version_id: null,
  worldbook_version_id: null,
  model_provider: "openai",
  model_name: "gpt-4o-mini",
  model_params: {
    temperature: 0.7,
    top_p: 0.9,
  },
  prompt_mode: "native",
  metadata: {
    source: "demo",
    tags: ["beta", "docs"],
  },
  created_at: 1735689600000,
  updated_at: 1735689660000,
} as const;

const sessionResponseExample = {
  data: sessionExample,
} as const;

const sessionListResponseExample = {
  data: [sessionExample],
  meta: {
    total: 1,
    limit: 20,
    offset: 0,
    has_more: false,
    sort_by: "created_at",
    sort_order: "desc",
  },
} as const;

const sessionDeleteResponseExample = {
  data: {
    id: "sess_demo",
    deleted: true,
  },
} as const;

const syncSessionCharacterBodyJsonSchema = {
  type: "object",
  properties: {
    force: { type: "boolean" },
  },
  examples: [
    {
      force: true,
    },
  ],
  additionalProperties: false,
} as const;

const sessionBodyJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 200 },
    project_id: {
      type: "string",
      minLength: 1,
      description: "Advanced field for POST /sessions. Omit it for the default Workspace and session_default Project. PATCH /sessions/:id rejects project_id changes.",
    },
    status: { type: "string", enum: ["active", "archived"] },
    character_id: { type: "string", minLength: 1 },
    character_version_id: { type: "string", minLength: 1 },
    character_sync_policy: { type: "string", enum: ["pin", "manual", "force"] },
    character_snapshot: {
      type: "object",
    },
    user_id: { type: "string", minLength: 1 },
    user_snapshot: { type: "object", additionalProperties: true },
    preset_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    regex_profile_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    worldbook_profile_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    deep_binding: { type: "boolean" },
    preset_version_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    regex_profile_version_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    worldbook_version_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    model_provider: { type: "string", minLength: 1 },
    model_name: { type: "string", minLength: 1 },
    model_params: {},
    prompt_mode: { type: "string", enum: ["compat_strict", "compat_plus", "native"] },
    metadata: {},
  },
  examples: [sessionBodyExample],
  additionalProperties: false,
} as const;

const characterBindingJsonSchema = {
  anyOf: [
    {
      type: "object",
      required: ["character_id", "character_version_id", "sync_policy", "snapshot_summary"],
      properties: {
        character_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        character_version_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        sync_policy: { type: "string", enum: ["pin", "manual", "force"] },
        snapshot_summary: {
          anyOf: [
            {
              type: "object",
              required: ["name", "has_greeting"],
              properties: {
                name: { type: "string" },
                has_greeting: { type: "boolean" }
              },
              additionalProperties: false
            },
            { type: "null" }
          ]
        }
      },
      additionalProperties: false
    },
    { type: "null" }
  ]
} as const;

const userBindingJsonSchema = {
  anyOf: [
    {
      type: "object",
      required: ["user_id", "snapshot_summary"],
      properties: {
        user_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        snapshot_summary: {
          anyOf: [
            {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" }
              },
              additionalProperties: false
            },
            { type: "null" }
          ]
        }
      },
      additionalProperties: false
    },
    {
      type: "null"
    }
  ]
} as const;

const sessionJsonSchema = {
  type: "object",
  required: [
    "id",
    "title",
    "status",
    "character_binding",
    "user_binding",
    "preset_id",
    "regex_profile_id",
    "worldbook_profile_id",
    "deep_binding",
    "preset_version_id",
    "regex_profile_version_id",
    "worldbook_version_id",
    "model_provider",
    "model_name",
    "model_params",
    "prompt_mode",
    "metadata",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    title: { anyOf: [{ type: "string" }, { type: "null" }] },
    status: { type: "string", enum: ["active", "archived"] },
    character_binding: characterBindingJsonSchema,
    user_binding: userBindingJsonSchema,
    preset_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    regex_profile_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    worldbook_profile_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    deep_binding: { type: "boolean" },
    preset_version_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    regex_profile_version_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    worldbook_version_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    model_provider: { anyOf: [{ type: "string" }, { type: "null" }] },
    model_name: { anyOf: [{ type: "string" }, { type: "null" }] },
    model_params: {},
    prompt_mode: { anyOf: [{ type: "string", enum: ["compat_strict", "compat_plus", "native"] }, { type: "null" }] },
    metadata: {},
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  examples: [sessionExample],
  additionalProperties: false,
} as const;

const sessionResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: sessionJsonSchema,
  },
  examples: [sessionResponseExample],
  additionalProperties: false,
} as const;

const deleteResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["id", "deleted"],
      properties: {
        id: { type: "string" },
        deleted: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  examples: [sessionDeleteResponseExample],
  additionalProperties: false,
} as const;

const sessionScopeResponseJsonSchema = {
  type: "object",
  required: ["session_id", "workspace_id", "project_id"],
  properties: {
    session_id: { type: "string" },
    workspace_id: { type: "string" },
    project_id: { type: "string" },
  },
  additionalProperties: false,
} as const;

const sessionListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: sessionJsonSchema },
    meta: listMetaJsonSchema,
  },
  examples: [sessionListResponseExample],
  additionalProperties: false,
} as const;

const listQueryJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
    sort_order: { type: "string", enum: ["asc", "desc"] },
    sort_by: { type: "string" },
  },
  additionalProperties: false,
} as const;

const branchSummaryJsonSchema = {
  type: "object",
  required: ["branch_id", "floor_count", "latest_floor_no", "latest_floor_id", "latest_state", "updated_at"],
  properties: {
    branch_id: { type: "string" },
    floor_count: { type: "integer", minimum: 0 },
    latest_floor_no: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    latest_floor_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    latest_state: { anyOf: [{ type: "string" }, { type: "null" }] },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const timelineFloorJsonSchema = {
  type: "object",
  required: [
    "id",
    "floor_no",
    "state",
    "token_in",
    "token_out",
    "created_at",
    "pages",
    "active_pages",
    "active_page",
    "messages",
    "page_count",
  ],
  properties: {
    id: { type: "string" },
    floor_no: { type: "integer", minimum: 0 },
    state: { type: "string" },
    token_in: { type: "integer", minimum: 0 },
    token_out: { type: "integer", minimum: 0 },
    created_at: { type: "integer", minimum: 0 },
    /**
     * Page-aware truth source. 每个 active page 都在这里展开，包含自身的
     * messages 列表。同一 floor 下可能同时存在 active input page 与 active output page。
     */
    pages: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "page_no", "page_kind", "is_active", "version", "messages"],
        properties: {
          id: { type: "string" },
          page_no: { type: "integer", minimum: 0 },
          page_kind: { type: "string" },
          is_active: { type: "boolean" },
          version: { type: "integer", minimum: 1 },
          messages: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "seq", "role", "content", "content_format"],
              properties: {
                id: { type: "string" },
                seq: { type: "integer", minimum: 0 },
                role: { type: "string" },
                content: { type: "string" },
                content_format: { type: "string" },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    /** `pages` 中 `is_active === true` 的子集。若无 active page 则为空数组。 */
    active_pages: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "page_no", "page_kind", "version", "messages"],
        properties: {
          id: { type: "string" },
          page_no: { type: "integer", minimum: 0 },
          page_kind: { type: "string" },
          version: { type: "integer", minimum: 1 },
          messages: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "seq", "role", "content", "content_format"],
              properties: {
                id: { type: "string" },
                seq: { type: "integer", minimum: 0 },
                role: { type: "string" },
                content: { type: "string" },
                content_format: { type: "string" },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    /**
     * 兼容字段（deprecated）。当且仅当 `active_pages.length === 1` 时返回该 page，
     * 其余情况固定返回 null。新调用方应改为消费 `active_pages`。
     */
    active_page: {
      anyOf: [
        {
          type: "object",
          required: ["id", "page_no", "page_kind", "version", "messages"],
          properties: {
            id: { type: "string" },
            page_no: { type: "integer", minimum: 0 },
            page_kind: { type: "string" },
            version: { type: "integer", minimum: 1 },
            messages: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "seq", "role", "content", "content_format"],
                properties: {
                  id: { type: "string" },
                  seq: { type: "integer", minimum: 0 },
                  role: { type: "string" },
                  content: { type: "string" },
                  content_format: { type: "string" },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    /**
     * 兼容字段（deprecated）。floor 级扁平化消息列表。当存在多个 active page 时，
     * 不同 page 的消息会被拼接在一起，调用方无法无损还原 page 结构，
     * 请改为消费 `pages` / `active_pages`。
     */
    messages: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "seq", "role", "content", "content_format"],
        properties: {
          id: { type: "string" },
          seq: { type: "integer", minimum: 0 },
          role: { type: "string" },
          content: { type: "string" },
          content_format: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    page_count: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const branchSummaryExample = {
  branch_id: "main",
  floor_count: 3,
  latest_floor_no: 2,
  latest_floor_id: "floor_12",
  latest_state: "committed",
  updated_at: 1735689720000,
} as const;

const branchListResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: { type: "array", items: branchSummaryJsonSchema },
    meta: listMetaJsonSchema,
  },
  examples: [
    {
      data: [branchSummaryExample],
      meta: {
        total: 1,
        limit: 20,
        offset: 0,
        has_more: false,
        sort_by: "updated_at",
        sort_order: "desc",
      },
    },
  ],
  additionalProperties: false,
} as const;

const branchDiffResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: [
        "session_id",
        "base_branch_id",
        "target_branch_id",
        "fork_floor_no",
        "shared_floor_nos",
        "base_only_floors",
        "target_only_floors",
      ],
      properties: {
        session_id: { type: "string" },
        base_branch_id: { type: "string" },
        target_branch_id: { type: "string" },
        fork_floor_no: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        shared_floor_nos: { type: "array", items: { type: "integer", minimum: 0 } },
        base_only_floors: { type: "array", items: { type: "object", additionalProperties: true } },
        target_only_floors: { type: "array", items: { type: "object", additionalProperties: true } },
      },
      additionalProperties: false,
    },
  },
  examples: [
    {
      data: {
        session_id: "sess_demo",
        base_branch_id: "main",
        target_branch_id: "alt-branch",
        fork_floor_no: 1,
        shared_floor_nos: [0, 1],
        base_only_floors: [{ id: "floor_12", branchId: "main", floorNo: 2, state: "committed" }],
        target_only_floors: [{ id: "floor_13", branchId: "alt-branch", floorNo: 2, state: "committed" }],
      },
    },
  ],
  additionalProperties: false,
} as const;

const timelineResponseJsonSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: {
      type: "object",
      required: ["session_id", "branch_id", "floors"],
      properties: {
        session_id: { type: "string" },
        branch_id: { type: "string" },
        floors: { type: "array", items: timelineFloorJsonSchema },
      },
      additionalProperties: false,
    },
    meta: listMetaJsonSchema,
  },
  examples: [
    {
      data: {
        session_id: "sess_demo",
        branch_id: "main",
        floors: [
          {
            id: "floor_12",
            floor_no: 2,
            state: "committed",
            token_in: 320,
            token_out: 128,
            created_at: 1735689720000,
            pages: [
              {
                id: "page_12",
                page_no: 0,
                page_kind: "output",
                is_active: true,
                version: 1,
                messages: [
                  {
                    id: "msg_21",
                    seq: 0,
                    role: "assistant",
                    content: "The firelight wavers as the next part of the story begins.",
                    content_format: "text",
                  },
                ],
              },
            ],
            active_pages: [
              {
                id: "page_12",
                page_no: 0,
                page_kind: "output",
                version: 1,
                messages: [
                  {
                    id: "msg_21",
                    seq: 0,
                    role: "assistant",
                    content: "The firelight wavers as the next part of the story begins.",
                    content_format: "text",
                  },
                ],
              },
            ],
            active_page: {
              id: "page_12",
              page_no: 0,
              page_kind: "output",
              version: 1,
              messages: [
                {
                  id: "msg_21",
                  seq: 0,
                  role: "assistant",
                  content: "The firelight wavers as the next part of the story begins.",
                  content_format: "text",
                },
              ],
            },
            messages: [
              {
                id: "msg_21",
                seq: 0,
                role: "assistant",
                content: "The firelight wavers as the next part of the story begins.",
                content_format: "text",
              },
            ],
            page_count: 1,
          },
        ],
      },
      meta: {
        total: 1,
        limit: 50,
        offset: 0,
        has_more: false,
        sort_by: "floor_no",
        sort_order: "asc",
      },
    },
  ],
  additionalProperties: false,
} as const;

const sessionActiveRunSummaryJsonSchema = {
  type: "object",
  required: ["branch_id", "busy", "updated_at"],
  properties: {
    branch_id: { type: "string" },
    latest_floor_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    active_run_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    active_run_type: { anyOf: [{ type: "string", enum: ["respond", "regenerate_page", "retry_turn", "edit_and_regenerate"] }, { type: "null" }] },
    busy: { type: "boolean" },
    public_phase: { anyOf: [{ type: "string", enum: ["preparing", "generating", "verifying", "committing", "post_processing"] }, { type: "null" }] },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const sessionActiveRunResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["session_id", "active_run"],
      properties: { session_id: { type: "string" }, active_run: { anyOf: [sessionActiveRunSummaryJsonSchema, { type: "null" }] } },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

type CharacterBindingData = {
  characterId: string | null;
  characterVersionId: string | null;
  characterSyncPolicy: "pin" | "manual" | "force";
  characterSnapshotJson: string | null;
};

type UserBindingData = {
  userId: string | null;
  userSnapshotJson: string | null;
};

function toCharacterBindingResponse(row: CharacterBindingData) {
  if (!row.characterId && !row.characterVersionId && !row.characterSnapshotJson) {
    return null;
  }

  return {
    character_id: row.characterId,
    character_version_id: row.characterVersionId,
    sync_policy: row.characterSyncPolicy,
    snapshot_summary: parseCharacterSnapshotSummary(row.characterSnapshotJson)
  };
}

function parseCharacterSnapshotSummary(snapshotJson: string | null) {
  if (!snapshotJson) {
    return null;
  }

  const snapshot = parseSessionCharacterSnapshot(snapshotJson);
  if (!snapshot?.name) {
    return null;
  }

  return {
    name: snapshot.name,
    has_greeting: hasAnyGreeting(snapshot)
  };
}

function toUserBindingResponse(row: UserBindingData) {
  if (!row.userId && !row.userSnapshotJson) {
    return null;
  }

  return {
    user_id: row.userId,
    snapshot_summary: parseUserSnapshotSummary(row.userSnapshotJson)
  };
}

function parseUserSnapshotSummary(snapshotJson: string | null) {
  if (!snapshotJson) {
    return null;
  }

  const raw = parseJsonField(snapshotJson) as Record<string, unknown> | null;
  const name = typeof raw?.name === "string" ? raw.name.trim() : "";
  return name
    ? { name }
    : null;
}

function toSessionResponse(row: typeof sessions.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    character_binding: toCharacterBindingResponse(row),
    user_binding: toUserBindingResponse(row),
    preset_id: row.presetId,
    regex_profile_id: row.regexProfileId,
    worldbook_profile_id: row.worldbookProfileId,
    deep_binding: row.deepBinding,
    preset_version_id: row.presetVersionId,
    regex_profile_version_id: row.regexProfileVersionId,
    worldbook_version_id: row.worldbookVersionId,
    model_provider: row.modelProvider,
    model_name: row.modelName,
    model_params: parseJsonField(row.modelParamsJson),
    prompt_mode: row.promptMode,
    metadata: parseJsonField(row.metadataJson),
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

function toSessionOperationRef(row: typeof sessions.$inferSelect) {
  return {
    session_id: row.id,
    title: row.title,
    status: row.status,
    character_id: row.characterId,
    character_version_id: row.characterVersionId,
    character_sync_policy: row.characterSyncPolicy,
    user_id: row.userId,
    preset_id: row.presetId,
    preset_version_id: row.presetVersionId,
    regex_profile_id: row.regexProfileId,
    regex_profile_version_id: row.regexProfileVersionId,
    worldbook_profile_id: row.worldbookProfileId,
    worldbook_version_id: row.worldbookVersionId,
    deep_binding: row.deepBinding,
    model_provider: row.modelProvider,
    model_name: row.modelName,
    prompt_mode: row.promptMode,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

type SessionOperationLogInput = {
  accountId: string;
  action: string;
  sessionId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  actorAccountId?: string | null;
  branchId?: string | null;
  targetId?: string | null;
  beforeRef?: unknown;
  afterRef?: unknown;
  metadata?: unknown;
  createdAt?: number;
};

function appendSessionOperationLog(
  tx: DbExecutor,
  request: FastifyRequest,
  input: SessionOperationLogInput,
): OperationLogRecord {
  const beforeRef = input.beforeRef ?? null;
  const afterRef = input.afterRef ?? null;

  return new OperationLogService(tx).append({
    ...operationActorFromRequest(request),
    accountId: input.accountId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorAccountId: input.actorAccountId,
    requestId: operationRequestIdFromRequest(request),
    sourceType: "http",
    action: input.action,
    status: "succeeded",
    sessionId: input.sessionId,
    branchId: input.branchId,
    targetType: "session",
    targetId: input.targetId ?? input.sessionId,
    beforeRef,
    afterRef,
    diff: new VcDiffService().diff(beforeRef, afterRef),
    metadata: input.metadata,
    createdAt: input.createdAt,
  });
}

type SessionProjectScope = {
  workspaceId: string;
  projectId: string;
};

function resolveSessionProjectScope(row: typeof sessions.$inferSelect): SessionProjectScope | null {
  if (!row.workspaceId || !row.projectId) {
    return null;
  }

  return {
    workspaceId: row.workspaceId,
    projectId: row.projectId,
  };
}

function appendSessionProjectEvent(input: {
  tx: DbExecutor;
  row: typeof sessions.$inferSelect;
  type: "session.created" | "session.updated" | "session.archived";
  actorAccountId: string;
  operationLogId: string | null;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt?: number;
}): ProjectEventRecord | null {
  const scope = resolveSessionProjectScope(input.row);
  if (!scope) {
    return null;
  }

  return new ProjectEventService(input.tx).append({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    type: input.type,
    visibility: "project",
    source: "api",
    actorAccountId: input.actorAccountId,
    sessionId: input.row.id,
    branchId: "main",
    operationLogId: input.operationLogId,
    correlationId: input.correlationId,
    payload: input.payload,
    createdAt: input.createdAt,
  });
}

function publishProjectEvents(hub: ProjectEventLiveHub | undefined, events: readonly ProjectEventRecord[]): void {
  if (!hub || events.length === 0) {
    return;
  }

  try {
    hub.publishMany(events);
  } catch {
    // Live delivery is best-effort. The durable event rows are already committed.
  }
}

function toSessionActiveRunResponse(summary: Awaited<ReturnType<FloorRunService["getActiveRunSummary"]>>) {
  if (!summary) {
    return null;
  }

  return {
    branch_id: summary.branchId,
    latest_floor_id: summary.latestFloorId ?? null,
    active_run_id: summary.activeRunId ?? null,
    active_run_type: summary.activeRunType ?? null,
    busy: summary.busy,
    public_phase: summary.publicPhase ?? null,
    updated_at: summary.updatedAt,
  };
}

interface ResolveCharacterBindingInput {
  character_id?: string;
  character_version_id?: string;
  character_sync_policy?: "pin" | "manual" | "force";
  character_snapshot?: SessionCharacterSnapshot;
}

interface ResolveUserBindingInput {
  user_id?: string;
  user_snapshot?: z.infer<typeof userSnapshotSchema>;
}

type ResolvedCharacterBinding = {
  characterId: string | null;
  characterVersionId: string | null;
  characterSnapshotJson: string | null;
  characterSyncPolicy: "pin" | "manual" | "force";
};

type ResolvedUserBinding = {
  userId: string | null;
  userSnapshotJson: string | null;
};

type BindingResolutionError = {
  statusCode: number;
  code: string;
  message: string;
};

class SessionRouteError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SessionRouteError";
  }
}

function isBindingResolutionError(value: unknown): value is BindingResolutionError {
  return Boolean(value && typeof value === "object" && "statusCode" in value);
}

function throwIfSessionWriteError<T>(result: T | BindingResolutionError): T {
  if (isBindingResolutionError(result)) {
    throw new SessionRouteError(result.statusCode, result.code, result.message);
  }

  return result;
}

type OwnedWorkspaceCharacterVersionRecord = {
  id: string;
  characterId: string;
  dataJson: string;
};

function isWorkspaceCompatible(rowWorkspaceId: string | null, workspaceId: string): boolean {
  // 兼容历史数据：nullable workspace_id 在 Phase 1 期间视为旧账号默认 Workspace 资源。
  return rowWorkspaceId === null || rowWorkspaceId === workspaceId;
}

function getOwnedActiveCharacterVersionByIdForWorkspace(
  db: AppDb | DbExecutor,
  accountId: string,
  workspaceId: string,
  characterVersionId: string,
): OwnedWorkspaceCharacterVersionRecord | null {
  const versionRow = db
    .select({
      id: characterVersions.id,
      characterId: characterVersions.characterId,
      dataJson: characterVersions.dataJson,
    })
    .from(characterVersions)
    .where(eq(characterVersions.id, characterVersionId))
    .limit(1)
    .all()[0];

  if (!versionRow) {
    return null;
  }

  const character = db
    .select({ id: characters.id, workspaceId: characters.workspaceId })
    .from(characters)
    .where(
      and(
        eq(characters.id, versionRow.characterId),
        eq(characters.accountId, accountId),
        eq(characters.status, "active"),
      ),
    )
    .limit(1)
    .all()[0];

  if (!character || !isWorkspaceCompatible(character.workspaceId, workspaceId)) {
    return null;
  }

  return versionRow;
}

function getLatestOwnedActiveCharacterVersionForWorkspace(
  db: AppDb | DbExecutor,
  accountId: string,
  workspaceId: string,
  characterId: string,
): OwnedWorkspaceCharacterVersionRecord | null {
  const character = db
    .select({ id: characters.id, workspaceId: characters.workspaceId })
    .from(characters)
    .where(
      and(
        eq(characters.id, characterId),
        eq(characters.accountId, accountId),
        eq(characters.status, "active"),
      ),
    )
    .limit(1)
    .all()[0];

  if (!character || !isWorkspaceCompatible(character.workspaceId, workspaceId)) {
    return null;
  }

  const versionRow = db
    .select({
      id: characterVersions.id,
      characterId: characterVersions.characterId,
      dataJson: characterVersions.dataJson,
    })
    .from(characterVersions)
    .where(eq(characterVersions.characterId, characterId))
    .orderBy(desc(characterVersions.versionNo))
    .limit(1)
    .all()[0];

  return versionRow ?? null;
}

function resolveCharacterBinding(
  db: AppDb | DbExecutor,
  accountId: string,
  workspaceId: string,
  input: ResolveCharacterBindingInput
): ResolvedCharacterBinding | BindingResolutionError {
  const syncPolicy = input.character_sync_policy ?? "pin";

  if (!input.character_id && !input.character_version_id && !input.character_snapshot) {
    return {
      characterId: null,
      characterVersionId: null,
      characterSnapshotJson: null,
      characterSyncPolicy: syncPolicy
    };
  }

  const directSnapshot = input.character_snapshot
    ? normalizeSessionCharacterSnapshot(input.character_snapshot)
    : undefined;

  if (input.character_snapshot && !directSnapshot) {
    return { statusCode: 400, code: "invalid_character_snapshot", message: "Character snapshot is invalid" };
  }

  if (input.character_snapshot && !input.character_id && !input.character_version_id) {
    return {
      characterId: null,
      characterVersionId: null,
      characterSnapshotJson: stringifyJsonField(directSnapshot),
      characterSyncPolicy: syncPolicy
    };
  }

  const versionRow = input.character_version_id
    ? getOwnedActiveCharacterVersionByIdForWorkspace(db, accountId, workspaceId, input.character_version_id)
    : getLatestOwnedActiveCharacterVersionForWorkspace(db, accountId, workspaceId, input.character_id ?? "");

  if (!versionRow) {
    return { statusCode: 404, code: "character_not_found", message: "Character or version not found" };
  }

  if (input.character_id && input.character_id !== versionRow.characterId) {
    return { statusCode: 400, code: "character_version_mismatch", message: "character_id does not match character_version_id" };
  }

  const snapshot = directSnapshot ?? normalizeSessionCharacterSnapshot(parseJsonField(versionRow.dataJson));
  if (!snapshot) {
    return { statusCode: 400, code: "invalid_character_snapshot", message: "Character snapshot is invalid" };
  }

  return {
    characterId: versionRow.characterId,
    characterVersionId: versionRow.id,
    characterSnapshotJson: stringifyJsonField(snapshot),
    characterSyncPolicy: syncPolicy
  };
}

function resolveUserBinding(
  db: AppDb | DbExecutor,
  accountId: string,
  workspaceId: string,
  input: ResolveUserBindingInput
): ResolvedUserBinding | BindingResolutionError {
  if (!input.user_id && !input.user_snapshot) {
    return {
      userId: null,
      userSnapshotJson: null
    };
  }

  if (input.user_snapshot && !input.user_id) {
    return {
      userId: null,
      userSnapshotJson: stringifyJsonField(input.user_snapshot)
    };
  }

  const userRow = db
    .select({
      id: accountUsers.id,
      workspaceId: accountUsers.workspaceId,
      snapshotJson: accountUsers.snapshotJson,
      status: accountUsers.status
    })
    .from(accountUsers)
    .where(and(eq(accountUsers.id, input.user_id ?? ""), eq(accountUsers.accountId, accountId)))
    .limit(1)
    .all()[0];

  if (!userRow || userRow.status === "deleted") {
    return {
      statusCode: 404,
      code: "user_not_found",
      message: "User not found"
    };
  }

  if (!isWorkspaceCompatible(userRow.workspaceId, workspaceId)) {
    return {
      statusCode: 404,
      code: "user_not_found",
      message: "User not found"
    };
  }

  if (userRow.status !== "active") {
    return {
      statusCode: 409,
      code: "user_not_active",
      message: "User is not active"
    };
  }

  const snapshot = input.user_snapshot ?? parseJsonField(userRow.snapshotJson);
  const parsedSnapshot = userSnapshotSchema.safeParse(snapshot);
  if (!parsedSnapshot.success) {
    return {
      statusCode: 400,
      code: "invalid_user_snapshot",
      message: "User snapshot is invalid"
    };
  }

  return {
    userId: userRow.id,
    userSnapshotJson: stringifyJsonField(parsedSnapshot.data)
  };
}


function buildFloorMetadataForUserBinding(userId: string | null, userSnapshotJson: string | null, replacedAt: number) {
  const snapshotSummary = parseUserSnapshotSummary(userSnapshotJson);
  if (!userId && !snapshotSummary) {
    return null;
  }

  return {
    user_binding: {
      user_id: userId,
      snapshot_summary: snapshotSummary,
      replaced_at: replacedAt
    }
  };
}

function mergeFloorMetadataWithUserBinding(
  metadataJson: string | null,
  userId: string | null,
  userSnapshotJson: string | null,
  replacedAt: number
): string | null {
  const current = parseJsonField(metadataJson) as Record<string, unknown> | null;
  const metadata = current && typeof current === "object" ? { ...current } : {};

  const binding = buildFloorMetadataForUserBinding(userId, userSnapshotJson, replacedAt);
  if (binding) {
    metadata.user_binding = binding.user_binding;
  } else {
    delete metadata.user_binding;
  }

  if (Object.keys(metadata).length === 0) {
    return null;
  }

  return stringifyJsonField(metadata);
}

type SyncCharacterBindingPlan = {
  latestVersionId: string;
  snapshotJson: string;
  changed: boolean;
};

function sessionOwnershipFilter(sessionId: string, accountId: string) {
  return and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId));
}

function deleteSessionOwnedProfileBindings(tx: DbExecutor, sessionId: string, accountId: string): void {
  tx.delete(llmProfileBindings)
    .where(and(
      eq(llmProfileBindings.accountId, accountId),
      eq(llmProfileBindings.scope, "session"),
      eq(llmProfileBindings.scopeId, sessionId),
    ))
    .run();
}

type DeleteOwnedSessionAndBindingsOptions = {
  sessionStateService?: SessionStateService;
};

function deleteOwnedSessionAndBindings(
  tx: DbExecutor,
  sessionId: string,
  accountId: string,
  options: DeleteOwnedSessionAndBindingsOptions = {},
) {
  const existing = tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(sessionOwnershipFilter(sessionId, accountId))
    .limit(1)
    .all()[0];

  if (!existing) {
    return [];
  }

  deleteVariablesForSession(tx, { accountId, sessionId });
  deleteSessionOwnedProfileBindings(tx, sessionId, accountId);
  options.sessionStateService?.releaseManagedDomainsForSession({ accountId, sessionId }, tx);

  const deleted = tx.delete(sessions).where(sessionOwnershipFilter(sessionId, accountId)).returning({ id: sessions.id }).all();

  return deleted;
}

async function resolveCharacterBindingSync(
  db: DatabaseConnection["db"],
  accountId: string,
  sessionRow: typeof sessions.$inferSelect,
  force: boolean
): Promise<SyncCharacterBindingPlan | BindingResolutionError> {
  if (!sessionRow.characterId) {
    return {
      statusCode: 409,
      code: "character_binding_missing",
      message: "Session has no bound character"
    };
  }

  if (sessionRow.characterSyncPolicy === "pin" && !force) {
    return {
      statusCode: 409,
      code: "character_sync_blocked",
      message: "Session uses pin sync policy; pass force=true to sync explicitly"
    };
  }

  let workspaceId = sessionRow.workspaceId;
  if (!workspaceId) {
    try {
      workspaceId = new WorkspaceScopeService(db).getDefaultWorkspace(accountId).id;
    } catch (error) {
      if (error instanceof WorkspaceScopeServiceError) {
        return { statusCode: error.statusCode, code: error.code, message: error.message };
      }
      throw error;
    }
  }

  const latestVersion = getLatestOwnedActiveCharacterVersionForWorkspace(db, accountId, workspaceId, sessionRow.characterId);

  if (!latestVersion) {
    return { statusCode: 404, code: "character_not_found", message: "Character version not found" };
  }

  if (!latestVersion.id) {
    return { statusCode: 500, code: "invalid_character_version", message: "Stored character version is invalid" };
  }

  const snapshot = normalizeSessionCharacterSnapshot(parseJsonField(latestVersion.dataJson));
  if (!snapshot) {
    return { statusCode: 500, code: "invalid_character_snapshot", message: "Stored character snapshot is invalid" };
  }

  const snapshotJson = stringifyJsonField(snapshot) ?? "{}";
  if (sessionRow.characterVersionId === latestVersion.id && sessionRow.characterSnapshotJson === snapshotJson) {
    return { latestVersionId: latestVersion.id, snapshotJson, changed: false };
  }

  return { latestVersionId: latestVersion.id, snapshotJson, changed: true };
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: {
    clientData?: ClientDataConfig;
    floorRun?: FloorRunServiceOptions;
    projectEventLiveHub?: ProjectEventLiveHub;
  } = {},
): Promise<void> {
  const { db } = connection;
  const projectAccessService = new ProjectAccessService(db);
  const floorRunService = new FloorRunService(db, undefined, options.floorRun);
  const lineageService = new FloorLineageService(db);
  const branchRegistry = new SessionBranchRegistryService(db);
  const sessionStateService = options.clientData
    ? new SessionStateService(db, { clientData: options.clientData })
    : undefined;
  const sessionAssetBindingService = new SessionAssetBindingService(db);
  function authorizeProjectWrite(
    reply: FastifyReply,
    actorAccountId: string,
    sessionId: string,
  ): { ok: true; hasProjectScope: boolean } | { ok: false } {
    try {
      projectAccessService.requireProjectActionBySessionId(actorAccountId, sessionId, "project.write");
      return { ok: true, hasProjectScope: true };
    } catch (error) {
      if (error instanceof ProjectAccessServiceError) {
        if (error.code === "session_project_scope_missing") {
          return { ok: true, hasProjectScope: false };
        }
        if (error.code === "session_not_found") {
          sendError(reply, 404, "not_found", "Session not found");
          return { ok: false };
        }
        if (error.code === "project_access_denied" && error.denyReason === "not_a_member") {
          sendError(reply, 404, "not_found", "Session not found");
          return { ok: false };
        }
        sendError(reply, error.statusCode, error.code, error.message);
        return { ok: false };
      }
      throw error;
    }
  }

  function authorizeProjectRead(actorAccountId: string, sessionId: string): { hasAccess: boolean; hasProjectScope: boolean } {
    try {
      projectAccessService.requireProjectActionBySessionId(actorAccountId, sessionId, "project.read");
      return { hasAccess: true, hasProjectScope: true };
    } catch(error) {
      if (error instanceof ProjectAccessServiceError && error.code === "session_project_scope_missing") {
        return { hasAccess: false, hasProjectScope: false };
      }
      return { hasAccess: false, hasProjectScope: true };
    }
  }






  app.post("/sessions", {
    schema: {
      tags: ["sessions"],
      summary: "Create session",
      body: sessionBodyJsonSchema,
      response: {
        201: sessionResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createSessionSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const now = Date.now();
    const auth = getRequestAuthContext(request);
    const sessionId = nanoid();

    let created: typeof sessions.$inferSelect;
    let projectEvents: ProjectEventRecord[] = [];
    try {
      const transactionResult = db.transaction((tx) => {
        const scope = new SessionScopeResolver(tx).resolveForCreate({
          accountId: auth.accountId,
          projectId: parsedBody.data.project_id,
          title: parsedBody.data.title ?? null,
          sessionId,
          now,
        });

        const characterBinding = throwIfSessionWriteError(
          resolveCharacterBinding(tx, auth.accountId, scope.workspaceId, parsedBody.data),
        );
        const userBinding = throwIfSessionWriteError(
          resolveUserBinding(tx, auth.accountId, scope.workspaceId, parsedBody.data),
        );
        const promptAssetBindings = throwIfSessionWriteError(
          new SessionAssetBindingService(tx).resolveCreate(auth.accountId, scope.workspaceId, parsedBody.data),
        );

        const snapshot = parseSessionCharacterSnapshot(characterBinding.characterSnapshotJson);
        const greetingCandidates = getGreetingCandidates(snapshot);
        const tokenCounter = new SimpleTokenCounter();

        const [insertedSession] = tx
          .insert(sessions)
          .values({
            id: sessionId,
            title: parsedBody.data.title ?? null,
            userId: userBinding.userId,
            userSnapshotJson: userBinding.userSnapshotJson,
            characterId: characterBinding.characterId,
            accountId: auth.accountId,
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
            characterVersionId: characterBinding.characterVersionId,
            characterSnapshotJson: characterBinding.characterSnapshotJson,
            characterSyncPolicy: characterBinding.characterSyncPolicy,
            status: parsedBody.data.status ?? "active",
            presetId: promptAssetBindings.presetId,
            regexProfileId: promptAssetBindings.regexProfileId,
            worldbookProfileId: promptAssetBindings.worldbookProfileId,
            deepBinding: promptAssetBindings.deepBinding,
            presetVersionId: promptAssetBindings.presetVersionId,
            regexProfileVersionId: promptAssetBindings.regexProfileVersionId,
            worldbookVersionId: promptAssetBindings.worldbookVersionId,
            modelProvider: parsedBody.data.model_provider ?? null,
            modelName: parsedBody.data.model_name ?? null,
            modelParamsJson: stringifyJsonField(parsedBody.data.model_params),
            promptMode: parsedBody.data.prompt_mode ?? null,
            metadataJson: stringifyJsonField(parsedBody.data.metadata ?? {}),
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .all();

        const createdSession = requireRow(insertedSession, "Failed to create session");

        new SessionBranchRegistryService(tx).ensure({
          accountId: auth.accountId,
          sessionId: createdSession.id,
          branchId: "main",
          createdAt: now,
          updatedAt: now,
        });

        if (greetingCandidates.length > 0) {
          const greeting = greetingCandidates[0]!;
          const greetingTokens = tokenCounter.count(greeting);
          const floorId = nanoid();

          tx.insert(floors).values({
            id: floorId,
            sessionId: createdSession.id,
            floorNo: 0,
            branchId: "main",
            parentFloorId: null,
            metadataJson: stringifyJsonField(
              buildFloorMetadataForUserBinding(createdSession.userId, createdSession.userSnapshotJson, now),
            ),
            state: "committed",
            tokenIn: 0,
            tokenOut: greetingTokens,
            createdAt: now,
            updatedAt: now,
          }).run();

          for (let index = 0; index < greetingCandidates.length; index += 1) {
            const pageId = nanoid();
            const content = greetingCandidates[index]!;
            const isActive = index === 0;

            tx.insert(messagePages).values({
              id: pageId,
              floorId,
              pageNo: 0,
              pageKind: "output",
              isActive,
              version: index + 1,
              checksum: null,
              createdAt: now,
              updatedAt: now,
            }).run();

            tx.insert(messages).values({
              id: nanoid(),
              pageId,
              seq: 0,
              role: "assistant",
              content,
              contentFormat: "text",
              tokenCount: tokenCounter.count(content),
              isHidden: false,
              source: "greeting",
              createdAt: now,
            }).run();
          }
        }

        const operation = appendSessionOperationLog(tx, request, {
          accountId: auth.accountId,
          action: "create_session",
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          actorAccountId: auth.accountId,
          sessionId: createdSession.id,
          branchId: "main",
          afterRef: toSessionOperationRef(createdSession),
          metadata: {
            route: "POST /sessions",
            request_fields: Object.keys(parsedBody.data).sort(),
            greeting_message_count: greetingCandidates.length,
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            project_was_created: scope.projectWasCreated,
          },
          createdAt: now,
        });

        const projectEvent = appendSessionProjectEvent({
          tx,
          row: createdSession,
          type: "session.created",
          actorAccountId: auth.accountId,
          operationLogId: operation.id,
          correlationId: operation.requestId,
          payload: {
            session_id: createdSession.id,
            title: createdSession.title,
            status: createdSession.status,
            project_was_created: scope.projectWasCreated,
          },
          createdAt: now,
        });

        return {
          session: createdSession,
          projectEvents: projectEvent ? [projectEvent] : [],
        };
      });
      created = transactionResult.session;
      projectEvents = transactionResult.projectEvents;
    } catch (error) {
      if (
        error instanceof SessionRouteError
        || error instanceof WorkspaceScopeServiceError
        || error instanceof ProjectScopeServiceError
        || error instanceof ProjectEventServiceError
      ) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }

    publishProjectEvents(options.projectEventLiveHub, projectEvents);
    return reply.code(201).send({ data: toSessionResponse(created) });
  });

  app.get("/sessions", {
    schema: {
      tags: ["sessions"],
      summary: "List sessions",
      querystring: {
        ...listQueryJsonSchema,
        properties: {
          ...listQueryJsonSchema.properties,
          status: { type: "string", enum: ["active", "archived"] },
          sort_by: { type: "string", enum: ["created_at", "updated_at"] },
          keyword: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
      response: { 200: sessionListResponseJsonSchema, 400: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listSessionsQuerySchema, request.query, reply);

    if (!parsedQuery.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const filters = [eq(sessions.accountId, auth.accountId)];

    if (parsedQuery.data.status !== undefined) {
      filters.push(eq(sessions.status, parsedQuery.data.status));
    }

    if (parsedQuery.data.keyword) {
      filters.push(like(sessions.title, `%${parsedQuery.data.keyword}%`));
    }

    const whereClause = and(...filters);
    const sortByColumn = parsedQuery.data.sort_by === "updated_at" ? sessions.updatedAt : sessions.createdAt;

    const rows = await db
      .select()
      .from(sessions)
      .where(whereClause)
      .orderBy(toOrderBy(sortByColumn, parsedQuery.data.sort_order))
      .limit(parsedQuery.data.limit)
      .offset(parsedQuery.data.offset);

    const totalRows = await db.select({ total: count() }).from(sessions).where(whereClause);

    const total = Number(totalRows[0]?.total ?? 0);

    return reply.send({
      data: rows.map(toSessionResponse),
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
  });

  app.get("/sessions/:id", {
    schema: {
      tags: ["sessions"],
      summary: "Get session",
      params: idParamsJsonSchema,
      response: {
        200: sessionResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    let [row] = await db.select().from(sessions).where(sessionOwnershipFilter(parsedParams.data.id, auth.accountId));

    if (!row) {
      const readAccess = authorizeProjectRead(auth.accountId, parsedParams.data.id);
      if (readAccess.hasAccess) {
        const fetched = await db
          .select()
          .from(sessions)
          .where(eq(sessions.id, parsedParams.data.id));
        row = fetched[0];
      }
    }

    if (!row) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    return reply.send({ data: toSessionResponse(row) });
  });

  app.get("/sessions/:id/scope", {
    schema: {
      tags: ["sessions"],
      summary: "Get session project scope",
      params: idParamsJsonSchema,
      response: {
        200: sessionScopeResponseJsonSchema,
        403: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    try {
      const access = projectAccessService.requireProjectActionBySessionId(
        auth.accountId,
        parsedParams.data.id,
        "project.read",
      );
      const session = db
        .select({ id: sessions.id, workspaceId: sessions.workspaceId, projectId: sessions.projectId })
        .from(sessions)
        .where(eq(sessions.id, parsedParams.data.id))
        .limit(1)
        .get();

      if (!session || !session.projectId) {
        return sendError(reply, 404, "not_found", "Session not found");
      }

      return reply.send({
        session_id: session.id,
        workspace_id: session.workspaceId ?? access.project.workspaceId,
        project_id: session.projectId,
      });
    } catch (error) {
      if (error instanceof ProjectAccessServiceError) {
        if (error.code === "project_access_denied" && error.denyReason === "not_a_member") {
          return sendError(reply, 404, "not_found", "Session not found");
        }
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  });

  app.get("/sessions/:id/active-run", {
    schema: {
      tags: ["sessions"],
      summary: "Get session active run summary",
      params: idParamsJsonSchema,
      response: {
        200: sessionActiveRunResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    let [row] = await db.select({ id: sessions.id }).from(sessions).where(sessionOwnershipFilter(parsedParams.data.id, auth.accountId));

    if (!row) {
      const readAccess = authorizeProjectRead(auth.accountId, parsedParams.data.id);
      if (readAccess.hasAccess) {
        const fetched = await db
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.id, parsedParams.data.id));
        row = fetched[0];
      }
    }

    if (!row) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    const activeRun = await floorRunService.getActiveRunSummary(row.id);
    return reply.send({ data: { session_id: row.id, active_run: toSessionActiveRunResponse(activeRun) } });
  });

  app.patch("/sessions/:id", {
    schema: {
      tags: ["sessions"],
      summary: "Update session",
      params: idParamsJsonSchema,
      body: {
        ...sessionBodyJsonSchema,
        minProperties: 1,
      },
      response: { 200: sessionResponseJsonSchema, 400: errorResponseJsonSchema, 404: errorResponseJsonSchema, 409: errorResponseJsonSchema },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    if (
      request.body !== null
      && typeof request.body === "object"
      && Object.prototype.hasOwnProperty.call(request.body, "project_id")
    ) {
      return sendError(reply, 400, "session_project_move_not_supported", "Changing a session project is not supported");
    }

    const parsedBody = parseWithSchema(updateSessionSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const writeAuth = authorizeProjectWrite(reply, auth.accountId, parsedParams.data.id);
    if (!writeAuth.ok) {
      return;
    }

    const [existingSession] = await db
      .select()
      .from(sessions)
      .where(writeAuth.hasProjectScope
        ? eq(sessions.id, parsedParams.data.id)
        : sessionOwnershipFilter(parsedParams.data.id, auth.accountId))
      .limit(1);

    if (!existingSession) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    let sessionWorkspaceId: string;
    try {
      sessionWorkspaceId = existingSession.workspaceId ?? new WorkspaceScopeService(db).getDefaultWorkspace(auth.accountId).id;
    } catch (error) {
      if (error instanceof WorkspaceScopeServiceError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }

    const updates: Partial<typeof sessions.$inferInsert> = {
      updatedAt: Date.now()
    };

    let nextUserId = existingSession.userId;
    let nextUserSnapshotJson = existingSession.userSnapshotJson;

    const existingCharacterSnapshot = parseSessionCharacterSnapshot(existingSession.characterSnapshotJson) ?? undefined;

    const hasCharacterBindingUpdate =
      parsedBody.data.character_id !== undefined ||
      parsedBody.data.character_version_id !== undefined ||
      parsedBody.data.character_sync_policy !== undefined ||
      parsedBody.data.character_snapshot !== undefined;

    const hasUserBindingUpdate = parsedBody.data.user_id !== undefined || parsedBody.data.user_snapshot !== undefined;

    if (hasCharacterBindingUpdate) {
      const hasExplicitCharacterId = parsedBody.data.character_id !== undefined;
      const hasExplicitCharacterVersionId = parsedBody.data.character_version_id !== undefined;
      const hasExplicitCharacterTarget = hasExplicitCharacterId || hasExplicitCharacterVersionId;

      const bindingInput: ResolveCharacterBindingInput = {
        character_id: hasExplicitCharacterId
          ? parsedBody.data.character_id
          : existingSession.characterId ?? undefined,
        character_version_id: hasExplicitCharacterVersionId
          ? parsedBody.data.character_version_id
          : hasExplicitCharacterId ? undefined : existingSession.characterVersionId ?? undefined,
        character_sync_policy: parsedBody.data.character_sync_policy ?? existingSession.characterSyncPolicy,
        character_snapshot: parsedBody.data.character_snapshot !== undefined
          ? parsedBody.data.character_snapshot
          : hasExplicitCharacterTarget ? undefined : existingCharacterSnapshot
      };

      const characterBinding = resolveCharacterBinding(db, auth.accountId, sessionWorkspaceId, bindingInput);
      if ("statusCode" in characterBinding) {
        return sendError(reply, characterBinding.statusCode, characterBinding.code, characterBinding.message);
      }

      updates.characterId = characterBinding.characterId;
      updates.characterVersionId = characterBinding.characterVersionId;
      updates.characterSnapshotJson = characterBinding.characterSnapshotJson;
      updates.characterSyncPolicy = characterBinding.characterSyncPolicy;
    }

    if (hasUserBindingUpdate) {
      const userBinding = resolveUserBinding(db, auth.accountId, sessionWorkspaceId, {
        user_id: parsedBody.data.user_id ?? existingSession.userId ?? undefined,
        user_snapshot:
          parsedBody.data.user_snapshot ?? (
            parsedBody.data.user_id === undefined
              ? (parseJsonField(existingSession.userSnapshotJson) as z.infer<typeof userSnapshotSchema> | null) ?? undefined
              : undefined
          )
      });

      if ("statusCode" in userBinding) {
        return sendError(reply, userBinding.statusCode, userBinding.code, userBinding.message);
      }

      nextUserId = userBinding.userId;
      nextUserSnapshotJson = userBinding.userSnapshotJson;
      updates.userId = userBinding.userId;
      updates.userSnapshotJson = userBinding.userSnapshotJson;
    }

    if (parsedBody.data.title !== undefined) {
      updates.title = parsedBody.data.title;
    }

    if (parsedBody.data.status !== undefined) {
      updates.status = parsedBody.data.status;
    }

    const hasPromptAssetBindingUpdate =
      parsedBody.data.preset_id !== undefined
      || parsedBody.data.regex_profile_id !== undefined
      || parsedBody.data.worldbook_profile_id !== undefined
      || parsedBody.data.deep_binding !== undefined
      || parsedBody.data.preset_version_id !== undefined
      || parsedBody.data.regex_profile_version_id !== undefined
      || parsedBody.data.worldbook_version_id !== undefined;

    if (hasPromptAssetBindingUpdate) {
      const promptAssetBindings = sessionAssetBindingService.resolveUpdate(auth.accountId, sessionWorkspaceId, {
        presetId: existingSession.presetId,
        regexProfileId: existingSession.regexProfileId,
        worldbookProfileId: existingSession.worldbookProfileId,
        deepBinding: existingSession.deepBinding,
        presetVersionId: existingSession.presetVersionId,
        regexProfileVersionId: existingSession.regexProfileVersionId,
        worldbookVersionId: existingSession.worldbookVersionId,
      }, parsedBody.data);

      if ("statusCode" in promptAssetBindings) {
        return sendError(reply, promptAssetBindings.statusCode, promptAssetBindings.code, promptAssetBindings.message);
      }

      updates.presetId = promptAssetBindings.presetId;
      updates.regexProfileId = promptAssetBindings.regexProfileId;
      updates.worldbookProfileId = promptAssetBindings.worldbookProfileId;
      updates.deepBinding = promptAssetBindings.deepBinding;
      updates.presetVersionId = promptAssetBindings.presetVersionId;
      updates.regexProfileVersionId = promptAssetBindings.regexProfileVersionId;
      updates.worldbookVersionId = promptAssetBindings.worldbookVersionId;
    }

    if (parsedBody.data.model_provider !== undefined) {
      updates.modelProvider = parsedBody.data.model_provider;
    }

    if (parsedBody.data.model_name !== undefined) {
      updates.modelName = parsedBody.data.model_name;
    }

    if (parsedBody.data.model_params !== undefined) {
      updates.modelParamsJson = stringifyJsonField(parsedBody.data.model_params);
    }

    if (parsedBody.data.prompt_mode !== undefined) {
      updates.promptMode = parsedBody.data.prompt_mode;
    }

    if (parsedBody.data.metadata !== undefined) {
      updates.metadataJson = stringifyJsonField(parsedBody.data.metadata);
    }

    const shouldReplaceFloorUserBinding =
      nextUserId !== existingSession.userId || nextUserSnapshotJson !== existingSession.userSnapshotJson;

    const beforeRef = toSessionOperationRef(existingSession);
    const requestFields = Object.keys(parsedBody.data).sort();
    let updated: typeof sessions.$inferSelect | null = null;
    let pendingProjectEvents: ProjectEventRecord[] = [];
    try {
      updated = db.transaction((tx) => {
        const [updatedRow] = tx
          .update(sessions)
          .set(updates)
          .where(eq(sessions.id, existingSession.id))
          .returning()
          .all();

        if (updatedRow && shouldReplaceFloorUserBinding) {
          const floorReplaceTimestamp = Date.now();
          const floorRows = tx
            .select({ id: floors.id, metadataJson: floors.metadataJson })
            .from(floors)
            .where(eq(floors.sessionId, existingSession.id))
            .all();

          for (const floor of floorRows) {
            tx
              .update(floors)
              .set({
                metadataJson: mergeFloorMetadataWithUserBinding(floor.metadataJson, nextUserId, nextUserSnapshotJson, floorReplaceTimestamp),
                updatedAt: floorReplaceTimestamp
              })
              .where(eq(floors.id, floor.id))
              .run();
          }
        }

        if (updatedRow) {
          const operation = appendSessionOperationLog(tx, request, {
            accountId: auth.accountId,
            action: "update_session",
            workspaceId: updatedRow.workspaceId,
            projectId: updatedRow.projectId,
            actorAccountId: auth.accountId,
            sessionId: updatedRow.id,
            beforeRef,
            afterRef: toSessionOperationRef(updatedRow),
            metadata: {
              route: "PATCH /sessions/:id",
              request_fields: requestFields,
              character_binding_update: hasCharacterBindingUpdate,
              user_binding_update: hasUserBindingUpdate,
              prompt_asset_binding_update: hasPromptAssetBindingUpdate,
              floor_user_binding_replaced: shouldReplaceFloorUserBinding,
              workspace_id: updatedRow.workspaceId,
              project_id: updatedRow.projectId,
            },
            createdAt: updatedRow.updatedAt,
          });

          const projectEvents: ProjectEventRecord[] = [];
          const archivedTransition =
            parsedBody.data.status === "archived" && existingSession.status !== "archived";

          const updatedEvent = appendSessionProjectEvent({
            tx,
            row: updatedRow,
            type: "session.updated",
            actorAccountId: auth.accountId,
            operationLogId: operation.id,
            correlationId: operation.requestId,
            payload: {
              session_id: updatedRow.id,
              changed_fields: requestFields,
              character_binding_update: hasCharacterBindingUpdate,
              user_binding_update: hasUserBindingUpdate,
              prompt_asset_binding_update: hasPromptAssetBindingUpdate,
              floor_user_binding_replaced: shouldReplaceFloorUserBinding,
              ...(archivedTransition ? { status_changed_to: "archived" as const } : {}),
            },
            createdAt: updatedRow.updatedAt,
          });
          if (updatedEvent) {
            projectEvents.push(updatedEvent);
          }

          if (archivedTransition) {
            const archivedEvent = appendSessionProjectEvent({
              tx,
              row: updatedRow,
              type: "session.archived",
              actorAccountId: auth.accountId,
              operationLogId: operation.id,
              correlationId: operation.requestId,
              payload: {
                session_id: updatedRow.id,
              },
              createdAt: updatedRow.updatedAt,
            });
            if (archivedEvent) {
              projectEvents.push(archivedEvent);
            }
          }

          pendingProjectEvents = projectEvents;
        }

        return updatedRow ?? null;
      });
    } catch (error) {
      if (error instanceof ProjectEventServiceError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }

    if (!updated) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    publishProjectEvents(options.projectEventLiveHub, pendingProjectEvents);
    return reply.send({ data: toSessionResponse(updated) });
  });

  app.post("/sessions/:id/character/sync", {
    schema: {
      tags: ["sessions"],
      summary: "Sync session character snapshot to latest version",
      params: idParamsJsonSchema,
      body: syncSessionCharacterBodyJsonSchema,
      response: {
        200: sessionResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      }
    },
    preValidation: (request, _reply, done) => {
      ensureOptionalObjectBody(request);
      done();
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    const parsedBody = parseWithSchema(syncSessionCharacterSchema, request.body ?? {}, reply);
    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const writeAuth = authorizeProjectWrite(reply, auth.accountId, parsedParams.data.id);
    if (!writeAuth.ok) {
      return;
    }
    const [sessionRow] = await db.select().from(sessions).where(writeAuth.hasProjectScope
      ? eq(sessions.id, parsedParams.data.id)
      : sessionOwnershipFilter(parsedParams.data.id, auth.accountId)).limit(1);
    if (!sessionRow) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    const force = parsedBody.data.force ?? false;
    const syncPlan = await resolveCharacterBindingSync(db, auth.accountId, sessionRow, force);
    if ("statusCode" in syncPlan) {
      return sendError(reply, syncPlan.statusCode, syncPlan.code, syncPlan.message);
    }

    const beforeRef = toSessionOperationRef(sessionRow);
    const syncedRow = db.transaction((tx) => {
      let row = sessionRow;
      const syncedAt = Date.now();

      if (syncPlan.changed) {
        const [updatedRow] = tx
          .update(sessions)
          .set({
            characterVersionId: syncPlan.latestVersionId,
            characterSnapshotJson: syncPlan.snapshotJson,
            updatedAt: syncedAt,
          })
          .where(eq(sessions.id, sessionRow.id))
          .returning()
          .all();
        row = requireRow(updatedRow, "Failed to sync session character binding");
      }

      appendSessionOperationLog(tx, request, {
        accountId: auth.accountId,
        action: "sync_session_character",
        sessionId: sessionRow.id,
        beforeRef,
        afterRef: toSessionOperationRef(row),
        metadata: {
          route: "POST /sessions/:id/character/sync",
          force,
          changed: syncPlan.changed,
          latest_character_version_id: syncPlan.latestVersionId,
        },
        createdAt: syncedAt,
      });

      return row;
    });

    return reply.send({ data: toSessionResponse(syncedRow) });
  });

  app.delete("/sessions/:id", {
    schema: {
      tags: ["sessions"],
      summary: "Delete session",
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const writeAuth = authorizeProjectWrite(reply, auth.accountId, parsedParams.data.id);
    if (!writeAuth.ok) {
      return;
    }
    const [sessionRow] = await db
      .select()
      .from(sessions)
      .where(writeAuth.hasProjectScope
        ? eq(sessions.id, parsedParams.data.id)
        : sessionOwnershipFilter(parsedParams.data.id, auth.accountId))
      .limit(1);

    if (!sessionRow) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    const activeRun = await floorRunService.getActiveRunSummary(sessionRow.id);
    if (activeRun) {
      return sendError(reply, 409, "active_run_in_progress", `Session '${sessionRow.id}' cannot be deleted while a run is in progress`);
    }
    const beforeRef = toSessionOperationRef(sessionRow);
    const deleted = db.transaction((tx) => {
      const deletedRows = deleteOwnedSessionAndBindings(
        tx,
        parsedParams.data.id,
        sessionRow.accountId,
        { sessionStateService },
      );
      if (deletedRows.length > 0) {
        appendSessionOperationLog(tx, request, {
          accountId: auth.accountId,
          action: "delete_session",
          sessionId: sessionRow.id,
          beforeRef,
          metadata: { route: "DELETE /sessions/:id" },
        });
      }
      return deletedRows;
    });

    if (deleted.length === 0) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });

  app.get("/sessions/:id/branches", {
    schema: {
      tags: ["sessions"],
      summary: "List branches in session",
      params: idParamsJsonSchema,
      querystring: {
        ...listQueryJsonSchema,
        properties: {
          ...listQueryJsonSchema.properties,
          sort_by: { type: "string", enum: ["branch_id", "floor_count", "latest_floor_no", "updated_at"] },
        },
      },
      response: {
        200: branchListResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedQuery = parseWithSchema(listBranchesQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    const sessionId = parsedParams.data.id;
    let [session] = await db.select({ id: sessions.id, accountId: sessions.accountId }).from(sessions).where(sessionOwnershipFilter(sessionId, auth.accountId));
    if (!session) {
      const readAccess = authorizeProjectRead(auth.accountId, sessionId);
      if (readAccess.hasAccess) {
        const fetched = await db
          .select({ id: sessions.id, accountId: sessions.accountId })
          .from(sessions)
          .where(eq(sessions.id, sessionId));
        session = fetched[0];
      }
    }

    if (!session) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

        const registeredBranches = branchRegistry.listBySession(session.accountId, sessionId);

    const floorRows = await db
      .select({
        id: floors.id,
        branchId: floors.branchId,
        floorNo: floors.floorNo,
        state: floors.state,
        updatedAt: floors.updatedAt
      })
      .from(floors)
      .where(and(eq(floors.sessionId, sessionId), isNull(floors.supersededAt)));

    const branchMap = new Map<string, {
      branch_id: string;
      floor_count: number;
      latest_floor_no: number | null;
      latest_floor_id: string | null;
      latest_state: string | null;
      updated_at: number;
    }>(registeredBranches.map((branch) => [
      branch.branchId,
      {
        branch_id: branch.branchId,
        floor_count: 0,
        latest_floor_no: null,
        latest_floor_id: null,
        latest_state: null,
        updated_at: branch.updatedAt,
      },
    ]));

    for (const row of floorRows) {
      const existing = branchMap.get(row.branchId);
      if (!existing) {
        branchMap.set(row.branchId, {
          branch_id: row.branchId,
          floor_count: 1,
          latest_floor_no: row.floorNo,
          latest_floor_id: row.id,
          latest_state: row.state,
          updated_at: row.updatedAt
        });
        continue;
      }

      if (existing.floor_count === 0) {
        existing.latest_floor_no = row.floorNo;
        existing.latest_floor_id = row.id;
        existing.latest_state = row.state;
      }
      existing.floor_count += 1;

      if (
        existing.latest_floor_no === null
        || row.floorNo > existing.latest_floor_no
        || (row.floorNo === existing.latest_floor_no && row.updatedAt > existing.updated_at)
      ) {
        existing.latest_floor_no = row.floorNo;
        existing.latest_floor_id = row.id;
        existing.latest_state = row.state;
        existing.updated_at = row.updatedAt;
      }
    }

    const allBranches = Array.from(branchMap.values());
    const direction = parsedQuery.data.sort_order === "asc" ? 1 : -1;
    allBranches.sort((a, b) => {
      switch (parsedQuery.data.sort_by) {
        case "branch_id":
          return a.branch_id.localeCompare(b.branch_id) * direction;
        case "floor_count":
          return (a.floor_count - b.floor_count) * direction;
        case "latest_floor_no":
          return ((a.latest_floor_no ?? -1) - (b.latest_floor_no ?? -1)) * direction;
        case "updated_at":
        default:
          return (a.updated_at - b.updated_at) * direction;
      }
    });

    const total = allBranches.length;
    const pagedBranches = allBranches.slice(
      parsedQuery.data.offset,
      parsedQuery.data.offset + parsedQuery.data.limit
    );

    return reply.send({
      data: pagedBranches,
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order
      })
    });
  });

  app.get("/sessions/:id/branches/diff", {
    schema: {
      tags: ["sessions"],
      summary: "Compare two branches",
      params: idParamsJsonSchema,
      querystring: {
        type: "object",
        required: ["target_branch_id"],
        properties: {
          base_branch_id: { type: "string", minLength: 1 },
          target_branch_id: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: branchDiffResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedQuery = parseWithSchema(branchDiffQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const sessionId = parsedParams.data.id;
    const baseBranchId = parsedQuery.data.base_branch_id;
    const targetBranchId = parsedQuery.data.target_branch_id;

    const auth = getRequestAuthContext(request);
    let [session] = await db.select({ id: sessions.id }).from(sessions).where(sessionOwnershipFilter(sessionId, auth.accountId));
    if (!session) {
      const readAccess = authorizeProjectRead(auth.accountId, sessionId);
      if (readAccess.hasAccess) {
        const fetched = await db
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.id, sessionId));
        session = fetched[0];
      }
    }
    if (!session) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    // 复用统一 lineage 服务：先把 session 下所有 live 节点与 supersede 索引
    // 一并加载。branch diff 需要覆盖 draft / generating / committed / failed 全部状态，
    // 因此这里传空 states 让 loadSessionNodes 不做状态过滤，保持与之前 diff 行为一致。
    // 不能只过滤两个 branch 自身的节点，否则两个 branch 的真实共同祖先
    // 如果落在第三个分支（例如都来自 main 的某次分叉），回溯链会被错误截断。
    // branch 校验以 FloorLineageService.findBranchTip() 的返回值为准。
    const [nodes, supersedeIndex] = await Promise.all([
      lineageService.loadSessionNodes(sessionId, { states: [] }),
      lineageService.loadSupersedeIndex(sessionId),
    ]);

    const diff = lineageService.computeBranchDiff(nodes, baseBranchId, targetBranchId, supersedeIndex);

    if (!diff.targetTip) {
      return sendError(reply, 404, "branch_not_found", `Branch '${targetBranchId}' not found in session`);
    }

    if (!diff.baseTip) {
      return sendError(reply, 404, "base_branch_not_found", `Base branch '${baseBranchId}' not found in session`);
    }

    // shared / base_only / target_only 都以 lineage service 给出的 ancestry 结果为准。
    // `shared_floor_nos` 保留旧字段形状，仅从 ancestry 节点取 `floorNo` 作为展示字段。
    const sharedFloorNos = diff.sharedFloors.map((node) => node.floorNo).sort((a, b) => a - b);
    const forkFloorNo = diff.forkFloor?.floorNo ?? null;

    return reply.send({
      data: {
        session_id: sessionId,
        base_branch_id: baseBranchId,
        target_branch_id: targetBranchId,
        fork_floor_no: forkFloorNo,
        shared_floor_nos: sharedFloorNos,
        base_only_floors: diff.baseOnlyFloors.map((node) => ({
          id: node.id,
          branchId: node.branchId,
          floorNo: node.floorNo,
          state: node.state,
        })),
        target_only_floors: diff.targetOnlyFloors.map((node) => ({
          id: node.id,
          branchId: node.branchId,
          floorNo: node.floorNo,
          state: node.state,
        })),
      },
    });
  });

  // ── Timeline ────────────────────────────────────────

  app.get("/sessions/:id/timeline", {
    schema: {
      tags: ["sessions"],
      summary: "Get session timeline",
      params: idParamsJsonSchema,
      querystring: {
        type: "object",
        properties: {
          branch_id: { type: "string", minLength: 1 },
          limit: { type: "integer", minimum: 1, maximum: 200 },
          offset: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
      response: {
        200: timelineResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedQuery = parseWithSchema(timelineQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const sessionId = parsedParams.data.id;
    const { branch_id: branchId, limit, offset } = parsedQuery.data;

    const auth = getRequestAuthContext(request);
    // 验证 session 存在
    let [session] = await db.select({ id: sessions.id }).from(sessions).where(sessionOwnershipFilter(sessionId, auth.accountId));
    if (!session) {
      const readAccess = authorizeProjectRead(auth.accountId, sessionId);
      if (readAccess.hasAccess) {
        const fetched = await db
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.id, sessionId));
        session = fetched[0];
      }
    }
    if (!session) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    // 查询 committed 楼层总数（用于分页 meta）
    const [totalRow] = await db
      .select({ total: count() })
      .from(floors)
      .where(
        and(
          eq(floors.sessionId, sessionId),
          eq(floors.branchId, branchId),
          eq(floors.state, "committed"),
          isNull(floors.supersededAt)
        )
      );
    const total = Number(totalRow?.total ?? 0);

    // 查询分页范围内的 committed 楼层
    const floorRows = await db
      .select()
      .from(floors)
      .where(
        and(
          eq(floors.sessionId, sessionId),
          eq(floors.branchId, branchId),
          eq(floors.state, "committed"),
          isNull(floors.supersededAt)
        )
      )
      .orderBy(asc(floors.floorNo))
      .limit(limit)
      .offset(offset);

    if (floorRows.length === 0) {
      return reply.send({
        data: {
          session_id: sessionId,
          branch_id: branchId,
          floors: [],
        },
        meta: buildListMeta({ total, limit, offset, sortBy: "floor_no", sortOrder: "asc" }),
      });
    }

    const floorIds = floorRows.map((f) => f.id);

    // 一次性查询所有活跃页 + 非隐藏消息（JOIN 避免 N+1）。
    // 排序键按优先级从粗到细：page_no → seq → created_at → message id。
    // 这样 input / output 默认都是 seq=0 时，排序仍然稳定。
    const rowData = await db
      .select({
        floorId: messagePages.floorId,
        pageId: messagePages.id,
        pageNo: messagePages.pageNo,
        pageKind: messagePages.pageKind,
        pageIsActive: messagePages.isActive,
        pageVersion: messagePages.version,
        msgId: messages.id,
        msgSeq: messages.seq,
        msgRole: messages.role,
        msgContent: messages.content,
        msgContentFormat: messages.contentFormat,
        msgCreatedAt: messages.createdAt,
      })
      .from(messagePages)
      .innerJoin(messages, eq(messages.pageId, messagePages.id))
      .where(
        and(
          sql`${messagePages.floorId} IN (${sql.join(floorIds.map((id) => sql`${id}`), sql`, `)})`,
          eq(messagePages.isActive, true),
          eq(messages.isHidden, false),
        ),
      )
      .orderBy(
        asc(messagePages.pageNo),
        asc(messages.seq),
        asc(messages.createdAt),
        asc(messages.id),
      );

    // 查询每个楼层的总页数（用于 swipe 指示器）
    const pageCountRows = await db
      .select({ floorId: messagePages.floorId, cnt: count() })
      .from(messagePages)
      .where(sql`${messagePages.floorId} IN (${sql.join(floorIds.map((id) => sql`${id}`), sql`, `)})`)
      .groupBy(messagePages.floorId);

    const pageCountMap = new Map(pageCountRows.map((r) => [r.floorId, Number(r.cnt)]));

    // 先按 (floorId, pageId) 聚合 page，再按 floorId 聚合 floor。
    // 这样每个 active page 自带 messages 列表，不会被压扁到 floor 级别。
    interface TimelinePageMessage {
      id: string;
      seq: number;
      role: string;
      content: string;
      content_format: string;
    }
    interface TimelinePage {
      id: string;
      page_no: number;
      page_kind: string;
      is_active: boolean;
      version: number;
      messages: TimelinePageMessage[];
    }

    const pagesByFloor = new Map<string, Map<string, TimelinePage>>();
    for (const row of rowData) {
      let pageMap = pagesByFloor.get(row.floorId);
      if (!pageMap) {
        pageMap = new Map();
        pagesByFloor.set(row.floorId, pageMap);
      }

      let page = pageMap.get(row.pageId);
      if (!page) {
        page = {
          id: row.pageId,
          page_no: row.pageNo,
          page_kind: row.pageKind,
          is_active: row.pageIsActive,
          version: row.pageVersion,
          messages: [],
        };
        pageMap.set(row.pageId, page);
      }

      page.messages.push({
        id: row.msgId,
        seq: row.msgSeq,
        role: row.msgRole,
        content: row.msgContent,
        content_format: row.msgContentFormat,
      });
    }

    const timelineFloors = floorRows.map((f) => {
      const pageMap = pagesByFloor.get(f.id);
      const pages: TimelinePage[] = pageMap ? Array.from(pageMap.values()) : [];
      // 按 page_no 升序稳定排序，避免不同 Map 迭代顺序影响输出。
      pages.sort((a, b) => a.page_no - b.page_no);

      const activePages = pages
        .filter((page) => page.is_active)
        .map((page) => ({
          id: page.id,
          page_no: page.page_no,
          page_kind: page.page_kind,
          version: page.version,
          messages: page.messages,
        }));

      // 兼容字段：仅当有且仅有一个 active page 时返回 active_page；
      // 否则返回 null，避免在多 active page 场景伪造单一真相。
      const active_page = activePages.length === 1 ? activePages[0]! : null;

      // 兼容字段：floor 级扁平 messages。当有多 active page 时，
      // 按照 active_pages 的顺序 concat 每个 page 的 messages。
      // 新调用方应改为消费 pages / active_pages。
      const flatMessages = activePages.flatMap((page) => page.messages);

      return {
        id: f.id,
        floor_no: f.floorNo,
        state: f.state,
        token_in: f.tokenIn,
        token_out: f.tokenOut,
        created_at: f.createdAt,
        pages,
        active_pages: activePages,
        active_page,
        messages: flatMessages,
        page_count: pageCountMap.get(f.id) ?? 0,
      };
    });

    return reply.send({
      data: {
        session_id: sessionId,
        branch_id: branchId,
        floors: timelineFloors,
      },
      meta: buildListMeta({ total, limit, offset, sortBy: "floor_no", sortOrder: "asc" }),
    });
  });

  // ── Batch Operations ────────────────────────────────

  /** PATCH /sessions/batch/status — 批量更新会话状态 */
  app.patch("/sessions/batch/status", {
    schema: {
      tags: ["sessions"],
      summary: "Batch update session status",
      operationId: "batchUpdateSessionStatus",
      body: batchStatusBodyJsonSchema(["active", "archived"]),
      response: {
        200: batchResultResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const bodyParsed = parseWithSchema(
      z.object({ ids: batchIdArraySchema, status: sessionStatusSchema }),
      request.body,
      reply
    );
    if (!bodyParsed.ok) return;

    const auth = getRequestAuthContext(request);
    const { ids, status } = bodyParsed.data;
    const results: { index: number; id: string; action: string }[] = [];
    let updated = 0;
    let notFound = 0;
    let accessDenied = 0;
    const batchProjectEvents: ProjectEventRecord[] = [];

    try {
      db.transaction((tx) => {
        ids.forEach((id, index) => {
          let useProjectScope = false;
          try {
            projectAccessService.requireProjectActionBySessionId(auth.accountId, id, "project.write");
            useProjectScope = true;
          } catch (error) {
            if (error instanceof ProjectAccessServiceError) {
              if (error.code === "project_access_denied" && error.denyReason === "role_forbidden") {
                results.push({ index, id, action: "project_access_denied" });
                accessDenied++;
                return;
              }
              // session_project_scope_missing / not_a_member → fall back to legacy ownership
              useProjectScope = false;
            } else { throw error; }
          }
          const beforeRow = tx
            .select()
            .from(sessions)
            .where(useProjectScope ? eq(sessions.id, id) : sessionOwnershipFilter(id, auth.accountId))
            .limit(1)
            .all()[0];

          if (!beforeRow) {
            results.push({ index, id, action: "not_found" });
            notFound++;
            return;
          }

          const updatedAt = Date.now();
          const [updatedRow] = tx
            .update(sessions)
            .set({ status, updatedAt })
            .where(eq(sessions.id, beforeRow.id))
            .returning()
            .all();

          if (updatedRow) {
            results.push({ index, id, action: "updated" });
            updated++;
            const operation = appendSessionOperationLog(tx, request, {
              accountId: auth.accountId,
              action: "batch_update_session_status",
              workspaceId: updatedRow.workspaceId,
              projectId: updatedRow.projectId,
              actorAccountId: auth.accountId,
              sessionId: updatedRow.id,
              beforeRef: toSessionOperationRef(beforeRow),
              afterRef: toSessionOperationRef(updatedRow),
              metadata: {
                route: "PATCH /sessions/batch/status",
                batch_index: index,
                batch_size: ids.length,
                status,
              },
              createdAt: updatedAt,
            });

            const archivedTransition =
              status === "archived" && beforeRow.status !== "archived";

            const updatedEvent = appendSessionProjectEvent({
              tx,
              row: updatedRow,
              type: "session.updated",
              actorAccountId: auth.accountId,
              operationLogId: operation.id,
              correlationId: operation.requestId,
              payload: {
                session_id: updatedRow.id,
                changed_fields: ["status"],
                status,
                ...(archivedTransition ? { status_changed_to: "archived" as const } : {}),
              },
              createdAt: updatedAt,
            });
            if (updatedEvent) {
              batchProjectEvents.push(updatedEvent);
            }

            if (archivedTransition) {
              const archivedEvent = appendSessionProjectEvent({
                tx,
                row: updatedRow,
                type: "session.archived",
                actorAccountId: auth.accountId,
                operationLogId: operation.id,
                correlationId: operation.requestId,
                payload: {
                  session_id: updatedRow.id,
                },
                createdAt: updatedAt,
              });
              if (archivedEvent) {
                batchProjectEvents.push(archivedEvent);
              }
            }
          } else {
            results.push({ index, id, action: "not_found" });
            notFound++;
          }
        });
      });
    } catch (error) {
      if (error instanceof ProjectEventServiceError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }

    publishProjectEvents(options.projectEventLiveHub, batchProjectEvents);
    return reply.send({
      data: { results, meta: ({ total: ids.length, updated, not_found: notFound, ...(accessDenied > 0 ? { access_denied: accessDenied } : {}), status }) },
    });
  });

  /** POST /sessions/batch/delete — 批量删除会话 */
  app.post("/sessions/batch/delete", {
    schema: {
      tags: ["sessions"],
      summary: "Batch delete sessions",
      operationId: "batchDeleteSessions",
      body: batchDeleteBodyJsonSchema,
      response: {
        200: batchResultResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const bodyParsed = parseWithSchema(z.object({ ids: batchIdArraySchema }), request.body, reply);
    if (!bodyParsed.ok) return;

    const auth = getRequestAuthContext(request);
    const { ids } = bodyParsed.data;
    const results: { index: number; id: string; action: string }[] = [];
    let deleted = 0;
    let conflicts = 0;
    let notFound = 0;
    let accessDenied = 0;

    const existingRows = await db
      .select()
      .from(sessions)
      .where(inArray(sessions.id, ids));
    const existingSessionIds = new Set(existingRows.map((row) => row.id));
    const existingRowsById = new Map(existingRows.map((row) => [row.id, row]));
    const activeRunSessionIds = new Set(
      (await Promise.all(
        existingRows.map(async (row) => {
          const activeRun = await floorRunService.getActiveRunSummary(row.id);
          return activeRun ? row.id : null;
        })
      )).filter((id): id is string => id !== null)
    );

    db.transaction((tx) => {
      ids.forEach((id, index) => {
        if (!existingSessionIds.has(id)) {
          results.push({ index, id, action: "not_found" });
          notFound++;
          return;
        }

        const row = existingRowsById.get(id);
        if (row) {
          try {
            projectAccessService.requireProjectActionBySessionId(auth.accountId, id, "project.write");
          } catch (error) {
            if (error instanceof ProjectAccessServiceError) {
              if (error.code === "project_access_denied" && error.denyReason === "role_forbidden") {
                results.push({ index, id, action: "project_access_denied" });
                accessDenied++;
                return;
              }
              // session_project_scope_missing → legacy session, fall through to ownership filter
            } else {
              throw error;
            }
          }
        }

        if (activeRunSessionIds.has(id)) {
          results.push({ index, id, action: "conflict" });
          conflicts++;
          return;
        }

        const rows = deleteOwnedSessionAndBindings(tx, id, row?.accountId ?? auth.accountId, { sessionStateService });

        if (rows.length > 0) {
          results.push({ index, id, action: "deleted" });
          deleted++;
          const beforeRow = existingRowsById.get(id);
          if (beforeRow) {
            appendSessionOperationLog(tx, request, {
              accountId: auth.accountId,
              action: "batch_delete_session",
              sessionId: id,
              beforeRef: toSessionOperationRef(beforeRow),
              metadata: {
                route: "POST /sessions/batch/delete",
                batch_index: index,
                batch_size: ids.length,
              },
            });
          }
        } else {
          results.push({ index, id, action: "not_found" });
          notFound++;
        }
      });
    });

    return reply.send({
      data: { results, meta: ({ total: ids.length, deleted, not_found: notFound, conflicts, ...(accessDenied > 0 ? { access_denied: accessDenied } : {}) }) },
    });
  });
}

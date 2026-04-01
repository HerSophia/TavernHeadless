import { and, asc, count, desc, eq, inArray, like, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { SimpleTokenCounter } from "@tavern/core";
import { z } from "zod";

import type { DatabaseConnection, DbExecutor } from "../db/client";
import { errorResponseJsonSchema, idParamsJsonSchema, batchIdArraySchema, batchDeleteBodyJsonSchema, batchStatusBodyJsonSchema, batchResultResponseJsonSchema } from "./schemas/common.js";
import { accountUsers, floors, llmProfileBindings, messagePages, messages, sessions } from "../db/schema";
import { ensureOptionalObjectBody, parseJsonField, parseWithSchema, requireRow, sendError, stringifyJsonField } from "../lib/http";
import { buildListMeta, listQuerySchemaBase, toOrderBy } from "../lib/pagination";
import { getRequestAuthContext } from "../plugins/auth";
import { getLatestOwnedActiveCharacterVersion, getOwnedActiveCharacterVersionById } from "../services/resource-ownership";
import { FloorRunService } from "../services/floor-run-service";

const sessionStatusSchema = z.enum(["active", "archived"]);
const promptModeSchema = z.enum(["compat_strict", "compat_plus", "native"]);
const characterSyncPolicySchema = z.enum(["pin", "manual", "force"]);
const characterSnapshotSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  personality: z.string().optional(),
  scenario: z.string().optional(),
  exampleDialogue: z.string().optional(),
  greeting: z.string().optional()
});

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
  title: z.string().trim().min(1).max(200).optional(),
  status: sessionStatusSchema.optional(),
  character_id: z.string().trim().min(1).optional(),
  character_version_id: z.string().trim().min(1).optional(),
  character_sync_policy: characterSyncPolicySchema.optional(),
  character_snapshot: characterSnapshotSchema.optional(),
  user_id: z.string().trim().min(1).optional(),
  user_snapshot: userSnapshotSchema.optional(),
  preset_id: z.string().trim().min(1).optional(),
  regex_profile_id: z.string().trim().min(1).optional(),
  worldbook_profile_id: z.string().trim().min(1).optional(),
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
  preset_id: "preset_story",
  regex_profile_id: "regex_safe",
  worldbook_profile_id: "wb_world",
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
    status: { type: "string", enum: ["active", "archived"] },
    character_id: { type: "string", minLength: 1 },
    character_version_id: { type: "string", minLength: 1 },
    character_sync_policy: { type: "string", enum: ["pin", "manual", "force"] },
    character_snapshot: {
      type: "object",
    },
    user_id: { type: "string", minLength: 1 },
    user_snapshot: { type: "object", additionalProperties: true },
    preset_id: { type: "string", minLength: 1 },
    regex_profile_id: { type: "string", minLength: 1 },
    worldbook_profile_id: { type: "string", minLength: 1 },
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
    latest_floor_no: { type: "integer", minimum: 0 },
    latest_floor_id: { type: "string" },
    latest_state: { type: "string" },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const timelineFloorJsonSchema = {
  type: "object",
  required: ["id", "floor_no", "state", "token_in", "token_out", "created_at", "active_page", "page_count"],
  properties: {
    id: { type: "string" },
    floor_no: { type: "integer", minimum: 0 },
    state: { type: "string" },
    token_in: { type: "integer", minimum: 0 },
    token_out: { type: "integer", minimum: 0 },
    created_at: { type: "integer", minimum: 0 },
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

  const raw = parseJsonField(snapshotJson) as Record<string, unknown> | null;
  if (!raw) {
    return null;
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const greeting = typeof raw.greeting === "string" ? raw.greeting.trim() : "";

  if (!name) {
    return null;
  }

  return {
    name,
    has_greeting: greeting.length > 0
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
    model_provider: row.modelProvider,
    model_name: row.modelName,
    model_params: parseJsonField(row.modelParamsJson),
    prompt_mode: row.promptMode,
    metadata: parseJsonField(row.metadataJson),
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
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
  character_snapshot?: z.infer<typeof characterSnapshotSchema>;
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

async function resolveCharacterBinding(
  db: DatabaseConnection["db"],
  accountId: string,
  input: ResolveCharacterBindingInput
): Promise<ResolvedCharacterBinding | BindingResolutionError> {
  const syncPolicy = input.character_sync_policy ?? "pin";

  if (!input.character_id && !input.character_version_id && !input.character_snapshot) {
    return {
      characterId: null,
      characterVersionId: null,
      characterSnapshotJson: null,
      characterSyncPolicy: syncPolicy
    };
  }

  if (input.character_snapshot && !input.character_id && !input.character_version_id) {
    return {
      characterId: null,
      characterVersionId: null,
      characterSnapshotJson: stringifyJsonField(input.character_snapshot),
      characterSyncPolicy: syncPolicy
    };
  }

  const versionRow = input.character_version_id
    ? await getOwnedActiveCharacterVersionById(db, accountId, input.character_version_id)
    : await getLatestOwnedActiveCharacterVersion(db, accountId, input.character_id ?? "");

  if (!versionRow) {
    return { statusCode: 404, code: "character_not_found", message: "Character or version not found" };
  }

  if (input.character_id && input.character_id !== versionRow.characterId) {
    return { statusCode: 400, code: "character_version_mismatch", message: "character_id does not match character_version_id" };
  }

  const snapshot = input.character_snapshot ?? parseJsonField(versionRow.dataJson);
  const parsedSnapshot = characterSnapshotSchema.safeParse(snapshot);
  if (!parsedSnapshot.success) {
    return { statusCode: 400, code: "invalid_character_snapshot", message: "Character snapshot is invalid" };
  }

  return {
    characterId: versionRow.characterId,
    characterVersionId: versionRow.id,
    characterSnapshotJson: stringifyJsonField(parsedSnapshot.data),
    characterSyncPolicy: syncPolicy
  };
}

async function resolveUserBinding(
  db: DatabaseConnection["db"],
  accountId: string,
  input: ResolveUserBindingInput
): Promise<ResolvedUserBinding | BindingResolutionError> {
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

  const [userRow] = await db
    .select({
      id: accountUsers.id,
      snapshotJson: accountUsers.snapshotJson,
      status: accountUsers.status
    })
    .from(accountUsers)
    .where(and(eq(accountUsers.id, input.user_id ?? ""), eq(accountUsers.accountId, accountId)))
    .limit(1);

  if (!userRow || userRow.status === "deleted") {
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

type SyncCharacterBindingResult = {
  row: typeof sessions.$inferSelect;
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

function deleteOwnedSessionAndBindings(tx: DbExecutor, sessionId: string, accountId: string) {
  const deleted = tx.delete(sessions).where(sessionOwnershipFilter(sessionId, accountId)).returning({ id: sessions.id }).all();
  if (deleted.length > 0) {
    deleteSessionOwnedProfileBindings(tx, sessionId, accountId);
  }
  return deleted;
}

async function syncCharacterBinding(
  db: DatabaseConnection["db"],
  accountId: string,
  sessionRow: typeof sessions.$inferSelect,
  force: boolean
): Promise<SyncCharacterBindingResult | BindingResolutionError> {
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

  const latestVersion = await getLatestOwnedActiveCharacterVersion(db, accountId, sessionRow.characterId);

  if (!latestVersion) {
    return { statusCode: 404, code: "character_not_found", message: "Character version not found" };
  }

  const parsedSnapshot = characterSnapshotSchema.safeParse(parseJsonField(latestVersion.dataJson));
  if (!parsedSnapshot.success) {
    return { statusCode: 500, code: "invalid_character_snapshot", message: "Stored character snapshot is invalid" };
  }

  const snapshotJson = stringifyJsonField(parsedSnapshot.data);
  if (sessionRow.characterVersionId === latestVersion.id && sessionRow.characterSnapshotJson === snapshotJson) {
    return { row: sessionRow };
  }

  const [updatedRow] = await db
    .update(sessions)
    .set({ characterVersionId: latestVersion.id, characterSnapshotJson: snapshotJson, updatedAt: Date.now() })
    .where(eq(sessions.id, sessionRow.id))
    .returning();

  return { row: requireRow(updatedRow, "Failed to sync session character binding") };
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  const { db } = connection;
  const floorRunService = new FloorRunService(db);

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

    const characterBinding = await resolveCharacterBinding(db, auth.accountId, parsedBody.data);
    const userBinding = await resolveUserBinding(db, auth.accountId, parsedBody.data);
    if ("statusCode" in characterBinding) {
      return sendError(reply, characterBinding.statusCode, characterBinding.code, characterBinding.message);
    }
    if ("statusCode" in userBinding) {
      return sendError(reply, userBinding.statusCode, userBinding.code, userBinding.message);
    }

    const createdRows = await db
      .insert(sessions)
      .values({
        id: nanoid(),
        title: parsedBody.data.title ?? null,
        userId: userBinding.userId,
        userSnapshotJson: userBinding.userSnapshotJson,
        characterId: characterBinding.characterId,
        accountId: auth.accountId,
        characterVersionId: characterBinding.characterVersionId,
        characterSnapshotJson: characterBinding.characterSnapshotJson,
        characterSyncPolicy: characterBinding.characterSyncPolicy,
        status: parsedBody.data.status ?? "active",
        presetId: parsedBody.data.preset_id ?? null,
        regexProfileId: parsedBody.data.regex_profile_id ?? null,
        worldbookProfileId: parsedBody.data.worldbook_profile_id ?? null,
        modelProvider: parsedBody.data.model_provider ?? null,
        modelName: parsedBody.data.model_name ?? null,
        modelParamsJson: stringifyJsonField(parsedBody.data.model_params),
        promptMode: parsedBody.data.prompt_mode ?? null,
        metadataJson: stringifyJsonField(parsedBody.data.metadata ?? {}),
        createdAt: now,
        updatedAt: now
      })
      .returning();

    const created = requireRow(createdRows[0], "Failed to create session");

    const snapshot = parseJsonField(characterBinding.characterSnapshotJson) as Record<string, unknown> | null;
    const greeting = typeof snapshot?.greeting === "string" ? snapshot.greeting.trim() : "";

    if (greeting) {
      const tokenCounter = new SimpleTokenCounter();
      const floorId = nanoid();
      const pageId = nanoid();
      const greetingTokens = tokenCounter.count(greeting);

      await db.insert(floors).values({
        id: floorId,
        sessionId: created.id,
        floorNo: 0,
        branchId: "main",
        parentFloorId: null,
        metadataJson: stringifyJsonField(buildFloorMetadataForUserBinding(created.userId, created.userSnapshotJson, now)),
        state: "committed",
        tokenIn: 0,
        tokenOut: greetingTokens,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(messagePages).values({
        id: pageId,
        floorId,
        pageNo: 0,
        pageKind: "output",
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(messages).values({
        id: nanoid(),
        pageId,
        seq: 0,
        role: "assistant",
        content: greeting,
        contentFormat: "text",
        tokenCount: greetingTokens,
        isHidden: false,
        source: "greeting",
        createdAt: now,
      });
    }

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
    const [row] = await db.select().from(sessions).where(sessionOwnershipFilter(parsedParams.data.id, auth.accountId));

    if (!row) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    return reply.send({ data: toSessionResponse(row) });
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
    const [row] = await db.select({ id: sessions.id }).from(sessions).where(sessionOwnershipFilter(parsedParams.data.id, auth.accountId));

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

    const parsedBody = parseWithSchema(updateSessionSchema, request.body, reply);

    if (!parsedBody.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const [existingSession] = await db
      .select()
      .from(sessions)
      .where(sessionOwnershipFilter(parsedParams.data.id, auth.accountId))
      .limit(1);

    if (!existingSession) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    const updates: Partial<typeof sessions.$inferInsert> = {
      updatedAt: Date.now()
    };

    let nextUserId = existingSession.userId;
    let nextUserSnapshotJson = existingSession.userSnapshotJson;

    const existingCharacterSnapshot = (parseJsonField(existingSession.characterSnapshotJson) as z.infer<typeof characterSnapshotSchema> | null) ?? undefined;

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

      const characterBinding = await resolveCharacterBinding(db, auth.accountId, bindingInput);
      if ("statusCode" in characterBinding) {
        return sendError(reply, characterBinding.statusCode, characterBinding.code, characterBinding.message);
      }

      updates.characterId = characterBinding.characterId;
      updates.characterVersionId = characterBinding.characterVersionId;
      updates.characterSnapshotJson = characterBinding.characterSnapshotJson;
      updates.characterSyncPolicy = characterBinding.characterSyncPolicy;
    }

    if (hasUserBindingUpdate) {
      const userBinding = await resolveUserBinding(db, auth.accountId, {
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

    if (parsedBody.data.preset_id !== undefined) {
      updates.presetId = parsedBody.data.preset_id;
    }

    if (parsedBody.data.regex_profile_id !== undefined) {
      updates.regexProfileId = parsedBody.data.regex_profile_id;
    }

    if (parsedBody.data.worldbook_profile_id !== undefined) {
      updates.worldbookProfileId = parsedBody.data.worldbook_profile_id;
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

    const updated = db.transaction((tx) => {
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

      return updatedRow ?? null;
    });

    if (!updated) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

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
    const [sessionRow] = await db.select().from(sessions).where(sessionOwnershipFilter(parsedParams.data.id, auth.accountId)).limit(1);
    if (!sessionRow) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    const synced = await syncCharacterBinding(db, auth.accountId, sessionRow, parsedBody.data.force ?? false);
    if ("statusCode" in synced) {
      return sendError(reply, synced.statusCode, synced.code, synced.message);
    }

    return reply.send({ data: toSessionResponse(synced.row) });
  });

  app.delete("/sessions/:id", {
    schema: {
      tags: ["sessions"],
      summary: "Delete session",
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionParamsSchema, request.params, reply);

    if (!parsedParams.ok) {
      return;
    }

    const auth = getRequestAuthContext(request);
    const deleted = db.transaction((tx) => (
      deleteOwnedSessionAndBindings(tx, parsedParams.data.id, auth.accountId)
    ));

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
    const [session] = await db.select({ id: sessions.id }).from(sessions).where(sessionOwnershipFilter(sessionId, auth.accountId));
    if (!session) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    const floorRows = await db
      .select({
        id: floors.id,
        branchId: floors.branchId,
        floorNo: floors.floorNo,
        state: floors.state,
        updatedAt: floors.updatedAt
      })
      .from(floors)
      .where(eq(floors.sessionId, sessionId));

    const branchMap = new Map<string, {
      branch_id: string;
      floor_count: number;
      latest_floor_no: number;
      latest_floor_id: string;
      latest_state: string;
      updated_at: number;
    }>();

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

      existing.floor_count += 1;
      if (
        row.floorNo > existing.latest_floor_no ||
        (row.floorNo === existing.latest_floor_no && row.updatedAt > existing.updated_at)
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
          return (a.latest_floor_no - b.latest_floor_no) * direction;
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
    const [session] = await db.select({ id: sessions.id }).from(sessions).where(sessionOwnershipFilter(sessionId, auth.accountId));
    if (!session) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    const diffRows = await db
      .select({ id: floors.id, branchId: floors.branchId, floorNo: floors.floorNo, state: floors.state })
      .from(floors)
      .where(and(eq(floors.sessionId, sessionId), inArray(floors.branchId, [baseBranchId, targetBranchId])))
      .orderBy(asc(floors.floorNo));

    const baseFloors = diffRows.filter((row) => row.branchId === baseBranchId);
    const targetFloors = diffRows.filter((row) => row.branchId === targetBranchId);

    if (targetFloors.length === 0) {
      return sendError(reply, 404, "branch_not_found", `Branch '${targetBranchId}' not found in session`);
    }

    if (baseFloors.length === 0) {
      return sendError(reply, 404, "base_branch_not_found", `Base branch '${baseBranchId}' not found in session`);
    }

    const baseByFloorNo = new Map(baseFloors.map((row) => [row.floorNo, row]));
    const targetByFloorNo = new Map(targetFloors.map((row) => [row.floorNo, row]));

    const sharedFloorNos = Array.from(baseByFloorNo.keys())
      .filter((floorNo) => targetByFloorNo.has(floorNo))
      .sort((a, b) => a - b);

    const forkFloorNo = sharedFloorNos.length === 0 ? null : sharedFloorNos[sharedFloorNos.length - 1];

    return reply.send({
      data: {
        session_id: sessionId,
        base_branch_id: baseBranchId,
        target_branch_id: targetBranchId,
        fork_floor_no: forkFloorNo,
        shared_floor_nos: sharedFloorNos,
        base_only_floors: baseFloors.filter((row) => !targetByFloorNo.has(row.floorNo)),
        target_only_floors: targetFloors.filter((row) => !baseByFloorNo.has(row.floorNo))
      }
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
    const [session] = await db.select({ id: sessions.id }).from(sessions).where(sessionOwnershipFilter(sessionId, auth.accountId));
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
          eq(floors.state, "committed")
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
          eq(floors.state, "committed")
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

    // 一次性查询所有活跃页 + 非隐藏消息（JOIN 避免 N+1）
    const rowData = await db
      .select({
        floorId: messagePages.floorId,
        pageId: messagePages.id,
        pageNo: messagePages.pageNo,
        pageKind: messagePages.pageKind,
        pageVersion: messagePages.version,
        msgId: messages.id,
        msgSeq: messages.seq,
        msgRole: messages.role,
        msgContent: messages.content,
        msgContentFormat: messages.contentFormat,
      })
      .from(messagePages)
      .innerJoin(messages, eq(messages.pageId, messagePages.id))
      .where(
        and(
          sql`${messagePages.floorId} IN (${sql.join(floorIds.map((id) => sql`${id}`), sql`, `)})`,
          eq(messagePages.isActive, true),
          eq(messages.isHidden, false)
        )
      )
      .orderBy(asc(messages.seq));

    // 查询每个楼层的总页数（用于 swipe 指示器）
    const pageCountRows = await db
      .select({ floorId: messagePages.floorId, cnt: count() })
      .from(messagePages)
      .where(sql`${messagePages.floorId} IN (${sql.join(floorIds.map((id) => sql`${id}`), sql`, `)})`)
      .groupBy(messagePages.floorId);

    const pageCountMap = new Map(pageCountRows.map((r) => [r.floorId, Number(r.cnt)]));

    // 按 floorId 聚合
    const msgByFloor = new Map<string, typeof rowData>();
    for (const row of rowData) {
      const arr = msgByFloor.get(row.floorId) ?? [];
      arr.push(row);
      msgByFloor.set(row.floorId, arr);
    }

    const timelineFloors = floorRows.map((f) => {
      const rows = msgByFloor.get(f.id) ?? [];
      const firstRow = rows[0];
      return {
        id: f.id,
        floor_no: f.floorNo,
        state: f.state,
        token_in: f.tokenIn,
        token_out: f.tokenOut,
        created_at: f.createdAt,
        active_page: firstRow
          ? {
              id: firstRow.pageId,
              page_no: firstRow.pageNo,
              page_kind: firstRow.pageKind,
              version: firstRow.pageVersion,
              messages: rows.map((r) => ({
                id: r.msgId,
                seq: r.msgSeq,
                role: r.msgRole,
                content: r.msgContent,
                content_format: r.msgContentFormat,
              })),
            }
          : null,
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

    db.transaction((tx) => {
      ids.forEach((id, index) => {
        const rows = tx
          .update(sessions)
          .set({ status, updatedAt: Date.now() })
          .where(sessionOwnershipFilter(id, auth.accountId))
          .returning({ id: sessions.id })
          .all();

        if (rows.length > 0) {
          results.push({ index, id, action: "updated" });
          updated++;
        } else {
          results.push({ index, id, action: "not_found" });
          notFound++;
        }
      });
    });

    return reply.send({
      data: { results, meta: { total: ids.length, updated, not_found: notFound, status } },
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
    let notFound = 0;

    db.transaction((tx) => {
      ids.forEach((id, index) => {
        const rows = deleteOwnedSessionAndBindings(tx, id, auth.accountId);

        if (rows.length > 0) {
          results.push({ index, id, action: "deleted" });
          deleted++;
        } else {
          results.push({ index, id, action: "not_found" });
          notFound++;
        }
      });
    });

    return reply.send({
      data: { results, meta: { total: ids.length, deleted, not_found: notFound } },
    });
  });
}

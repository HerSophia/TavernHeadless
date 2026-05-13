/**
 * Tool Management API Routes
 *
 * Tool execution truth-source layout:
 *   - `tool_execution_record` is the **primary tool execution journal**.
 *     所有新增的执行语义（`timeout` / `uncertain` / `blocked`、
 *     lifecycle / commit outcome、deferred delivery、runtime_job 绑定等）
 *     只进入 execution journal。
 *   - `tool_call_record` 仅作为 legacy-compatible projection 保留，
 *     仅暴露 `success | error | denied | queued | running` 的兼容态。
 *
 * 13 endpoints:
 *   GET    /tools/builtin                       — List built-in tools
 *   GET    /tools/definitions                    — List custom tool definitions
 *   GET    /tools/definitions/:id                — Get single definition
 *   POST   /tools/definitions                    — Create definition
 *   PATCH  /tools/definitions/:id                — Update definition
 *   DELETE /tools/definitions/:id                — Delete definition
 *   PATCH  /tools/definitions/:id/toggle         — Toggle enable/disable
 *   GET    /tool-executions                      — Query primary tool execution journal (source of truth)
 *   GET    /floors/:id/tool-executions           — Query primary tool execution journal for a floor
 *   GET    /tools/call-records                   — Query legacy-compatible tool call records (projection only)
 *   GET    /sessions/:id/tool-permissions        — Get session base tool permissions
 *   PUT    /sessions/:id/tool-permissions        — Replace session base tool permissions
 *   PATCH  /sessions/:id/tool-permissions        — Partial update session base tool permissions
 */

import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { DatabaseConnection } from '../../db/client.js';
import { sessions } from '../../db/schema.js';
import { parseJsonField, parseWithSchema, sendError, stringifyJsonField } from '../../lib/http.js';
import { buildListMeta, listQuerySchemaBase } from '../../lib/pagination.js';
import { getRequestAuthContext } from '../../plugins/auth.js';
import { ToolService, ToolServiceError } from '../../services/tooling/tool-service.js';
import {
  mergeSessionBaseToolPermissionsPatch,
  normalizeSessionBaseToolPermissionsRecord,
} from '../../services/tooling/shared/permission-overlay.js';
import { errorResponseJsonSchema, idParamsJsonSchema } from '../schemas/common.js';
import { WorkspaceScopeServiceError } from '../../services/workspace-scope-service.js';

// ══════════════════════════════════════════════════════════
// Zod Schemas
// ══════════════════════════════════════════════════════════

const sideEffectLevelSchema = z.enum(['none', 'sandbox', 'irreversible']);
const toolSourceSchema = z.enum(['preset', 'character', 'custom']);
const handlerTypeSchema = z.enum(['script']);
const instanceSlotSchema = z.enum(['narrator', 'director', 'verifier', 'memory']);
const callRecordStatusSchema = z.enum(['success', 'error', 'denied', 'queued', 'running']);
const toolExecutionStatusSchema = z.enum(['running', 'queued', 'success', 'error', 'denied', 'timeout', 'uncertain', 'blocked']);
const toolExecutionLifecycleStateSchema = z.enum(['opened', 'finished']);
const toolExecutionCommitOutcomeSchema = z.enum(['pending', 'committed', 'discarded', 'replay_blocked', 'uncertain']);
const toolExecutionProviderTypeSchema = z.enum(['builtin', 'preset', 'mcp', 'unknown']);

const definitionParamsSchema = z.object({ id: z.string().min(1) });

const listDefinitionsQuerySchema = listQuerySchemaBase.extend({
  source: toolSourceSchema.optional(),
  source_id: z.string().min(1).optional(),
  enabled: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : v),
    z.boolean().optional(),
  ),
  sort_by: z.enum(['updated_at', 'name']).default('updated_at'),
});

const createDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  parameters: z.record(z.unknown()).default({ type: 'object', properties: {} }),
  side_effect_level: sideEffectLevelSchema.default('none'),
  allowed_slots: z.array(z.string()).default([]),
  source: toolSourceSchema.default('custom'),
  source_id: z.string().min(1).nullish(),
  enabled: z.boolean().optional(),
  handler_type: handlerTypeSchema.default('script'),
  handler: z.record(z.unknown()).default({}),
});

const updateDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  parameters: z.record(z.unknown()).optional(),
  side_effect_level: sideEffectLevelSchema.optional(),
  allowed_slots: z.array(z.string()).optional(),
  source: toolSourceSchema.optional(),
  source_id: z.string().min(1).nullish(),
  handler_type: handlerTypeSchema.optional(),
  handler: z.record(z.unknown()).optional(),
}).refine((v) => Object.keys(v).length > 0, 'At least one field is required');

const toggleDefinitionSchema = z.object({
  enabled: z.boolean(),
});

const callRecordsQuerySchema = listQuerySchemaBase.extend({
  page_id: z.string().min(1).optional(),
  floor_id: z.string().min(1).optional(),
  caller_slot: z.string().min(1).optional(),
  status: callRecordStatusSchema.optional(),
  sort_by: z.enum(['seq', 'created_at']).default('seq'),
}).refine(
  (v) => v.page_id !== undefined || v.floor_id !== undefined,
  'Either page_id or floor_id must be provided',
);

const toolExecutionsQuerySchemaBase = listQuerySchemaBase.extend({
  run_id: z.string().min(1).optional(),
  caller_slot: instanceSlotSchema.optional(),
  tool_name: z.string().min(1).optional(),
  status: toolExecutionStatusSchema.optional(),
  lifecycle_state: toolExecutionLifecycleStateSchema.optional(),
  commit_outcome: toolExecutionCommitOutcomeSchema.optional(),
  provider_type: toolExecutionProviderTypeSchema.optional(),
  sort_by: z.enum(['created_at', 'started_at', 'finished_at']).default('started_at'),
});

const toolExecutionsQuerySchema = toolExecutionsQuerySchemaBase.extend({
  session_id: z.string().min(1).optional(),
  floor_id: z.string().min(1).optional(),
}).refine(
  (value) => value.session_id !== undefined || value.floor_id !== undefined || value.run_id !== undefined,
  'Either session_id, floor_id, or run_id must be provided',
);

const floorToolExecutionsQuerySchema = toolExecutionsQuerySchemaBase;

const sessionIdParamsSchema = z.object({ id: z.string().min(1) });

const toolPermissionsSchema = z.object({
  enabled: z.boolean().optional(),
  max_calls_per_turn: z.number().int().min(1).max(1000).optional(),
  max_steps_per_generation: z.number().int().min(1).max(50).optional(),
  allow_irreversible: z.boolean().optional(),
  slot_allow_list: z.record(z.array(z.string())).optional(),
  slot_deny_list: z.record(z.array(z.string())).optional(),
});

const toolPermissionsPutSchema = toolPermissionsSchema;
const toolPermissionsPatchSchema = toolPermissionsSchema;

// ══════════════════════════════════════════════════════════
// JSON Schemas (OpenAPI)
// ══════════════════════════════════════════════════════════

const listMetaJsonSchema = {
  type: 'object',
  required: ['total', 'limit', 'offset', 'has_more', 'sort_by', 'sort_order'],
  properties: {
    total: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1 },
    offset: { type: 'integer', minimum: 0 },
    has_more: { type: 'boolean' },
    sort_by: { type: 'string' },
    sort_order: { type: 'string', enum: ['asc', 'desc'] },
  },
  additionalProperties: false,
} as const;

const builtinToolJsonSchema = {
  type: 'object',
  required: ['name', 'description', 'parameters', 'side_effect_level', 'allowed_slots', 'source'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    parameters: { type: 'object' },
    side_effect_level: { type: 'string', enum: ['none', 'sandbox', 'irreversible'] },
    allowed_slots: { type: 'array', items: { type: 'string' } },
    source: { type: 'string' },
  },
  additionalProperties: false,
} as const;

const builtinListResponseJsonSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: { type: 'array', items: builtinToolJsonSchema },
  },
  additionalProperties: false,
} as const;

const definitionJsonSchema = {
  type: 'object',
  required: ['id', 'name', 'description', 'parameters', 'side_effect_level', 'allowed_slots', 'source', 'source_id', 'enabled', 'handler_type', 'handler', 'created_at', 'updated_at'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    parameters: { type: 'object' },
    side_effect_level: { type: 'string', enum: ['none', 'sandbox', 'irreversible'] },
    allowed_slots: {},
    source: { type: 'string', enum: ['preset', 'character', 'custom'] },
    source_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    enabled: { type: 'boolean' },
    handler_type: { type: 'string', enum: ['script'] },
    handler: {},
    created_at: { type: 'integer', minimum: 0 },
    updated_at: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
} as const;

const definitionResponseJsonSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: definitionJsonSchema,
  },
  additionalProperties: false,
} as const;

const definitionListResponseJsonSchema = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { type: 'array', items: definitionJsonSchema },
    meta: listMetaJsonSchema,
  },
  additionalProperties: false,
} as const;

const deleteResponseJsonSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      required: ['id', 'deleted'],
      properties: {
        id: { type: 'string' },
        deleted: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const callRecordJsonSchema = {
  type: 'object',
  required: ['id', 'page_id', 'seq', 'caller_slot', 'tool_name', 'args', 'result', 'status', 'duration_ms', 'created_at'],
  properties: {
    id: { type: 'string' },
    page_id: { type: 'string' },
    seq: { type: 'integer', minimum: 0 },
    caller_slot: { type: 'string' },
    tool_name: { type: 'string' },
    args: {},
    result: {},
    status: { type: 'string', enum: ['success', 'error', 'denied', 'queued', 'running'] },
    duration_ms: { type: 'integer', minimum: 0 },
    created_at: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
} as const;

const toolExecutionJsonSchema = {
  type: 'object',
  required: [
    'id',
    'run_id',
    'floor_id',
    'page_id',
    'caller_slot',
    'provider_id',
    'provider_type',
    'tool_name',
    'args',
    'result',
    'status',
    'lifecycle_state',
    'commit_outcome',
    'side_effect_level',
    'error_message',
    'duration_ms',
    'started_at',
    'finished_at',
    'delivery_mode',
    'attempt_no',
    'runtime_job_id',
    'replay_parent_execution_id',
    'created_at',
  ],
  properties: {
    id: { type: 'string' },
    run_id: { type: 'string' },
    floor_id: { type: 'string' },
    page_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    caller_slot: { type: 'string', enum: ['narrator', 'director', 'verifier', 'memory'] },
    provider_id: { type: 'string' },
    provider_type: { type: 'string', enum: ['builtin', 'preset', 'mcp', 'unknown'] },
    tool_name: { type: 'string' },
    args: {},
    result: {},
    status: { type: 'string', enum: ['running', 'queued', 'success', 'error', 'denied', 'timeout', 'uncertain', 'blocked'] },
    lifecycle_state: { type: 'string', enum: ['opened', 'finished'] },
    commit_outcome: { type: 'string', enum: ['pending', 'committed', 'discarded', 'replay_blocked', 'uncertain'] },
    side_effect_level: { anyOf: [{ type: 'string', enum: ['none', 'sandbox', 'irreversible'] }, { type: 'null' }] },
    error_message: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    duration_ms: { type: 'integer', minimum: 0 },
    delivery_mode: { type: 'string', enum: ['inline', 'async_job'] },
    started_at: { type: 'integer', minimum: 0 },
    finished_at: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    attempt_no: { type: 'integer', minimum: 1 },
    runtime_job_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    replay_parent_execution_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    created_at: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
} as const;

const toolExecutionsQueryJsonSchema = {
  type: 'object',
  properties: {
    session_id: { type: 'string', minLength: 1 },
    floor_id: { type: 'string', minLength: 1 },
    run_id: { type: 'string', minLength: 1 },
    caller_slot: { type: 'string', enum: ['narrator', 'director', 'verifier', 'memory'] },
    tool_name: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['running', 'queued', 'success', 'error', 'denied', 'timeout', 'uncertain', 'blocked'] },
    lifecycle_state: { type: 'string', enum: ['opened', 'finished'] },
    commit_outcome: { type: 'string', enum: ['pending', 'committed', 'discarded', 'replay_blocked', 'uncertain'] },
    provider_type: { type: 'string', enum: ['builtin', 'preset', 'mcp', 'unknown'] },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0 },
    sort_order: { type: 'string', enum: ['asc', 'desc'] },
    sort_by: { type: 'string', enum: ['created_at', 'started_at', 'finished_at'] },
  },
  additionalProperties: false,
} as const;

const floorToolExecutionsQueryJsonSchema = {
  type: 'object',
  properties: {
    run_id: { type: 'string', minLength: 1 },
    caller_slot: { type: 'string', enum: ['narrator', 'director', 'verifier', 'memory'] },
    tool_name: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['running', 'queued', 'success', 'error', 'denied', 'timeout', 'uncertain', 'blocked'] },
    lifecycle_state: { type: 'string', enum: ['opened', 'finished'] },
    commit_outcome: { type: 'string', enum: ['pending', 'committed', 'discarded', 'replay_blocked', 'uncertain'] },
    provider_type: { type: 'string', enum: ['builtin', 'preset', 'mcp', 'unknown'] },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0 },
    sort_order: { type: 'string', enum: ['asc', 'desc'] },
    sort_by: { type: 'string', enum: ['created_at', 'started_at', 'finished_at'] },
  },
  additionalProperties: false,
} as const;

const toolExecutionListResponseJsonSchema = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { type: 'array', items: toolExecutionJsonSchema },
    meta: listMetaJsonSchema,
  },
  additionalProperties: false,
} as const;

const callRecordListResponseJsonSchema = {
  type: 'object',
  required: ['data', 'meta'],
  properties: {
    data: { type: 'array', items: callRecordJsonSchema },
    meta: listMetaJsonSchema,
  },
  additionalProperties: false,
} as const;

const toolPermissionsJsonSchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    max_calls_per_turn: { type: 'integer', minimum: 1 },
    max_steps_per_generation: { type: 'integer', minimum: 1 },
    allow_irreversible: { type: 'boolean' },
    slot_allow_list: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
    slot_deny_list: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
  },
  additionalProperties: false,
} as const;

const toolPermissionsResponseJsonSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: toolPermissionsJsonSchema,
  },
  additionalProperties: false,
} as const;

const callRecordsQueryJsonSchema = {
  type: 'object',
  properties: {
    page_id: { type: 'string', minLength: 1 },
    floor_id: { type: 'string', minLength: 1 },
    caller_slot: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['success', 'error', 'denied'] },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0 },
    sort_order: { type: 'string', enum: ['asc', 'desc'] },
    sort_by: { type: 'string', enum: ['seq', 'created_at'] },
  },
  additionalProperties: false,
} as const;

const listDefinitionsQueryJsonSchema = {
  type: 'object',
  properties: {
    source: { type: 'string', enum: ['preset', 'character', 'custom'] },
    source_id: { type: 'string', minLength: 1 },
    enabled: { type: 'string', enum: ['true', 'false'] },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0 },
    sort_order: { type: 'string', enum: ['asc', 'desc'] },
    sort_by: { type: 'string', enum: ['updated_at', 'name'] },
  },
  additionalProperties: false,
} as const;

const createDefinitionBodyJsonSchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 2000 },
    parameters: { type: 'object' },
    side_effect_level: { type: 'string', enum: ['none', 'sandbox', 'irreversible'] },
    allowed_slots: { type: 'array', items: { type: 'string' } },
    source: { type: 'string', enum: ['preset', 'character', 'custom'] },
    source_id: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
    enabled: { type: 'boolean' },
    handler_type: { type: 'string', enum: ['script'] },
    handler: { type: 'object' },
  },
  additionalProperties: false,
} as const;

const updateDefinitionBodyJsonSchema = {
  ...createDefinitionBodyJsonSchema,
  required: [] as string[],
  minProperties: 1,
} as const;

const toggleBodyJsonSchema = {
  type: 'object',
  required: ['enabled'],
  properties: {
    enabled: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

const toolPermissionsBodyJsonSchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    max_calls_per_turn: { type: 'integer', minimum: 1, maximum: 1000 },
    max_steps_per_generation: { type: 'integer', minimum: 1, maximum: 50 },
    allow_irreversible: { type: 'boolean' },
    slot_allow_list: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
    slot_deny_list: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
  },
  additionalProperties: false,
} as const;

// ══════════════════════════════════════════════════════════
// Route Registration
// ══════════════════════════════════════════════════════════

const SCRIPT_HANDLER_DISABLED_MESSAGE =
  'Script handler definitions are disabled by server policy. Set ENABLE_UNSAFE_SCRIPT_HANDLER=true only in a trusted environment.';

export interface RegisterToolRoutesOptions {
  enableUnsafeScriptHandler?: boolean;
}

export async function registerToolRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: RegisterToolRoutesOptions = {},
): Promise<void> {
  const { db } = connection;
  const toolService = new ToolService(db);

  function rejectDisabledScriptHandler(reply: Parameters<typeof sendError>[0]) {
    return sendError(reply, 403, 'tool_script_handler_disabled', SCRIPT_HANDLER_DISABLED_MESSAGE, {
      env: 'ENABLE_UNSAFE_SCRIPT_HANDLER',
      trusted_only: true,
    });
  }

  function isUnsafeScriptHandlerEnabled(): boolean {
    return options.enableUnsafeScriptHandler === true;
  }

  // ── GET /tools/builtin ────────────────────────────────

  app.get('/tools/builtin', {
    schema: {
      tags: ['tools'],
      summary: 'List built-in tools',
      operationId: 'listBuiltinTools',
      response: {
        200: builtinListResponseJsonSchema,
      },
    },
  }, async (_request, reply) => {
    const tools = await toolService.listBuiltinTools();
    return reply.send({ data: tools });
  });

  // ── GET /tools/definitions ──────────────────────────

  app.get('/tools/definitions', {
    schema: {
      tags: ['tools'],
      summary: 'List tool definitions',
      operationId: 'listToolDefinitions',
      querystring: listDefinitionsQueryJsonSchema,
      response: {
        200: definitionListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(listDefinitionsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    const { definitions, total } = await toolService.listDefinitions({
      accountId: auth.accountId,
      source: parsedQuery.data.source,
      sourceId: parsedQuery.data.source_id,
      enabled: parsedQuery.data.enabled,
      limit: parsedQuery.data.limit,
      offset: parsedQuery.data.offset,
    });

    return reply.send({
      data: definitions,
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order,
      }),
    });
  });

  // ── GET /tools/definitions/:id ──────────────────────

  app.get('/tools/definitions/:id', {
    schema: {
      tags: ['tools'],
      summary: 'Get tool definition',
      operationId: 'getToolDefinition',
      params: idParamsJsonSchema,
      response: {
        200: definitionResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(definitionParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    const def = await toolService.getDefinition(parsedParams.data.id, auth.accountId);
    if (!def) {
      return sendError(reply, 404, 'not_found', 'Tool definition not found');
    }

    return reply.send({ data: def });
  });

  // ── POST /tools/definitions ─────────────────────────

  app.post('/tools/definitions', {
    schema: {
      tags: ['tools'],
      summary: 'Create tool definition',
      operationId: 'createToolDefinition',
      body: createDefinitionBodyJsonSchema,
      response: {
        201: definitionResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedBody = parseWithSchema(createDefinitionSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    if (!isUnsafeScriptHandlerEnabled()) {
      return rejectDisabledScriptHandler(reply);
    }

    try {
      const def = await toolService.createDefinition(parsedBody.data, auth.accountId);

      return reply.code(201).send({ data: def });
    } catch (error) {
      return sendToolServiceError(reply, error);
    }
  });

  // ── PATCH /tools/definitions/:id ────────────────────

  app.patch('/tools/definitions/:id', {
    schema: {
      tags: ['tools'],
      summary: 'Update tool definition',
      operationId: 'updateToolDefinition',
      params: idParamsJsonSchema,
      body: updateDefinitionBodyJsonSchema,
      response: {
        200: definitionResponseJsonSchema,
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(definitionParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(updateDefinitionSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    if (!isUnsafeScriptHandlerEnabled()) {
      return rejectDisabledScriptHandler(reply);
    }

    try {
      const def = await toolService.updateDefinition(parsedParams.data.id, auth.accountId, parsedBody.data);
      if (!def) {
        return sendError(reply, 404, 'not_found', 'Tool definition not found');
      }

      return reply.send({ data: def });
    } catch (error) {
      return sendToolServiceError(reply, error);
    }
  });

  // ── DELETE /tools/definitions/:id ───────────────────

  app.delete('/tools/definitions/:id', {
    schema: {
      tags: ['tools'],
      summary: 'Delete tool definition',
      operationId: 'deleteToolDefinition',
      params: idParamsJsonSchema,
      response: {
        200: deleteResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(definitionParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    const deleted = await toolService.deleteDefinition(parsedParams.data.id, auth.accountId);
    if (!deleted) {
      return sendError(reply, 404, 'not_found', 'Tool definition not found');
    }

    return reply.send({ data: { id: parsedParams.data.id, deleted: true } });
  });

  // ── PATCH /tools/definitions/:id/toggle ─────────────

  app.patch('/tools/definitions/:id/toggle', {
    schema: {
      tags: ['tools'],
      summary: 'Toggle tool definition enabled/disabled',
      operationId: 'toggleToolDefinition',
      params: idParamsJsonSchema,
      body: toggleBodyJsonSchema,
      response: {
        200: definitionResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        403: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(definitionParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(toggleDefinitionSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    if (parsedBody.data.enabled === true && !isUnsafeScriptHandlerEnabled()) {
      return rejectDisabledScriptHandler(reply);
    }

    const def = await toolService.toggleDefinition(parsedParams.data.id, auth.accountId, parsedBody.data.enabled);
    if (!def) {
      return sendError(reply, 404, 'not_found', 'Tool definition not found');
    }

    return reply.send({ data: def });
  });

  // ── GET /tool-executions ────────────────────────────

  app.get('/tool-executions', {
    schema: {
      tags: ['tools'],
      summary: 'Query primary tool execution journal (source of truth)',
      operationId: 'queryToolExecutionRecords',
      querystring: toolExecutionsQueryJsonSchema,
      response: {
        200: toolExecutionListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(toolExecutionsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    const { records, total } = await toolService.queryExecutionRecords({
      accountId: auth.accountId,
      sessionId: parsedQuery.data.session_id,
      floorId: parsedQuery.data.floor_id,
      runId: parsedQuery.data.run_id,
      callerSlot: parsedQuery.data.caller_slot,
      toolName: parsedQuery.data.tool_name,
      status: parsedQuery.data.status,
      lifecycleState: parsedQuery.data.lifecycle_state,
      commitOutcome: parsedQuery.data.commit_outcome,
      providerType: parsedQuery.data.provider_type,
      limit: parsedQuery.data.limit,
      offset: parsedQuery.data.offset,
      sortBy: parsedQuery.data.sort_by,
      sortOrder: parsedQuery.data.sort_order,
    });

    return reply.send({
      data: records,
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order,
      }),
    });
  });

  // ── GET /floors/:id/tool-executions ─────────────────

  app.get('/floors/:id/tool-executions', {
    schema: {
      tags: ['tools'],
      summary: 'Query primary tool execution journal for a floor',
      operationId: 'queryFloorToolExecutionRecords',
      params: idParamsJsonSchema,
      querystring: floorToolExecutionsQueryJsonSchema,
      response: {
        200: toolExecutionListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedQuery = parseWithSchema(floorToolExecutionsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    const { records, total } = await toolService.queryExecutionRecords({
      accountId: auth.accountId,
      floorId: parsedParams.data.id,
      runId: parsedQuery.data.run_id,
      callerSlot: parsedQuery.data.caller_slot,
      toolName: parsedQuery.data.tool_name,
      status: parsedQuery.data.status,
      lifecycleState: parsedQuery.data.lifecycle_state,
      commitOutcome: parsedQuery.data.commit_outcome,
      providerType: parsedQuery.data.provider_type,
      limit: parsedQuery.data.limit,
      offset: parsedQuery.data.offset,
      sortBy: parsedQuery.data.sort_by,
      sortOrder: parsedQuery.data.sort_order,
    });

    return reply.send({
      data: records,
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order,
      }),
    });
  });

  // ── GET /tools/call-records ─────────────────────────

  app.get('/tools/call-records', {
    schema: {
      tags: ['tools'],
      summary: 'Query tool call records (legacy-compatible)',
      operationId: 'queryToolCallRecords',
      querystring: callRecordsQueryJsonSchema,
      response: {
        200: callRecordListResponseJsonSchema,
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedQuery = parseWithSchema(callRecordsQuerySchema, request.query, reply);
    if (!parsedQuery.ok) return;

    const auth = getRequestAuthContext(request);
    const { records, total } = await toolService.queryCallRecords({
      accountId: auth.accountId,
      pageId: parsedQuery.data.page_id,
      floorId: parsedQuery.data.floor_id,
      callerSlot: parsedQuery.data.caller_slot,
      status: parsedQuery.data.status as any,
      limit: parsedQuery.data.limit,
      offset: parsedQuery.data.offset,
      sortBy: parsedQuery.data.sort_by,
      sortOrder: parsedQuery.data.sort_order,
    });

    return reply.send({
      data: records,
      meta: buildListMeta({
        total,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
        sortBy: parsedQuery.data.sort_by,
        sortOrder: parsedQuery.data.sort_order,
      }),
    });
  });

  // ── GET /sessions/:id/tool-permissions ──────────────

  app.get('/sessions/:id/tool-permissions', {
    schema: {
      tags: ['tools'],
      summary: 'Get session base tool permissions',
      description: [
        'Returns the session-base ToolPermissions snapshot stored in metadata_json.tool_permissions.',
        'This route does not expose future run/node/step overlays.',
      ].join(' '),
      operationId: 'getSessionToolPermissions',
      params: idParamsJsonSchema,
      response: {
        200: toolPermissionsResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const auth = getRequestAuthContext(request);
    const [session] = await db
      .select({ id: sessions.id, metadataJson: sessions.metadataJson })
      .from(sessions)
      .where(and(
        eq(sessions.id, parsedParams.data.id),
        eq(sessions.accountId, auth.accountId),
      ))
      .limit(1);

    if (!session) {
      return sendError(reply, 404, 'not_found', 'Session not found');
    }

    const metadata = parseJsonField(session.metadataJson) as Record<string, unknown> | null;
    const permissions = normalizeSessionBaseToolPermissionsRecord(metadata?.tool_permissions) ?? {};

    return reply.send({ data: permissions });
  });

  // ── PUT /sessions/:id/tool-permissions ──────────────

  app.put('/sessions/:id/tool-permissions', {
    schema: {
      tags: ['tools'],
      summary: 'Replace session base tool permissions',
      description: [
        'Replaces the session-base ToolPermissions object stored in metadata_json.tool_permissions.',
        'This route does not define future run/node/step overlays.',
      ].join(' '),
      operationId: 'replaceSessionToolPermissions',
      params: idParamsJsonSchema,
      body: toolPermissionsBodyJsonSchema,
      response: {
        200: toolPermissionsResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(toolPermissionsPutSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    const [session] = await db
      .select({ id: sessions.id, metadataJson: sessions.metadataJson })
      .from(sessions)
      .where(and(
        eq(sessions.id, parsedParams.data.id),
        eq(sessions.accountId, auth.accountId),
      ))
      .limit(1);

    if (!session) {
      return sendError(reply, 404, 'not_found', 'Session not found');
    }

    const metadata = (parseJsonField(session.metadataJson) as Record<string, unknown>) ?? {};
    const sessionBasePermissions = normalizeSessionBaseToolPermissionsRecord(parsedBody.data) ?? {};
    metadata.tool_permissions = sessionBasePermissions;

    await db
      .update(sessions)
      .set({
        metadataJson: stringifyJsonField(metadata),
        updatedAt: Date.now(),
      })
      .where(eq(sessions.id, session.id));

    return reply.send({ data: sessionBasePermissions });
  });

  // ── PATCH /sessions/:id/tool-permissions ─────────────

  app.patch('/sessions/:id/tool-permissions', {
    schema: {
      tags: ['tools'],
      summary: 'Partial update session base tool permissions',
      description: [
        'Applies a partial update to the session-base ToolPermissions object in metadata_json.tool_permissions.',
        'slot_allow_list and slot_deny_list merge by slot key.',
        'This route does not define future run/node/step overlays.',
      ].join(' '),
      operationId: 'patchSessionToolPermissions',
      params: idParamsJsonSchema,
      body: toolPermissionsBodyJsonSchema,
      response: {
        200: toolPermissionsResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(toolPermissionsPatchSchema, request.body, reply);
    if (!parsedBody.ok) return;

    const auth = getRequestAuthContext(request);
    const [session] = await db
      .select({ id: sessions.id, metadataJson: sessions.metadataJson })
      .from(sessions)
      .where(and(
        eq(sessions.id, parsedParams.data.id),
        eq(sessions.accountId, auth.accountId),
      ))
      .limit(1);

    if (!session) {
      return sendError(reply, 404, 'not_found', 'Session not found');
    }

    const metadata = (parseJsonField(session.metadataJson) as Record<string, unknown>) ?? {};
    const existing = normalizeSessionBaseToolPermissionsRecord(metadata.tool_permissions) ?? {};
    const merged = mergeSessionBaseToolPermissionsPatch(
      existing,
      normalizeSessionBaseToolPermissionsRecord(parsedBody.data) ?? {},
    );

    metadata.tool_permissions = merged;

    await db
      .update(sessions)
      .set({
        metadataJson: stringifyJsonField(metadata),
        updatedAt: Date.now(),
      })
      .where(eq(sessions.id, session.id));

    return reply.send({ data: merged });
  });
}

function sendToolServiceError(reply: Parameters<typeof sendError>[0], error: unknown) {
  if (error instanceof WorkspaceScopeServiceError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }

  if (error instanceof ToolServiceError && error.code === 'tool_definition_conflict') {
    return sendError(reply, 409, error.code, error.message);
  }

  throw error;
}

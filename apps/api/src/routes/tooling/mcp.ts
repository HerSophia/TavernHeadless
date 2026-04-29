/**
 * MCP Server Management Routes
 *
 * 配置 CRUD（6 个端点）：
 *   GET    /mcp/servers               — 列表所有 MCP 服务器配置
 *   GET    /mcp/servers/:id           — 获取单个配置
 *   POST   /mcp/servers               — 创建配置
 *   PATCH  /mcp/servers/:id           — 更新配置
 *   DELETE /mcp/servers/:id           — 删除配置
 *   PATCH  /mcp/servers/:id/toggle    — 启用/禁用
 *
 * 运行时操作（6 个端点）：
 *   GET    /mcp/servers/:id/status    — 查看单个服务器连接状态
 *   GET    /mcp/statuses              — 查看所有连接状态
 *   POST   /mcp/servers/:id/connect   — 连接/重连
 *   POST   /mcp/servers/:id/disconnect— 断开连接
 *   GET    /mcp/servers/:id/tools     — 查看服务器工具列表
 *   POST   /mcp/servers/:id/test      — 测试连接
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { DatabaseConnection } from '../../db/client.js';
import { parseWithSchema, sendError } from '../../lib/http.js';
import { buildListMeta, listQuerySchemaBase } from '../../lib/pagination.js';
import { getRequestAuthContext } from '../../plugins/auth.js';
import { McpConnection } from '../../services/tooling/mcp/mcp-connection.js';
import type { McpConnectionManager } from '../../services/tooling/mcp/mcp-connection-manager.js';
import { McpService, McpServiceError } from '../../services/tooling/mcp/mcp-service.js';
import type { McpConnectionStatus } from '../../services/tooling/mcp/types.js';
import { idParamsJsonSchema, errorResponseJsonSchema } from '../schemas/common.js';

// ══════════════════════════════════════════════════
// Zod Schemas
// ══════════════════════════════════════════════════

const transportSchema = z.enum(['stdio', 'http']);
const sideEffectLevelSchema = z.enum(['none', 'sandbox', 'irreversible']);
const instanceSlotSchema = z.enum(['narrator', 'director', 'verifier', 'memory']);
const replaySafetySchema = z.enum(['safe', 'confirm_on_replay', 'never_auto_replay', 'uncertain']);

const parameterSchemaItemSchema = z.object({
  type: z.string().min(1),
  description: z.string().optional(),
});

const parameterSchemaPropertySchema = z.object({
  type: z.string().min(1),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
  default: z.unknown().optional(),
  items: parameterSchemaItemSchema.optional(),
});

const parameterSchemaSchema = z.object({
  type: z.literal('object'),
  properties: z.record(parameterSchemaPropertySchema).default({}),
  required: z.array(z.string()).optional(),
});

const metadataOverrideSchema = z.object({
  tool_name: z.string().trim().min(1).max(200),
  side_effect_level: sideEffectLevelSchema.optional(),
  allowed_slots: z.array(instanceSlotSchema).min(1).optional(),
  parameter_schema: parameterSchemaSchema.optional(),
  replay_safety: replaySafetySchema.optional(),
}).refine((value) => (
  value.side_effect_level !== undefined
  || value.allowed_slots !== undefined
  || value.parameter_schema !== undefined
  || value.replay_safety !== undefined
), 'At least one metadata override field is required');

const stdioConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

const httpConfigSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

const createServerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  transport: transportSchema,
  stdio: stdioConfigSchema.optional(),
  http: httpConfigSchema.optional(),
  tool_prefix: z.string().max(50).optional(),
  enabled: z.boolean().optional(),
  connect_timeout_ms: z.number().int().min(1000).max(300000).optional(),
  call_timeout_ms: z.number().int().min(1000).max(600000).optional(),
  tool_refresh_interval_ms: z.number().int().min(0).max(3600000).optional(),
  default_side_effect_level: sideEffectLevelSchema.optional(),
  metadata_overrides: z.array(metadataOverrideSchema).optional(),
});

const updateServerSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  transport: transportSchema.optional(),
  stdio: stdioConfigSchema.optional(),
  http: httpConfigSchema.optional(),
  tool_prefix: z.string().max(50).nullish(),
  connect_timeout_ms: z.number().int().min(1000).max(300000).optional(),
  call_timeout_ms: z.number().int().min(1000).max(600000).optional(),
  tool_refresh_interval_ms: z.number().int().min(0).max(3600000).optional(),
  default_side_effect_level: sideEffectLevelSchema.optional(),
  metadata_overrides: z.array(metadataOverrideSchema).optional(),
}).refine((v) => Object.keys(v).length > 0, 'At least one field is required');

const toggleServerSchema = z.object({
  enabled: z.boolean(),
});

const listServersQuerySchema = listQuerySchemaBase.extend({
  enabled: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : v),
    z.boolean().optional(),
  ),
  sort_by: z.enum(['created_at', 'name']).default('created_at'),
});

// ══════════════════════════════════════════════════
// JSON Schema (OpenAPI)
// ══════════════════════════════════════════════════

const maskedStringRecordSchema = {
  type: 'object',
  additionalProperties: { type: 'string' },
};

const maskedStdioConfigResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['command'],
  properties: {
    command: { type: 'string' },
    args: { type: 'array', items: { type: 'string' } },
    cwd: { type: 'string' },
    env_masked: maskedStringRecordSchema,
  },
};

const maskedHttpConfigResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string' },
    headers_masked: maskedStringRecordSchema,
  },
};

const toolMetadataOverrideJsonSchema = {
  type: 'object',
  required: ['tool_name'],
  properties: {
    tool_name: { type: 'string', minLength: 1, maxLength: 200 },
    side_effect_level: { type: 'string', enum: ['none', 'sandbox', 'irreversible'] },
    allowed_slots: { type: 'array', items: { type: 'string', enum: ['narrator', 'director', 'verifier', 'memory'] }, minItems: 1 },
    parameter_schema: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { const: 'object' },
        properties: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              description: { type: 'string' },
              enum: { type: 'array', items: { type: 'string' } },
              default: {},
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  description: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
            required: ['type'],
            additionalProperties: false,
          },
        },
        required: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    replay_safety: { type: 'string', enum: ['safe', 'confirm_on_replay', 'never_auto_replay', 'uncertain'] },
  },
  additionalProperties: false,
} as const;


const mcpLiveStatusSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['attached', 'reason', 'state', 'tool_count', 'connected_at', 'tools_refreshed_at', 'error', 'reconnect_required', 'last_timeout_at'],
  properties: {
    attached: { type: 'boolean' },
    reason: { anyOf: [{ type: 'string', enum: ['disabled', 'manager_unavailable', 'not_attached'] }, { type: 'null' }] },
    state: { type: 'string', enum: ['disconnected', 'connecting', 'connected', 'reconnect_required', 'error'] },
    tool_count: { type: 'integer' },
    connected_at: { type: 'integer', nullable: true },
    tools_refreshed_at: { type: 'integer', nullable: true },
    error: { type: 'string', nullable: true },
    reconnect_required: { type: 'boolean' },
    last_timeout_at: { type: 'integer', nullable: true },
  },
};

const mcpServerResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'transport',
    'tool_prefix',
    'enabled',
    'connect_timeout_ms',
    'call_timeout_ms',
    'tool_refresh_interval_ms',
    'default_side_effect_level',
    'metadata_overrides',
    'created_at',
    'updated_at',
    'live_status',
  ],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    transport: { type: 'string', enum: ['stdio', 'http'] },
    stdio: maskedStdioConfigResponseSchema,
    http: maskedHttpConfigResponseSchema,
    tool_prefix: { type: 'string', nullable: true },
    enabled: { type: 'boolean' },
    connect_timeout_ms: { type: 'integer' },
    call_timeout_ms: { type: 'integer' },
    tool_refresh_interval_ms: { type: 'integer' },
    default_side_effect_level: { type: 'string', enum: ['none', 'sandbox', 'irreversible'] },
    metadata_overrides: { type: 'array', items: toolMetadataOverrideJsonSchema },
    created_at: { type: 'integer' },
    updated_at: { type: 'integer' },
    live_status: mcpLiveStatusSchema,
  },
};

const mcpStatusResponseSchema = {
  type: 'object',
  properties: {
    server_id: { type: 'string' },
    server_name: { type: 'string' },
    transport: { type: 'string' },
    state: { type: 'string', enum: ['disconnected', 'connecting', 'connected', 'reconnect_required', 'error'] },
    tool_count: { type: 'integer' },
    connected_at: { type: 'integer', nullable: true },
    tools_refreshed_at: { type: 'integer', nullable: true },
    error: { type: 'string', nullable: true },
    reconnect_required: { type: 'boolean' },
    last_timeout_at: { type: 'integer', nullable: true },
    attached: { type: 'boolean' },
    reason: { anyOf: [{ type: 'string', enum: ['disabled', 'manager_unavailable', 'not_attached'] }, { type: 'null' }] },
  },
};

// ── Config route JSON schemas for OpenAPI ──

const listServersQueryJsonSchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    sort_by: { type: 'string', enum: ['created_at', 'name'] },
    sort_order: { type: 'string', enum: ['asc', 'desc'] },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
} as const;

const stdioConfigBodySchema = {
  type: 'object',
  required: ['command'],
  properties: {
    command: { type: 'string', minLength: 1 },
    args: { type: 'array', items: { type: 'string' } },
    env: { type: 'object', additionalProperties: { type: 'string' } },
    cwd: { type: 'string' },
  },
  additionalProperties: false,
};

const httpConfigBodySchema = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri' },
    headers: { type: 'object', additionalProperties: { type: 'string' } },
  },
  additionalProperties: false,
};

const createServerBodyJsonSchema = {
  type: 'object',
  required: ['name', 'transport'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    transport: { type: 'string', enum: ['stdio', 'http'] },
    metadata_overrides: { type: 'array', items: toolMetadataOverrideJsonSchema },

    stdio: stdioConfigBodySchema,
    http: httpConfigBodySchema,
    tool_prefix: { type: 'string', maxLength: 50 },
    enabled: { type: 'boolean' },
    connect_timeout_ms: { type: 'integer', minimum: 1000, maximum: 300000 },
    call_timeout_ms: { type: 'integer', minimum: 1000, maximum: 600000 },
    tool_refresh_interval_ms: { type: 'integer', minimum: 0, maximum: 3600000 },
    default_side_effect_level: { type: 'string', enum: ['none', 'sandbox', 'irreversible'] },
  },
  additionalProperties: false,
} as const;

const updateServerBodyJsonSchema = {
  type: 'object',
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    transport: { type: 'string', enum: ['stdio', 'http'] },
    stdio: stdioConfigBodySchema,
    http: httpConfigBodySchema,
    tool_prefix: { anyOf: [{ type: 'string', maxLength: 50 }, { type: 'null' }] },
    connect_timeout_ms: { type: 'integer', minimum: 1000, maximum: 300000 },
    call_timeout_ms: { type: 'integer', minimum: 1000, maximum: 600000 },
    tool_refresh_interval_ms: { type: 'integer', minimum: 0, maximum: 3600000 },
    default_side_effect_level: { type: 'string', enum: ['none', 'sandbox', 'irreversible'] },
    metadata_overrides: { type: 'array', items: toolMetadataOverrideJsonSchema },

  },
  additionalProperties: false,
} as const;

const toggleServerBodyJsonSchema = {
  type: 'object',
  required: ['enabled'],
  properties: {
    enabled: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

// ══════════════════════════════════════════════════
// 配置 CRUD 路由
// ══════════════════════════════════════════════════

type McpDetachedReason = 'disabled' | 'manager_unavailable' | 'not_attached';

function formatStatus(status: McpConnectionStatus) {
  return {
    server_id: status.serverId,
    server_name: status.serverName,
    transport: status.transport,
    state: status.state,
    tool_count: status.toolCount,
    connected_at: status.connectedAt ?? null,
    tools_refreshed_at: status.toolsRefreshedAt ?? null,
    error: status.error ?? null,
    reconnect_required: status.reconnectRequired ?? status.state === 'reconnect_required',
    last_timeout_at: status.lastTimeoutAt ?? null,
    attached: true,
    reason: null,
  };
}

function buildDetachedLiveStatus(reason: McpDetachedReason) {
  switch (reason) {
    case 'disabled':
      return {
        attached: false,
        reason,
        state: 'disconnected' as const,
        tool_count: 0,
        connected_at: null,
        tools_refreshed_at: null,
        error: null,
        reconnect_required: false,
        last_timeout_at: null,
      };
    case 'manager_unavailable':
      return {
        attached: false,
        reason,
        state: 'disconnected' as const,
        tool_count: 0,
        connected_at: null,
        tools_refreshed_at: null,
        error: 'MCP runtime manager is unavailable because ENABLE_MCP is disabled.',
        reconnect_required: false,
        last_timeout_at: null,
      };
    case 'not_attached':
      return {
        attached: false,
        reason,
        state: 'disconnected' as const,
        tool_count: 0,
        connected_at: null,
        tools_refreshed_at: null,
        error: 'Configured MCP server is enabled in storage but not attached to the runtime manager.',
        reconnect_required: false,
        last_timeout_at: null,
      };
  }
}

type McpConfigResponseSummary = {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  enabled: boolean;
};

function buildLiveStatus(
  config: McpConfigResponseSummary,
  mcpManager?: McpConnectionManager,
) {
  if (!config.enabled) {
    return buildDetachedLiveStatus('disabled');
  }

  if (!mcpManager) {
    return buildDetachedLiveStatus('manager_unavailable');
  }

  const status = mcpManager.getStatus(config.id);
  if (!status) {
    return buildDetachedLiveStatus('not_attached');
  }

  const formatted = formatStatus(status);
  return {
    attached: formatted.attached,
    reason: formatted.reason,
    state: formatted.state,
    tool_count: formatted.tool_count,
    connected_at: formatted.connected_at,
    tools_refreshed_at: formatted.tools_refreshed_at,
    error: formatted.error,
    reconnect_required: formatted.reconnect_required,
    last_timeout_at: formatted.last_timeout_at,
  };
}

function buildStatusForConfig(config: McpConfigResponseSummary, mcpManager?: McpConnectionManager) {
  const liveStatus = buildLiveStatus(config, mcpManager);
  return {
    server_id: config.id,
    server_name: config.name,
    transport: config.transport,
    state: liveStatus.state,
    tool_count: liveStatus.tool_count,
    connected_at: liveStatus.connected_at,
    tools_refreshed_at: liveStatus.tools_refreshed_at,
    error: liveStatus.error,
    reconnect_required: liveStatus.reconnect_required,
    last_timeout_at: liveStatus.last_timeout_at,
    attached: liveStatus.attached,
    reason: liveStatus.reason,
  };
}

function attachLiveStatus<T extends McpConfigResponseSummary>(config: T, mcpManager?: McpConnectionManager) {
  return {
    ...config,
    live_status: buildLiveStatus(config, mcpManager),
  };
}

export interface RegisterMcpConfigRoutesOptions {
  mcpManager?: McpConnectionManager;
}

export async function registerMcpConfigRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: RegisterMcpConfigRoutesOptions = {},
): Promise<void> {
  const service = new McpService(connection.db);
  const mcpManager = options.mcpManager;

  async function syncRuntimeConfig(configId: string, accountId: string, previousStatus: McpConnectionStatus | null = null): Promise<void> {
    if (!mcpManager) {
      return;
    }

    const config = await service.getConfigEntity(configId, accountId);
    if (!config || !config.enabled) {
      await mcpManager.removeServer(configId);
      return;
    }

    try {
      await mcpManager.addServer(config);

      if (
        config.transport === 'http'
        && previousStatus
        && previousStatus.state !== 'disconnected'
        && previousStatus.state !== 'error'
      ) {
        await mcpManager.getConnection(config.id);
      }
    } catch (error) {
      app.log.warn({
        serverId: config.id,
        serverName: config.name,
        error,
      }, 'Failed to synchronize MCP config into runtime manager');

      if (!mcpManager.getStatus(config.id)) {
        mcpManager.registerUnavailableServer(
          { id: config.id, name: config.name, transport: config.transport },
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  // GET /mcp/servers
  app.get('/mcp/servers', {
    schema: {
      tags: ['mcp'],
      summary: 'List MCP server configs',
      operationId: 'listMcpServers',
      querystring: listServersQueryJsonSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array', items: mcpServerResponseSchema },
            meta: { type: 'object', additionalProperties: true },
          },
        },
        400: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(listServersQuerySchema, request.query, reply);
    if (!parsed.ok) return;
    const auth = getRequestAuthContext(request);

    const result = await service.listConfigs(auth.accountId, {
      enabled: parsed.data.enabled,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    return {
      data: result.configs.map((config) => attachLiveStatus(config, mcpManager)),
      meta: buildListMeta({
        total: result.total,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        sortBy: parsed.data.sort_by,
        sortOrder: parsed.data.sort_order,
      }),
    };
  });

  // GET /mcp/servers/:id
  app.get('/mcp/servers/:id', {
    schema: {
      tags: ['mcp'],
      summary: 'Get MCP server config',
      params: idParamsJsonSchema,
      response: {
        200: { type: 'object', properties: { data: mcpServerResponseSchema } },
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auth = getRequestAuthContext(request);
    const config = await service.getConfig(id, auth.accountId);
    if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');
    return { data: attachLiveStatus(config, mcpManager) };
  });

  // POST /mcp/servers
  app.post('/mcp/servers', {
    schema: {
      tags: ['mcp'],
      summary: 'Create MCP server config',
      operationId: 'createMcpServer',
      body: createServerBodyJsonSchema,
      response: {
        201: { type: 'object', properties: { data: mcpServerResponseSchema } },
        400: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(createServerSchema, request.body, reply);
    if (!parsed.ok) return;
    const auth = getRequestAuthContext(request);
    try {
      const config = await service.createConfig(parsed.data, auth.accountId);
      await syncRuntimeConfig(config.id, auth.accountId);
      return reply.code(201).send({ data: attachLiveStatus(config, mcpManager) });
    } catch (err) {
      if (err instanceof McpServiceError) return sendMcpServiceError(reply, err);
      throw err;
    }
  });

  // PATCH /mcp/servers/:id
  app.patch('/mcp/servers/:id', {
    schema: {
      tags: ['mcp'],
      summary: 'Update MCP server config',
      operationId: 'updateMcpServer',
      body: updateServerBodyJsonSchema,
      params: idParamsJsonSchema,
      response: {
        200: { type: 'object', properties: { data: mcpServerResponseSchema } },
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = parseWithSchema(updateServerSchema, request.body, reply);
    if (!parsed.ok) return;
    const auth = getRequestAuthContext(request);
    try {
      const previousStatus = mcpManager?.getStatus(id) ?? null;
      const config = await service.updateConfig(id, parsed.data, auth.accountId);
      if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');
      await syncRuntimeConfig(id, auth.accountId, previousStatus);
      return { data: attachLiveStatus(config, mcpManager) };
    } catch (err) {
      if (err instanceof McpServiceError) return sendMcpServiceError(reply, err);
      throw err;
    }
  });

  // DELETE /mcp/servers/:id
  app.delete('/mcp/servers/:id', {
    schema: {
      tags: ['mcp'],
      summary: 'Delete MCP server config',
      operationId: 'deleteMcpServer',
      params: idParamsJsonSchema,
      response: {
        200: { type: 'object', properties: { data: { type: 'object', properties: { deleted: { type: 'boolean' } } } } },
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auth = getRequestAuthContext(request);
    const deleted = await service.deleteConfig(id, auth.accountId);
    if (!deleted) return sendError(reply, 404, 'not_found', 'MCP server not found');
    await mcpManager?.removeServer(id);
    return { data: { deleted: true } };
  });

  // PATCH /mcp/servers/:id/toggle
  app.patch('/mcp/servers/:id/toggle', {
    schema: {
      tags: ['mcp'],
      summary: 'Enable/disable MCP server',
      operationId: 'toggleMcpServer',
      body: toggleServerBodyJsonSchema,
      params: idParamsJsonSchema,
      response: {
        200: { type: 'object', properties: { data: mcpServerResponseSchema } },
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = parseWithSchema(toggleServerSchema, request.body, reply);
    if (!parsed.ok) return;
    const auth = getRequestAuthContext(request);
    const previousStatus = mcpManager?.getStatus(id) ?? null;
    const config = await service.toggleConfig(id, parsed.data.enabled, auth.accountId);
    if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');

    if (parsed.data.enabled) {
      await syncRuntimeConfig(id, auth.accountId, previousStatus);
    } else {
      await mcpManager?.removeServer(id);
    }
    return { data: attachLiveStatus(config, mcpManager) };
  });
}

// ══════════════════════════════════════════════════
// 运行时操作路由
// ══════════════════════════════════════════════════

export async function registerMcpRuntimeRoutes(
  app: FastifyInstance,
  mcpManager: McpConnectionManager,
  connection: DatabaseConnection,
): Promise<void> {
  const service = new McpService(connection.db);

  // GET /mcp/servers/:id/status
  app.get('/mcp/servers/:id/status', {
    schema: {
      tags: ['mcp'],
      summary: 'Get MCP server connection status',
      params: idParamsJsonSchema,
      response: {
        200: { type: 'object', properties: { data: mcpStatusResponseSchema } },
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auth = getRequestAuthContext(request);
    const config = await service.getConfig(id, auth.accountId);
    if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');

    return { data: buildStatusForConfig(config, mcpManager) };
  });

  // GET /mcp/statuses
  app.get('/mcp/statuses', {
    schema: {
      tags: ['mcp'],
      summary: 'Get all MCP server connection statuses',
      response: {
        200: { type: 'object', properties: { data: { type: 'array', items: mcpStatusResponseSchema } } },
      },
    },
  }, async (request) => {
    const auth = getRequestAuthContext(request);
    const statuses = mcpManager.getStatuses();
    const ownedServerIds = new Set(await service.getOwnedConfigIds(
      auth.accountId,
      statuses.map((status) => status.serverId),
    ));

    return {
      data: statuses
        .filter((status) => ownedServerIds.has(status.serverId))
        .map(formatStatus),
    };
  });

  // POST /mcp/servers/:id/connect
  app.post('/mcp/servers/:id/connect', {
    schema: {
      tags: ['mcp'],
      summary: 'Connect/reconnect to MCP server',
      params: idParamsJsonSchema,
      response: {
        200: { type: 'object', properties: { data: mcpStatusResponseSchema } },
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const auth = getRequestAuthContext(request);
      const config = await service.getConfig(id, auth.accountId);
      if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');
      if (!config.enabled) {
        return sendError(reply, 409, 'mcp_server_disabled', 'Disabled MCP servers cannot be connected', {
          live_status: buildStatusForConfig(config, mcpManager),
        });
      }

      const entity = await service.getConfigEntity(id, auth.accountId);
      if (!entity) return sendError(reply, 404, 'not_found', 'MCP server not found');

      if (!mcpManager.hasServer(id)) {
        await mcpManager.addServer(entity);
      } else {
        await mcpManager.reconnect(id);
      }

      return { data: buildStatusForConfig(config, mcpManager) };
    } catch (err) {
      if (err instanceof McpServiceError) return sendMcpServiceError(reply, err);
      throw err;
    }
  });

  // POST /mcp/servers/:id/disconnect
  app.post('/mcp/servers/:id/disconnect', {
    schema: {
      tags: ['mcp'],
      summary: 'Disconnect MCP server',
      params: idParamsJsonSchema,
      response: {
        200: { type: 'object', properties: { data: mcpStatusResponseSchema } },
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auth = getRequestAuthContext(request);
    const config = await service.getConfig(id, auth.accountId);
    if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');

    if (!config.enabled) {
      return { data: buildStatusForConfig(config, mcpManager) };
    }

    const connection = mcpManager.getConnectionSync(id);
    if (!connection) {
      return sendError(reply, 409, 'mcp_runtime_not_attached', 'MCP server is enabled in storage but not attached to the runtime manager', {
        live_status: buildStatusForConfig(config, mcpManager),
      });
    }

    await connection.disconnect();
    return { data: buildStatusForConfig(config, mcpManager) };
  });

  // GET /mcp/servers/:id/tools
  app.get('/mcp/servers/:id/tools', {
    schema: {
      tags: ['mcp'],
      summary: 'List tools from MCP server',
      params: idParamsJsonSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  parameters: { type: 'object' },
                  side_effect_level: { type: 'string' },
                  source: { type: 'string' },
                },
              },
            },
          },
        },
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const auth = getRequestAuthContext(request);
      const config = await service.getConfig(id, auth.accountId);
      if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');
      if (!config.enabled) {
        return sendError(reply, 409, 'mcp_server_disabled', 'Disabled MCP servers do not expose runtime tools', {
          live_status: buildStatusForConfig(config, mcpManager),
        });
      }

      const existingStatus = mcpManager.getStatus(id);
      if (!existingStatus) {
        return sendError(reply, 409, 'mcp_runtime_not_attached', 'MCP server is enabled in storage but not attached to the runtime manager', {
          live_status: buildStatusForConfig(config, mcpManager),
        });
      }

      const conn = await mcpManager.getConnection(id);
      if (!conn || conn.state !== 'connected') {
        return sendError(reply, 503, 'mcp_runtime_unavailable', 'MCP server runtime is not currently connected', {
          live_status: buildStatusForConfig(config, mcpManager),
        });
      }

      const tools = conn.getTools().map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        side_effect_level: t.sideEffectLevel,
        source: t.source,
      }));

      return { data: tools };
    } catch (err) {
      if (err instanceof McpServiceError) return sendMcpServiceError(reply, err);
      throw err;
    }
  });

  // POST /mcp/servers/:id/test
  app.post('/mcp/servers/:id/test', {
    schema: {
      tags: ['mcp'],
      summary: 'Test MCP server connection',
      params: idParamsJsonSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                tool_count: { type: 'integer' },
                duration_ms: { type: 'integer' },
                error: { type: 'string', nullable: true },
              },
            },
          },
        },
        404: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const auth = getRequestAuthContext(request);
      const config = await service.getConfigEntity(id, auth.accountId);
      if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');

      const startTime = Date.now();
      const testConnection = new McpConnection(config);

      try {
        await testConnection.connect();
        const tools = testConnection.getTools();
        const durationMs = Date.now() - startTime;

        await testConnection.disconnect();

        return {
          data: {
            success: true,
            tool_count: tools.length,
            duration_ms: durationMs,
            error: null,
          },
        };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        await testConnection.disconnect().catch(() => {});

        return {
          data: {
            success: false,
            tool_count: 0,
            duration_ms: durationMs,
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    } catch (err) {
      if (err instanceof McpServiceError) return sendMcpServiceError(reply, err);
      throw err;
    }
  });
}

function sendMcpServiceError(reply: FastifyReply, error: McpServiceError) {
  switch (error.code) {
    case 'name_conflict':
      return sendError(reply, 409, error.code, error.message);
    case 'secret_unavailable':
      return sendError(reply, 503, error.code, error.message);
    case 'secret_invalid_format':
      return sendError(reply, 500, error.code, error.message);
    default:
      return sendError(reply, 400, error.code, error.message);
  }
}

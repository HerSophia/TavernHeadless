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

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { DatabaseConnection } from '../db/client.js';
import { idParamsJsonSchema, errorResponseJsonSchema } from './schemas/common.js';
import { parseWithSchema, sendError } from '../lib/http.js';
import { buildListMeta, listQuerySchemaBase } from '../lib/pagination.js';
import { McpService, McpServiceError } from '../services/mcp-service.js';
import type { McpConnectionManager } from '../mcp/mcp-connection-manager.js';
import { McpConnection } from '../mcp/mcp-connection.js';
import { getRequestAuthContext } from '../plugins/auth.js';

// ══════════════════════════════════════════════════
// Zod Schemas
// ══════════════════════════════════════════════════

const transportSchema = z.enum(['stdio', 'http']);
const sideEffectLevelSchema = z.enum(['none', 'sandbox', 'irreversible']);

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

const mcpServerResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    transport: { type: 'string', enum: ['stdio', 'http'] },
    stdio: { type: 'object', nullable: true },
    http: { type: 'object', nullable: true },
    tool_prefix: { type: 'string', nullable: true },
    enabled: { type: 'boolean' },
    connect_timeout_ms: { type: 'integer' },
    call_timeout_ms: { type: 'integer' },
    tool_refresh_interval_ms: { type: 'integer' },
    default_side_effect_level: { type: 'string' },
    created_at: { type: 'integer' },
    updated_at: { type: 'integer' },
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
  },
};

// ══════════════════════════════════════════════════
// 配置 CRUD 路由
// ══════════════════════════════════════════════════

export async function registerMcpConfigRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const service = new McpService(connection.db);

  // GET /mcp/servers
  app.get('/mcp/servers', {
    schema: {
      tags: ['mcp'],
      summary: 'List MCP server configs',
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
      data: result.configs,
      meta: buildListMeta({
        total: result.total,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        sortBy: parsed.data.sort_by,
        sortOrder:parsed.data.sort_order,
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
    return { data: config };
  });

  // POST /mcp/servers
  app.post('/mcp/servers', {
    schema: {
      tags: ['mcp'],
      summary: 'Create MCP server config',
      response: {
        201: { type: 'object', properties: { data: mcpServerResponseSchema } },
        400: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = parseWithSchema(createServerSchema, request.body, reply);
    if (!parsed.ok) return;
    const auth = getRequestAuthContext(request);
    try {
      const config = await service.createConfig(parsed.data, auth.accountId);
      return reply.code(201).send({ data: config });
    } catch (err) {
      if (err instanceof McpServiceError) {
        const status = err.code === 'name_conflict' ? 409 : 400;
        return sendError(reply, status, err.code, err.message);
      }
      throw err;
    }
  });

  // PATCH /mcp/servers/:id
  app.patch('/mcp/servers/:id', {
    schema: {
      tags: ['mcp'],
      summary: 'Update MCP server config',
      params: idParamsJsonSchema,
      response: {
        200: { type: 'object', properties: { data: mcpServerResponseSchema } },
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = parseWithSchema(updateServerSchema, request.body, reply);
    if (!parsed.ok) return;
    const auth = getRequestAuthContext(request);
    try {
      const config = await service.updateConfig(id, parsed.data, auth.accountId);
      if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');
      return { data: config };
    } catch (err) {
      if (err instanceof McpServiceError) {
        const status = err.code === 'name_conflict' ? 409 : 400;
        return sendError(reply, status, err.code, err.message);
      }
      throw err;
    }
  });

  // DELETE /mcp/servers/:id
  app.delete('/mcp/servers/:id', {
    schema: {
      tags: ['mcp'],
      summary: 'Delete MCP server config',
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
    return { data: { deleted: true } };
  });

  // PATCH /mcp/servers/:id/toggle
  app.patch('/mcp/servers/:id/toggle', {
    schema: {
      tags: ['mcp'],
      summary: 'Enable/disable MCP server',
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
    const config = await service.toggleConfig(id, parsed.data.enabled, auth.accountId);
    if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');
    return { data: config };
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
    const config = await service.getConfigEntity(id, auth.accountId);
    if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');

    const status = mcpManager.getStatus(id);
    if (!status) return sendError(reply, 404, 'not_found', 'MCP server not found in manager');
    return { data: formatStatus(status) };
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
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auth = getRequestAuthContext(request);
    const config = await service.getConfigEntity(id, auth.accountId);
    if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');

    if (!mcpManager.hasServer(id)) {
      await mcpManager.addServer(config);
    } else {
      await mcpManager.reconnect(id);
    }

    const status = mcpManager.getStatus(id);
    return { data: formatStatus(status!) };
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
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auth = getRequestAuthContext(request);
    const config = await service.getConfigEntity(id, auth.accountId);
    if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');

    const connection = mcpManager.getConnectionSync(id);
    if (!connection) return sendError(reply, 404, 'not_found', 'MCP server not found in manager');

    await connection.disconnect();
    const status = mcpManager.getStatus(id);
    return { data: formatStatus(status!) };
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
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auth = getRequestAuthContext(request);
    const config = await service.getConfigEntity(id, auth.accountId);
    if (!config) return sendError(reply, 404, 'not_found', 'MCP server not found');

    const conn = await mcpManager.getConnection(id);
    if (!conn) return sendError(reply, 404, 'not_found', 'MCP server not found in manager');

    const tools = conn.getTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      side_effect_level: t.sideEffectLevel,
      source: t.source,
    }));

    return { data: tools };
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
      },
    },
  }, async (request, reply) => {
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
  });
}

// ── 辅助函数 ─────────────────────────────────────

import type { McpConnectionStatus } from '../mcp/types.js';

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
  };
}

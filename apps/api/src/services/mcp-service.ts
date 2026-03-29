/**
 * McpService
 *
 * MCP 服务器配置的 CRUD 业务层。
 * 负责对 mcp_server_config 表的增删改查、唯一性校验、
 * 以及数据库行与业务类型之间的转换。
 */

import { and, count, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { AppDb } from '../db/client.js';
import { mcpServerConfigs } from '../db/schema.js';
import type {
  McpServerConfig,
  CreateMcpServerInput,
  UpdateMcpServerInput,
  McpServerConfigResponse,
  StdioTransportConfig,
  HttpTransportConfig,
} from '../mcp/types.js';

// ── 内部辅助 ─────────────────────────────────────

type McpRow = typeof mcpServerConfigs.$inferSelect;

function normalizeCandidateIds(candidateIds?: string[]): string[] {
  if (!candidateIds) {
    return [];
  }

  const uniqueIds = new Set<string>();
  for (const candidateId of candidateIds) {
    const normalizedId = candidateId.trim();
    if (normalizedId.length > 0) {
      uniqueIds.add(normalizedId);
    }
  }

  return [...uniqueIds];
}

/**
 * 将数据库行转为业务对象 McpServerConfig。
 * config_json 字段存储 stdio / http 传输配置。
 */
function rowToConfig(row: McpRow): McpServerConfig {
  const configData = JSON.parse(row.configJson) as {
    stdio?: StdioTransportConfig;
    http?: HttpTransportConfig;
  };

  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpServerConfig['transport'],
    stdio: configData.stdio,
    http: configData.http,
    toolPrefix: row.toolPrefix ?? undefined,
    enabled: row.enabled === 1,
    connectTimeoutMs: row.connectTimeoutMs,
    callTimeoutMs: row.callTimeoutMs,
    toolRefreshIntervalMs: row.toolRefreshIntervalMs,
    defaultSideEffectLevel: row.defaultSideEffectLevel as McpServerConfig['defaultSideEffectLevel'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 业务对象转为 API 响应格式 */
function configToResponse(config: McpServerConfig): McpServerConfigResponse {
  return {
    id: config.id,
    name: config.name,
    transport: config.transport,
    stdio: config.stdio,
    http: config.http,
    tool_prefix: config.toolPrefix ?? null,
    enabled: config.enabled,
    connect_timeout_ms: config.connectTimeoutMs,
    call_timeout_ms: config.callTimeoutMs,
    tool_refresh_interval_ms: config.toolRefreshIntervalMs,
    default_side_effect_level: config.defaultSideEffectLevel,
    created_at: config.createdAt,
    updated_at: config.updatedAt,
  };
}

// ── 列表查询参数 ──────────────────────────────────

export interface ListMcpServersQuery {
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

// ── McpService ────────────────────────────────────

export class McpService {
  constructor(private db: AppDb) {}

  /**
   * 查询服务器配置列表，支持 enabled 过滤和分页。
   */
  async listConfigs(
    accountId: string,
    query: ListMcpServersQuery = {}
  ): Promise<{
    configs: McpServerConfigResponse[];
    total: number;
  }> {
    const { enabled, limit = 50, offset = 0 } = query;

    const conditions = [eq(mcpServerConfigs.accountId, accountId)];
    if (enabled !== undefined) {
      conditions.push(eq(mcpServerConfigs.enabled, enabled ? 1 : 0));
    }

    const where = and(...conditions);

    const [rows, totalResult] = await Promise.all([
      this.db
        .select()
        .from(mcpServerConfigs)
        .where(where)
        .limit(limit)
        .offset(offset)
        .orderBy(mcpServerConfigs.createdAt),
      this.db
        .select({ count: count() })
        .from(mcpServerConfigs)
        .where(where),
    ]);

    return {
      configs: rows.map(rowToConfig).map(configToResponse),
      total: totalResult[0]?.count ?? 0,
    };
  }

  /**
   * 返回账号内所有 enabled=1 的服务器配置。
   */
  async listEnabledConfigs(accountId: string): Promise<McpServerConfig[]> {
    const rows = await this.db
      .select()
      .from(mcpServerConfigs)
      .where(and(
        eq(mcpServerConfigs.accountId, accountId),
        eq(mcpServerConfigs.enabled, 1),
      ))
      .orderBy(mcpServerConfigs.createdAt);

    return rows.map(rowToConfig);
  }

  /**
   * 返回所有账号内 enabled=1 的服务器配置。
   * 仅供应用启动时初始化全局连接管理器使用。
   */
  async listAllEnabledConfigs(): Promise<McpServerConfig[]> {
    const rows = await this.db
      .select()
      .from(mcpServerConfigs)
      .where(eq(mcpServerConfigs.enabled, 1))
      .orderBy(mcpServerConfigs.createdAt);

    return rows.map(rowToConfig);
  }

  /**
   * 返回属于指定账号的配置 ID 列表。
   * 若提供 candidateIds，则只在候选集合内过滤。
   */
  async getOwnedConfigIds(accountId: string, candidateIds?: string[]): Promise<string[]> {
    const normalizedCandidateIds = normalizeCandidateIds(candidateIds);
    if (candidateIds && normalizedCandidateIds.length === 0) {
      return [];
    }

    const conditions = [eq(mcpServerConfigs.accountId, accountId)];
    if (candidateIds) {
      conditions.push(inArray(mcpServerConfigs.id, normalizedCandidateIds));
    }

    const rows = await this.db
      .select({ id: mcpServerConfigs.id })
      .from(mcpServerConfigs)
      .where(and(...conditions));

    return rows.map((row) => row.id);
  }

  /**
   * 根据 ID 获取单条配置。
   */
  async getConfig(id: string, accountId: string): Promise<McpServerConfigResponse | null> {
    const rows = await this.db
      .select()
      .from(mcpServerConfigs)
      .where(and(
        eq(mcpServerConfigs.id, id),
        eq(mcpServerConfigs.accountId, accountId),
      ))
      .limit(1);

    if (rows.length === 0) return null;
    return configToResponse(rowToConfig(rows[0]!));
  }

  /**
   * 根据 ID 获取业务对象（供内部使用）。
   */
  async getConfigEntity(id: string, accountId: string): Promise<McpServerConfig | null> {
    const rows = await this.db
      .select()
      .from(mcpServerConfigs)
      .where(and(
        eq(mcpServerConfigs.id, id),
        eq(mcpServerConfigs.accountId, accountId),
      ))
      .limit(1);

    if (rows.length === 0) return null;
    return rowToConfig(rows[0]!);
  }

  /**
   * 创建 MCP 服务器配置。
   * name 在账号内必须唯一，否则抛出异常。
   */
  async createConfig(input: CreateMcpServerInput, accountId: string): Promise<McpServerConfigResponse> {
    const existing = await this.db
      .select({ id: mcpServerConfigs.id })
      .from(mcpServerConfigs)
      .where(and(
        eq(mcpServerConfigs.accountId, accountId),
        eq(mcpServerConfigs.name, input.name),
      ))
      .limit(1);

    if (existing.length > 0) {
      throw new McpServiceError('name_conflict', `MCP server name "${input.name}" already exists`);
    }

    if (input.transport === 'stdio' && !input.stdio) {
      throw new McpServiceError('invalid_config', 'stdio transport requires stdio config');
    }
    if (input.transport === 'http' && !input.http) {
      throw new McpServiceError('invalid_config', 'http transport requires http config');
    }

    const now = Date.now();
    const id = nanoid();

    const configJson = JSON.stringify({
      stdio: input.stdio,
      http: input.http,
    });

    await this.db.insert(mcpServerConfigs).values({
      id,
      accountId,
      name: input.name,
      transport: input.transport,
      configJson,
      toolPrefix: input.tool_prefix ?? null,
      enabled: (input.enabled ?? true) ? 1 : 0,
      connectTimeoutMs: input.connect_timeout_ms ?? 30000,
      callTimeoutMs: input.call_timeout_ms ?? 60000,
      toolRefreshIntervalMs: input.tool_refresh_interval_ms ?? 300000,
      defaultSideEffectLevel: input.default_side_effect_level ?? 'irreversible',
      createdAt: now,
      updatedAt: now,
    });

    return (await this.getConfig(id, accountId))!;
  }

  /**
   * 更新 MCP 服务器配置。
   * 返回 null 表示指定 ID 不存在或不属于该账号。
   */
  async updateConfig(
    id: string,
    input: UpdateMcpServerInput,
    accountId: string
  ): Promise<McpServerConfigResponse | null> {
    const current = await this.getConfigEntity(id, accountId);
    if (!current) return null;

    if (input.name !== undefined && input.name !== current.name) {
      const existing = await this.db
        .select({ id: mcpServerConfigs.id })
        .from(mcpServerConfigs)
        .where(and(
          eq(mcpServerConfigs.accountId, accountId),
          eq(mcpServerConfigs.name, input.name),
        ))
        .limit(1);

      if (existing.length > 0) {
        throw new McpServiceError('name_conflict', `MCP server name "${input.name}" already exists`);
      }
    }

    const newTransport = input.transport ?? current.transport;
    const newStdio = input.stdio !== undefined ? input.stdio : current.stdio;
    const newHttp = input.http !== undefined ? input.http : current.http;

    if (newTransport === 'stdio' && !newStdio) {
      throw new McpServiceError('invalid_config', 'stdio transport requires stdio config');
    }
    if (newTransport === 'http' && !newHttp) {
      throw new McpServiceError('invalid_config', 'http transport requires http config');
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (input.name !== undefined) updates.name = input.name;
    if (input.transport !== undefined) updates.transport = input.transport;

    if (input.stdio !== undefined || input.http !== undefined || input.transport !== undefined) {
      updates.configJson = JSON.stringify({
        stdio: newStdio,
        http: newHttp,
      });
    }

    if (input.tool_prefix !== undefined) {
      updates.toolPrefix = input.tool_prefix;
    }
    if (input.connect_timeout_ms !== undefined) updates.connectTimeoutMs = input.connect_timeout_ms;
    if (input.call_timeout_ms !== undefined) updates.callTimeoutMs = input.call_timeout_ms;
    if (input.tool_refresh_interval_ms !== undefined) updates.toolRefreshIntervalMs = input.tool_refresh_interval_ms;
    if (input.default_side_effect_level !== undefined) updates.defaultSideEffectLevel = input.default_side_effect_level;

    await this.db
      .update(mcpServerConfigs)
      .set(updates as any)
      .where(and(
        eq(mcpServerConfigs.id, id),
        eq(mcpServerConfigs.accountId, accountId),
      ));

    return this.getConfig(id, accountId);
  }

  /**
   * 删除 MCP 服务器配置。
   * 返回 true 表示删除成功，false 表示不存在或不属于该账号。
   */
  async deleteConfig(id: string, accountId: string): Promise<boolean> {
    const result = await this.db
      .delete(mcpServerConfigs)
      .where(and(
        eq(mcpServerConfigs.id, id),
        eq(mcpServerConfigs.accountId, accountId),
      ));

    return result.changes > 0;
  }

  /**
   * 启用/禁用 MCP 服务器。
   * 返回更新后的配置，或 null 表示不存在或不属于该账号。
   */
  async toggleConfig(id: string, enabled: boolean, accountId: string): Promise<McpServerConfigResponse | null> {
    const current = await this.getConfig(id, accountId);
    if (!current) return null;

    await this.db
      .update(mcpServerConfigs)
      .set({
        enabled: enabled ? 1 : 0,
        updatedAt: Date.now(),
      })
      .where(and(
        eq(mcpServerConfigs.id, id),
        eq(mcpServerConfigs.accountId, accountId),
      ));

    return this.getConfig(id, accountId);
  }
}

// ── 错误类型 ───────────────────────────────────────

export type McpServiceErrorCode = 'name_conflict' | 'invalid_config' | 'not_found';

export class McpServiceError extends Error {
  constructor(
    public readonly code: McpServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpServiceError';
  }
}

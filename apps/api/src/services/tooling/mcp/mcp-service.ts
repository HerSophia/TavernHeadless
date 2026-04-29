/**
 * McpService
 *
 * MCP 服务器配置的 CRUD 业务层。
 * 负责对 mcp_server_config 表的增删改查、唯一性校验、
 * 以及数据库行与业务类型之间的转换。
 */

import { and, count, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type {
  InstanceSlot,
  ToolParameterProperty,
  ToolParameterSchema,
  ToolReplaySafety,
  ToolSideEffectLevel,
} from '@tavern/core';

import type { AppDb } from '../../../db/client.js';
import { mcpServerConfigs } from '../../../db/schema.js';
import {
  SecretFormatError,
  SecretUnavailableError,
  decryptSecret,
  encryptSecret,
  maskSecret,
} from '../../../lib/secrets.js';
import type {
  McpServerConfig,
  CreateMcpServerInput,
  UpdateMcpServerInput,
  McpServerConfigResponse,
  McpToolMetadataOverride,
  McpToolMetadataOverrideInput,
  StdioTransportConfig,
  HttpTransportConfig,
  MaskedStdioTransportConfig,
  MaskedHttpTransportConfig,
  McpTransportType,
} from './types.js';

// ── 内部辅助 ─────────────────────────────────────

type McpRow = typeof mcpServerConfigs.$inferSelect;

type McpPublicConfigV1 = {
  version: 1;
  stdio?: {
    command: string;
    args?: string[];
    cwd?: string;
  };
  http?: {
    url: string;
  };
  metadataOverrides?: McpToolMetadataOverride[];
};

type McpSecretBundleV1 = {
  version: 1;
  stdio?: {
    env?: Record<string, string>;
  };
  http?: {
    headers?: Record<string, string>;
  };
};

type McpSecretSummaryV1 = {
  version: 1;
  stdio?: {
    envMasked?: Record<string, string>;
  };
  http?: {
    headersMasked?: Record<string, string>;
  };
};

type StoredConfigParseResult = {
  publicConfig: McpPublicConfigV1;
  legacySecretBundle: McpSecretBundleV1 | null;
  legacySecretSummary: McpSecretSummaryV1 | null;
};

export interface ResolveMcpConfigsResult {
  configs: McpServerConfig[];
  failures: Array<{
    accountId: string;
    serverId: string;
    serverName: string;
    transport: McpTransportType;
    error: string;
  }>;
}

export interface ListMcpServersQuery {
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

type ListEnabledConfigsOptions = {
  resolveSecrets?: boolean;
  skipInvalidConfigs?: boolean;
};

type ServiceOptions = {
  masterKey?: string;
};

const INSTANCE_SLOTS = new Set<InstanceSlot>([
  'narrator',
  'director',
  'verifier',
  'memory',
]);

const SIDE_EFFECT_LEVEL_VALUES = new Set<ToolSideEffectLevel>([
  'none',
  'sandbox',
  'irreversible',
]);

const REPLAY_SAFETY_VALUES = new Set<ToolReplaySafety>([
  'safe',
  'confirm_on_replay',
  'never_auto_replay',
  'uncertain',
]);

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

function normalizeToolPrefix(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = typeof value === 'string' ? value.trim() : value;
  return normalized === null || normalized.length === 0 ? null : normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isInstanceSlot(value: unknown): value is InstanceSlot {
  return typeof value === 'string' && INSTANCE_SLOTS.has(value as InstanceSlot);
}

function cloneToolParameterSchema(schema: ToolParameterSchema): ToolParameterSchema {
  return {
    type: schema.type,
    properties: { ...schema.properties },
    ...(schema.required ? { required: [...schema.required] } : {}),
  };
}

function cloneMetadataOverride(override: McpToolMetadataOverride): McpToolMetadataOverride {
  return {
    toolName: override.toolName,
    ...(override.sideEffectLevel ? { sideEffectLevel: override.sideEffectLevel } : {}),
    ...(override.allowedSlots ? { allowedSlots: [...override.allowedSlots] } : {}),
    ...(override.parameterSchema ? { parameterSchema: cloneToolParameterSchema(override.parameterSchema) } : {}),
    ...(override.replaySafety ? { replaySafety: override.replaySafety } : {}),
  };
}

function cloneMetadataOverrides(overrides?: McpToolMetadataOverride[]): McpToolMetadataOverride[] | undefined {
  if (!overrides || overrides.length === 0) {
    return undefined;
  }

  return overrides.map((override) => cloneMetadataOverride(override));
}

function normalizeAllowedSlots(value: unknown): InstanceSlot[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const slots = Array.from(new Set(value.filter(isInstanceSlot)));
  return slots.length > 0 ? slots : undefined;
}

function normalizeParameterSchemaItems(
  value: unknown,
): ToolParameterProperty['items'] | undefined {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    return undefined;
  }

  return {
    type: value.type,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
  };
}

function normalizeParameterSchemaProperty(value: unknown): ToolParameterProperty | null {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    return null;
  }

  const items = normalizeParameterSchemaItems(value.items);
  const enumValues = Array.isArray(value.enum)
    ? value.enum.filter((item): item is string => typeof item === 'string')
    : undefined;

  return {
    type: value.type,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(enumValues ? { enum: enumValues } : {}),
    ...(value.default !== undefined ? { default: value.default } : {}),
    ...(items ? { items } : {}),
  };
}

function normalizeParameterSchema(value: unknown): ToolParameterSchema | undefined {
  if (!isPlainObject(value) || value.type !== 'object') {
    return undefined;
  }

  const properties = isPlainObject(value.properties)
    ? Object.fromEntries(
        Object.entries(value.properties)
          .map(([key, item]) => [key, normalizeParameterSchemaProperty(item)] as const)
          .filter((entry): entry is [string, ToolParameterProperty] => entry[1] !== null),
      )
    : {};

  return {
    type: 'object',
    properties,
    required: Array.isArray(value.required)
      ? value.required.filter((item): item is string => typeof item === 'string')
      : undefined,
  };
}

function normalizeSideEffectLevel(value: unknown): ToolSideEffectLevel | undefined {
  return typeof value === 'string' && SIDE_EFFECT_LEVEL_VALUES.has(value as ToolSideEffectLevel)
    ? value as ToolSideEffectLevel
    : undefined;
}

function normalizeReplaySafety(value: unknown): ToolReplaySafety | undefined {
  return typeof value === 'string' && REPLAY_SAFETY_VALUES.has(value as ToolReplaySafety)
    ? value as ToolReplaySafety
    : undefined;
}

function normalizeMetadataOverride(value: unknown): McpToolMetadataOverride | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const toolNameCandidate = typeof value.toolName === 'string'
    ? value.toolName
    : typeof value.tool_name === 'string'
      ? value.tool_name
      : '';
  const toolName = toolNameCandidate.trim();
  if (!toolName) {
    return null;
  }

  const sideEffectLevel = normalizeSideEffectLevel(value.sideEffectLevel ?? value.side_effect_level);
  const allowedSlots = normalizeAllowedSlots(value.allowedSlots ?? value.allowed_slots);
  const parameterSchema = normalizeParameterSchema(
    value.parameterSchema
    ?? value.parameter_schema
    ?? value.parameterSchemaOverride
    ?? value.parameter_schema_override,
  );
  const replaySafety = normalizeReplaySafety(value.replaySafety ?? value.replay_safety);

  if (!sideEffectLevel && !allowedSlots && !parameterSchema && !replaySafety) {
    return null;
  }

  return {
    toolName,
    ...(sideEffectLevel ? { sideEffectLevel } : {}),
    ...(allowedSlots ? { allowedSlots } : {}),
    ...(parameterSchema ? { parameterSchema } : {}),
    ...(replaySafety ? { replaySafety } : {}),
  };
}

function normalizeMetadataOverrides(value: unknown): McpToolMetadataOverride[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const byToolName = new Map<string, McpToolMetadataOverride>();
  for (const item of value) {
    const normalized = normalizeMetadataOverride(item);
    if (normalized) {
      byToolName.set(normalized.toolName, normalized);
    }
  }

  return byToolName.size > 0 ? [...byToolName.values()] : undefined;
}

function toMetadataOverrideResponse(overrides?: McpToolMetadataOverride[]): McpToolMetadataOverrideInput[] {
  return (overrides ?? []).map((override) => ({
    tool_name: override.toolName,
    ...(override.sideEffectLevel ? { side_effect_level: override.sideEffectLevel } : {}),
    ...(override.allowedSlots ? { allowed_slots: [...override.allowedSlots] } : {}),
    ...(override.parameterSchema ? { parameter_schema: cloneToolParameterSchema(override.parameterSchema) } : {}),
    ...(override.replaySafety ? { replay_safety: override.replaySafety } : {}),
  }));
}

function parseStoredConfig(configJson: string): StoredConfigParseResult {
  const raw = JSON.parse(configJson) as {
    stdio?: StdioTransportConfig;
    http?: HttpTransportConfig;
    metadataOverrides?: unknown;
    metadata_overrides?: unknown;
  };

  const publicConfig: McpPublicConfigV1 = {
    version: 1,
    stdio: raw.stdio
      ? {
          command: raw.stdio.command,
          args: raw.stdio.args,
          cwd: raw.stdio.cwd,
        }
      : undefined,
    http: raw.http
      ? {
          url: raw.http.url,
        }
      : undefined,
    metadataOverrides: normalizeMetadataOverrides(raw.metadataOverrides ?? raw.metadata_overrides),
  };

  const legacySecretBundle = createSecretBundle({
    stdio: raw.stdio,
    http: raw.http,
  });

  return {
    publicConfig,
    legacySecretBundle,
    legacySecretSummary: legacySecretBundle ? buildSecretSummary(legacySecretBundle) : null,
  };
}

function parseSecretSummary(summaryJson?: string | null): McpSecretSummaryV1 | null {
  if (!summaryJson) {
    return null;
  }

  try {
    const raw = JSON.parse(summaryJson) as McpSecretSummaryV1;
    return {
      version: 1,
      stdio: raw.stdio?.envMasked ? { envMasked: raw.stdio.envMasked } : undefined,
      http: raw.http?.headersMasked ? { headersMasked: raw.http.headersMasked } : undefined,
    };
  } catch {
    return null;
  }
}

function buildPublicConfigFromRuntime(config: {
  transport: McpTransportType;
  stdio?: StdioTransportConfig;
  http?: HttpTransportConfig;
  metadataOverrides?: McpToolMetadataOverride[];
}): McpPublicConfigV1 {
  return {
    version: 1,
    stdio: config.transport === 'stdio' && config.stdio
      ? {
          command: config.stdio.command,
          args: config.stdio.args,
          cwd: config.stdio.cwd,
        }
      : undefined,
    http: config.transport === 'http' && config.http
      ? {
          url: config.http.url,
        }
      : undefined,
    metadataOverrides: cloneMetadataOverrides(config.metadataOverrides),
  };
}

function createSecretBundle(config: {
  stdio?: Pick<StdioTransportConfig, 'env'>;
  http?: Pick<HttpTransportConfig, 'headers'>;
}): McpSecretBundleV1 | null {
  const env = config.stdio?.env;
  const headers = config.http?.headers;

  const hasEnv = Boolean(env && Object.keys(env).length > 0);
  const hasHeaders = Boolean(headers && Object.keys(headers).length > 0);
  if (!hasEnv && !hasHeaders) {
    return null;
  }

  return {
    version: 1,
    stdio: hasEnv ? { env } : undefined,
    http: hasHeaders ? { headers } : undefined,
  };
}

function buildSecretSummary(secretBundle: McpSecretBundleV1): McpSecretSummaryV1 {
  return {
    version: 1,
    stdio: secretBundle.stdio?.env
      ? {
          envMasked: Object.fromEntries(
            Object.entries(secretBundle.stdio.env).map(([key, value]) => [key, maskSecret(value)]),
          ),
        }
      : undefined,
    http: secretBundle.http?.headers
      ? {
          headersMasked: Object.fromEntries(
            Object.entries(secretBundle.http.headers).map(([key, value]) => [key, maskSecret(value)]),
          ),
        }
      : undefined,
  };
}

function toMaskedStdioConfig(
  publicConfig: McpPublicConfigV1,
  secretSummary: McpSecretSummaryV1 | null,
): MaskedStdioTransportConfig | undefined {
  if (!publicConfig.stdio) {
    return undefined;
  }

  return {
    command: publicConfig.stdio.command,
    args: publicConfig.stdio.args,
    cwd: publicConfig.stdio.cwd,
    env_masked: secretSummary?.stdio?.envMasked,
  };
}

function toMaskedHttpConfig(
  publicConfig: McpPublicConfigV1,
  secretSummary: McpSecretSummaryV1 | null,
): MaskedHttpTransportConfig | undefined {
  if (!publicConfig.http) {
    return undefined;
  }

  return {
    url: publicConfig.http.url,
    headers_masked: secretSummary?.http?.headersMasked,
  };
}

function serializePublicConfig(publicConfig: McpPublicConfigV1): string {
  return JSON.stringify(publicConfig);
}

function mergeRuntimeConfig(
  row: McpRow,
  publicConfig: McpPublicConfigV1,
  secretBundle: McpSecretBundleV1 | null,
): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpServerConfig['transport'],
    stdio: publicConfig.stdio
      ? {
          command: publicConfig.stdio.command,
          args: publicConfig.stdio.args,
          cwd: publicConfig.stdio.cwd,
          env: secretBundle?.stdio?.env,
        }
      : undefined,
    http: publicConfig.http
      ? {
          url: publicConfig.http.url,
          headers: secretBundle?.http?.headers,
        }
      : undefined,
    toolPrefix: normalizeToolPrefix(row.toolPrefix) ?? undefined,
    enabled: row.enabled === 1,
    connectTimeoutMs: row.connectTimeoutMs,
    callTimeoutMs: row.callTimeoutMs,
    toolRefreshIntervalMs: row.toolRefreshIntervalMs,
    defaultSideEffectLevel: row.defaultSideEffectLevel as McpServerConfig['defaultSideEffectLevel'],
    metadataOverrides: cloneMetadataOverrides(publicConfig.metadataOverrides),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function configToResponse(row: McpRow): McpServerConfigResponse {
  const stored = parseStoredConfig(row.configJson);
  const secretSummary = parseSecretSummary(row.secretConfigMaskedJson) ?? stored.legacySecretSummary;

  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpTransportType,
    stdio: toMaskedStdioConfig(stored.publicConfig, secretSummary),
    http: toMaskedHttpConfig(stored.publicConfig, secretSummary),
    tool_prefix: normalizeToolPrefix(row.toolPrefix) ?? null,
    enabled: row.enabled === 1,
    connect_timeout_ms: row.connectTimeoutMs,
    call_timeout_ms: row.callTimeoutMs,
    tool_refresh_interval_ms: row.toolRefreshIntervalMs,
    default_side_effect_level: row.defaultSideEffectLevel as McpServerConfig['defaultSideEffectLevel'],
    metadata_overrides: toMetadataOverrideResponse(stored.publicConfig.metadataOverrides),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function configToEntity(row: McpRow): McpServerConfig {
  const stored = parseStoredConfig(row.configJson);

  return mergeRuntimeConfig(
    row,
    stored.publicConfig,
    null,
  );
}

function mergeUpdatedTransportConfig(
  current: McpServerConfig,
  input: UpdateMcpServerInput,
): Pick<McpServerConfig, 'transport' | 'stdio' | 'http'> {
  const transport = input.transport ?? current.transport;

  if (transport === 'stdio') {
    const stdio = input.stdio !== undefined
      ? {
          ...current.stdio,
          ...input.stdio,
        }
      : current.stdio;

    return {
      transport,
      stdio,
      http: undefined,
    };
  }

  const http = input.http !== undefined
    ? {
        ...current.http,
        ...input.http,
      }
    : current.http;

  return {
    transport,
    stdio: undefined,
    http,
  };
}

export class McpService {
  private readonly masterKey: string;

  constructor(
    private db: AppDb,
    options: ServiceOptions = {},
  ) {
    this.masterKey = options.masterKey ?? process.env.APP_SECRETS_MASTER_KEY ?? '';
  }

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
      configs: rows.map(configToResponse),
      total: totalResult[0]?.count ?? 0,
    };
  }

  /**
   * 返回账号内所有 enabled=1 的服务器配置。
   * 该方法主要供工具目录构建使用，不解析 secret。
   */
  async listEnabledConfigs(
    accountId: string,
    _options: ListEnabledConfigsOptions = {},
  ): Promise<McpServerConfig[]> {
    const rows = await this.db
      .select()
      .from(mcpServerConfigs)
      .where(and(
        eq(mcpServerConfigs.accountId, accountId),
        eq(mcpServerConfigs.enabled, 1),
      ))
      .orderBy(mcpServerConfigs.createdAt);

    return rows.map(configToEntity);
  }

  /**
   * 返回所有账号内 enabled=1 的服务器配置。
   * 仅返回成功解析的运行时配置；失败配置会在 initialize 结果中单独给出。
   */
  async listAllEnabledConfigs(): Promise<McpServerConfig[]> {
    const result = await this.resolveAllEnabledConfigsForManager();
    return result.configs;
  }

  /**
   * 返回所有账号内 enabled=1 的运行时配置和解析失败记录。
   */
  async resolveAllEnabledConfigsForManager(): Promise<ResolveMcpConfigsResult> {
    const rows = await this.db
      .select()
      .from(mcpServerConfigs)
      .where(eq(mcpServerConfigs.enabled, 1))
      .orderBy(mcpServerConfigs.createdAt);

    const configs: McpServerConfig[] = [];
    const failures: ResolveMcpConfigsResult['failures'] = [];

    for (const row of rows) {
      try {
        configs.push(this.rowToRuntimeConfig(row));
      } catch (error) {
        failures.push({
          accountId: row.accountId,
          serverId: row.id,
          serverName: row.name,
          transport: row.transport as McpTransportType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { configs, failures };
  }

  /**
   * 回填 legacy 明文 secret 到新列。
   * 没有配置主密钥时，仅跳过，不抛错。
   */
  async backfillLegacySecretStorage(): Promise<{ migrated: number; skipped: number }> {
    const rows = await this.db
      .select()
      .from(mcpServerConfigs)
      .orderBy(mcpServerConfigs.createdAt);

    let migrated = 0;
    let skipped = 0;

    for (const row of rows) {
      if (row.secretConfigEncrypted) {
        continue;
      }

      const stored = parseStoredConfig(row.configJson);
      if (!stored.legacySecretBundle) {
        continue;
      }

      if (!this.hasMasterKey()) {
        skipped += 1;
        continue;
      }

      const storageColumns = this.toStorageColumns(
        mergeRuntimeConfig(row, stored.publicConfig, stored.legacySecretBundle),
      );

      await this.db
        .update(mcpServerConfigs)
        .set({
          configJson: storageColumns.configJson,
          secretConfigEncrypted: storageColumns.secretConfigEncrypted,
          secretConfigMaskedJson: storageColumns.secretConfigMaskedJson,
        })
        .where(eq(mcpServerConfigs.id, row.id));

      migrated += 1;
    }

    return { migrated, skipped };
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
   * 根据 ID 获取单条配置（管理视图，不返回真实 secret）。
   */
  async getConfig(id: string, accountId: string): Promise<McpServerConfigResponse | null> {
    const row = await this.getConfigRow(id, accountId);
    return row ? configToResponse(row) : null;
  }

  /**
   * 根据 ID 获取运行时业务对象（包含真实 secret）。
   */
  async getConfigEntity(id: string, accountId: string): Promise<McpServerConfig | null> {
    const row = await this.getConfigRow(id, accountId);
    if (!row) {
      return null;
    }

    return this.rowToRuntimeConfig(row);
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
    const metadataOverrides = normalizeMetadataOverrides(input.metadata_overrides);
    const storageColumns = this.toStorageColumns({
      transport: input.transport,
      stdio: input.stdio,
      http: input.http,
      metadataOverrides,
    });

    await this.db.insert(mcpServerConfigs).values({
      id,
      accountId,
      name: input.name,
      transport: input.transport,
      configJson: storageColumns.configJson,
      secretConfigEncrypted: storageColumns.secretConfigEncrypted,
      secretConfigMaskedJson: storageColumns.secretConfigMaskedJson,
      toolPrefix: normalizeToolPrefix(input.tool_prefix) ?? null,
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
    const row = await this.getConfigRow(id, accountId);
    if (!row) {
      return null;
    }

    if (input.name !== undefined && input.name !== row.name) {
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

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (input.name !== undefined) updates.name = input.name;
    if (input.tool_prefix !== undefined) updates.toolPrefix = normalizeToolPrefix(input.tool_prefix);
    if (input.connect_timeout_ms !== undefined) updates.connectTimeoutMs = input.connect_timeout_ms;
    if (input.call_timeout_ms !== undefined) updates.callTimeoutMs = input.call_timeout_ms;
    if (input.tool_refresh_interval_ms !== undefined) updates.toolRefreshIntervalMs = input.tool_refresh_interval_ms;
    if (input.default_side_effect_level !== undefined) updates.defaultSideEffectLevel = input.default_side_effect_level;

    if (
      input.stdio !== undefined
      || input.http !== undefined
      || input.transport !== undefined
      || input.metadata_overrides !== undefined
    ) {
      const current = this.rowToRuntimeConfig(row);
      const next = mergeUpdatedTransportConfig(current, input);
      const metadataOverrides = input.metadata_overrides !== undefined
        ? normalizeMetadataOverrides(input.metadata_overrides)
        : current.metadataOverrides;

      if (next.transport === 'stdio' && !next.stdio) {
        throw new McpServiceError('invalid_config', 'stdio transport requires stdio config');
      }
      if (next.transport === 'http' && !next.http) {
        throw new McpServiceError('invalid_config', 'http transport requires http config');
      }

      const storageColumns = this.toStorageColumns({
        ...current,
        transport: next.transport,
        stdio: next.stdio,
        http: next.http,
        metadataOverrides,
      });

      updates.transport = next.transport;
      updates.configJson = storageColumns.configJson;
      updates.secretConfigEncrypted = storageColumns.secretConfigEncrypted;
      updates.secretConfigMaskedJson = storageColumns.secretConfigMaskedJson;
    }

    await this.db
      .update(mcpServerConfigs)
      .set(updates as never)
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

  private async getConfigRow(id: string, accountId: string): Promise<McpRow | null> {
    const rows = await this.db
      .select()
      .from(mcpServerConfigs)
      .where(and(
        eq(mcpServerConfigs.id, id),
        eq(mcpServerConfigs.accountId, accountId),
      ))
      .limit(1);

    return rows[0] ?? null;
  }

  private rowToRuntimeConfig(row: McpRow): McpServerConfig {
    const stored = parseStoredConfig(row.configJson);
    const secretBundle = row.secretConfigEncrypted
      ? this.decryptSecretBundle(row.secretConfigEncrypted, row.name)
      : stored.legacySecretBundle;

    return mergeRuntimeConfig(row, stored.publicConfig, secretBundle);
  }

  private toStorageColumns(config: Pick<McpServerConfig, 'transport' | 'stdio' | 'http' | 'metadataOverrides'>): {
    configJson: string;
    secretConfigEncrypted: string | null;
    secretConfigMaskedJson: string | null;
  } {
    const publicConfig = buildPublicConfigFromRuntime(config);
    const secretBundle = createSecretBundle({
      stdio: config.transport === 'stdio' ? config.stdio : undefined,
      http: config.transport === 'http' ? config.http : undefined,
    });

    if (!secretBundle) {
      return {
        configJson: serializePublicConfig(publicConfig),
        secretConfigEncrypted: null,
        secretConfigMaskedJson: null,
      };
    }

    if (!this.hasMasterKey()) {
      throw new McpServiceError('secret_unavailable', 'APP_SECRETS_MASTER_KEY is required for MCP secret encryption');
    }

    return {
      configJson: serializePublicConfig(publicConfig),
      secretConfigEncrypted: encryptSecret(JSON.stringify(secretBundle), this.masterKey),
      secretConfigMaskedJson: JSON.stringify(buildSecretSummary(secretBundle)),
    };
  }

  private decryptSecretBundle(value: string, serverName: string): McpSecretBundleV1 {
    try {
      const plain = decryptSecret(value, this.masterKey);
      const raw = JSON.parse(plain) as McpSecretBundleV1;

      return {
        version: 1,
        stdio: raw.stdio?.env ? { env: raw.stdio.env } : undefined,
        http: raw.http?.headers ? { headers: raw.http.headers } : undefined,
      };
    } catch (error) {
      if (error instanceof SecretUnavailableError) {
        throw new McpServiceError('secret_unavailable', 'APP_SECRETS_MASTER_KEY is required for MCP secret decryption');
      }

      if (error instanceof SecretFormatError || error instanceof SyntaxError) {
        throw new McpServiceError(
          'secret_invalid_format',
          `Stored MCP secret cannot be decrypted for server "${serverName}". Check APP_SECRETS_MASTER_KEY or data integrity.`,
        );
      }

      throw error;
    }
  }

  private hasMasterKey(): boolean {
    return this.masterKey.trim().length > 0;
  }
}

// ── 错误类型 ───────────────────────────────────────

export type McpServiceErrorCode =
  | 'name_conflict'
  | 'invalid_config'
  | 'not_found'
  | 'secret_invalid_format'
  | 'secret_unavailable';

export class McpServiceError extends Error {
  constructor(
    public readonly code: McpServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpServiceError';
  }
}

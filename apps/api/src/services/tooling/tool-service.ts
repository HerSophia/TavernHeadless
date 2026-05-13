/**
 * ToolService
 *
 * 工具管理业务逻辑层。封装 DrizzleToolRepository 调用，
 * 提供自定义工具的 CRUD 校验、内置工具查询、调用记录查询。
 */

import { nanoid } from "nanoid";
import { BuiltinToolProvider } from "@tavern/core";

import type {
  ToolExecutionCommitOutcome,
  ToolExecutionLifecycleState,
  ToolExecutionProviderType,
  ToolExecutionStatus,
} from "@tavern/core";
import {
  DrizzleToolExecutionRepository,
  type ToolExecutionRecordQuery,
} from "../../adapters/drizzle-tool-execution-repository.js";
import { DrizzleToolRepository } from "../../adapters/drizzle-tool-repository.js";
import type {
  ToolDefinitionRow,
  ToolDefinitionQuery,
  ToolCallRecordQuery,
} from "../../adapters/drizzle-tool-repository.js";
import type { AppDb } from "../../db/client.js";
import { parseJsonField, stringifyJsonField } from "../../lib/http.js";
import { WorkspaceScopeService } from "../workspace-scope-service.js";

// ── Types ───────────────────────────────────────────

export interface CreateDefinitionInput {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  side_effect_level: "none" | "sandbox" | "irreversible";
  allowed_slots: string[];
  source: "preset" | "character" | "custom";
  source_id?: string | null;
  enabled?: boolean;
  handler_type: "script";
  handler: Record<string, unknown>;
}

export interface UpdateDefinitionInput {
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  side_effect_level?: "none" | "sandbox" | "irreversible";
  allowed_slots?: string[];
  source?: "preset" | "character" | "custom";
  source_id?: string | null;
  handler_type?: "script";
  handler?: Record<string, unknown>;
}

export interface ToolDefinitionResponse {
  id: string;
  name: string;
  description: string;
  parameters: unknown;
  side_effect_level: string;
  allowed_slots: unknown;
  source: string;
  source_id: string | null;
  enabled: boolean;
  handler_type: "script";
  handler: unknown;
  created_at: number;
  updated_at: number;
}

export interface ToolCallRecordResponse {
  id: string;
  page_id: string;
  seq: number;
  caller_slot: string;
  tool_name: string;
  args: unknown;
  result: unknown;
  status: string;
  duration_ms: number;
  created_at: number;
}

export interface ToolExecutionRecordResponse {
  id: string;
  run_id: string;
  floor_id: string;
  page_id: string | null;
  caller_slot: string;
  provider_id: string;
  provider_type: ToolExecutionProviderType;
  tool_name: string;
  args: unknown;
  result: unknown;
  status: ToolExecutionStatus;
  lifecycle_state: ToolExecutionLifecycleState;
  commit_outcome: ToolExecutionCommitOutcome;
  side_effect_level: string | null;
  error_message: string | null;
  duration_ms: number;
  delivery_mode: "inline" | "async_job";
  started_at: number;
  finished_at: number | null;
  runtime_job_id: string | null;
  attempt_no: number;
  replay_parent_execution_id: string | null;
  created_at: number;
}

export class ToolServiceError extends Error {
  constructor(
    public readonly code: "tool_definition_conflict",
    message: string,
  ) {
    super(message);
    this.name = "ToolServiceError";
  }
}

// ── Helpers ─────────────────────────────────────────

function toDefinitionResponse(row: ToolDefinitionRow): ToolDefinitionResponse {
  if (row.handlerType !== "script") {
    throw new Error(`Unsupported tool handler type '${row.handlerType}' escaped the public tool surface`);
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    parameters: parseJsonField(row.parametersJson),
    side_effect_level: row.sideEffectLevel,
    allowed_slots: parseJsonField(row.allowedSlotsJson),
    source: row.source,
    source_id: row.sourceId,
    enabled: row.enabled,
    handler_type: row.handlerType,
    handler: parseJsonField(row.handlerJson),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// ── ToolService ─────────────────────────────────────

export class ToolService {
  private repo: DrizzleToolRepository;
  private executionRepo: DrizzleToolExecutionRepository;
  private builtinProvider: BuiltinToolProvider;

  constructor(private readonly db: AppDb) {
    this.repo = new DrizzleToolRepository(this.db);
    this.executionRepo = new DrizzleToolExecutionRepository(this.db);
    this.builtinProvider = new BuiltinToolProvider();
  }

  // ── Builtin ───────────────────────────────────────

  /**
   * 返回所有内置工具定义（只读列表）。
   */
  async listBuiltinTools() {
    const tools = await this.builtinProvider.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      side_effect_level: t.sideEffectLevel,
      allowed_slots: t.allowedSlots,
      source: t.source,
    }));
  }

  // ── Definitions CRUD ──────────────────────────────

  async createDefinition(
    input: CreateDefinitionInput,
    accountId: string,
  ): Promise<ToolDefinitionResponse> {
    try {
      await this.ensureDefinitionIdentityAvailable({
        accountId,
        name: input.name,
        source: input.source,
        sourceId: input.source_id ?? null,
      });

      const now = Date.now();
      const workspaceId = this.resolveDefaultWorkspaceId(accountId);
      const row = await this.repo.insertDefinition({
        id: nanoid(),
        name: input.name,
        description: input.description,
        parametersJson: stringifyJsonField(input.parameters) ?? '{"type":"object","properties":{}}',
        sideEffectLevel: input.side_effect_level,
        allowedSlotsJson: stringifyJsonField(input.allowed_slots) ?? "[]",
        source: input.source,
        sourceId: input.source_id ?? null,
        enabled: input.enabled ?? true,
        handlerType: input.handler_type,
        handlerJson: stringifyJsonField(input.handler) ?? "{}",
        accountId,
        workspaceId,
        createdAt: now,
        updatedAt: now,
      });

      return toDefinitionResponse(row);
    } catch (error) {
      throw this.mapWriteError(error, input.name);
    }
  }

  async getDefinition(
    id: string,
    accountId: string,
  ): Promise<ToolDefinitionResponse | null> {
    const workspaceId = this.resolveDefaultWorkspaceId(accountId);
    const row = await this.repo.getDefinitionById(id, accountId, workspaceId);
    return row ? toDefinitionResponse(row) : null;
  }

  async listDefinitions(
    query: ToolDefinitionQuery,
  ): Promise<{ definitions: ToolDefinitionResponse[]; total: number }> {
    const workspaceId = this.resolveDefaultWorkspaceId(query.accountId);
    const result = await this.repo.queryDefinitions({ ...query, workspaceId });
    return {
      definitions: result.definitions.map(toDefinitionResponse),
      total: result.total,
    };
  }

  async updateDefinition(
    id: string,
    accountId: string,
    input: UpdateDefinitionInput,
  ): Promise<ToolDefinitionResponse | null> {
    const workspaceId = this.resolveDefaultWorkspaceId(accountId);
    const existing = await this.repo.getDefinitionById(id, accountId, workspaceId);
    if (!existing) {
      return null;
    }

    const updates: Record<string, unknown> = {};

    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.parameters !== undefined) {
      updates.parametersJson = stringifyJsonField(input.parameters) ?? '{"type":"object","properties":{}}';
    }
    if (input.side_effect_level !== undefined) updates.sideEffectLevel = input.side_effect_level;
    if (input.allowed_slots !== undefined) {
      updates.allowedSlotsJson = stringifyJsonField(input.allowed_slots) ?? "[]";
    }
    if (input.source !== undefined) updates.source = input.source;
    if (input.source_id !== undefined) updates.sourceId = input.source_id;
    if (input.handler_type !== undefined) updates.handlerType = input.handler_type;
    if (input.handler !== undefined) {
      updates.handlerJson = stringifyJsonField(input.handler) ?? "{}";
    }

    if (Object.keys(updates).length === 0) {
      return toDefinitionResponse(existing);
    }

    try {
      await this.ensureDefinitionIdentityAvailable({
        accountId,
        name: input.name ?? existing.name,
        source: input.source ?? existing.source,
        sourceId: input.source_id !== undefined ? input.source_id ?? null : existing.sourceId,
        excludeId: id,
      });

      const row = await this.repo.updateDefinition(id, accountId, updates as any, workspaceId);
      return row ? toDefinitionResponse(row) : null;
    } catch (error) {
      throw this.mapWriteError(error, input.name ?? existing.name);
    }
  }

  async deleteDefinition(id: string, accountId: string): Promise<boolean> {
    const workspaceId = this.resolveDefaultWorkspaceId(accountId);
    return this.repo.deleteDefinition(id, accountId, workspaceId);
  }

  async toggleDefinition(
    id: string,
    accountId: string,
    enabled: boolean,
  ): Promise<ToolDefinitionResponse | null> {
    const workspaceId = this.resolveDefaultWorkspaceId(accountId);
    const row = await this.repo.toggleDefinition(id, accountId, enabled, workspaceId);
    return row ? toDefinitionResponse(row) : null;
  }

  // ── Call Records ──────────────────────────────────

  /**
   * 兼容读面。主审计真相源请优先使用 `queryExecutionRecords()` / `tool_execution_record`。
   */
  async queryCallRecords(query: ToolCallRecordQuery): Promise<{
    records: ToolCallRecordResponse[];
    total: number;
  }> {
    const result = await this.repo.queryCallRecords(query);
    return {
      records: result.records.map((r) => ({
        id: r.id,
        page_id: r.pageId,
        seq: r.seq,
        caller_slot: r.callerSlot,
        tool_name: r.toolName,
        args: parseJsonField(r.argsJson),
        result: parseJsonField(r.resultJson),
        status: r.status,
        duration_ms: r.durationMs,
        created_at: r.createdAt,
      })),
      total: result.total,
    };
  }

  async queryExecutionRecords(query: ToolExecutionRecordQuery): Promise<{
    records: ToolExecutionRecordResponse[];
    total: number;
  }> {
    // 主审计读面。deferred 执行的后台生命周期需结合 `runtime_job` 一起观察。
    const result = await this.executionRepo.query(query);
    return {
      records: result.records.map((record) => ({
        id: record.id,
        run_id: record.runId,
        floor_id: record.floorId,
        page_id: record.pageId ?? null,
        caller_slot: record.callerSlot,
        provider_id: record.providerId,
        provider_type: record.providerType ?? "unknown",
        tool_name: record.toolName,
        args: parseJsonField(record.argsJson),
        result: parseJsonField(record.resultJson),
        status: record.status,
        lifecycle_state: record.lifecycleState ?? "finished",
        commit_outcome: record.commitOutcome ?? "pending",
        side_effect_level: record.sideEffectLevel ?? null,
        error_message: record.errorMessage ?? null,
        delivery_mode: record.deliveryMode ?? "inline",
        duration_ms: record.durationMs,
        started_at: record.startedAt ?? record.createdAt,
        finished_at: record.finishedAt ?? null,
        attempt_no: record.attemptNo ?? 1,
        runtime_job_id: record.runtimeJobId ?? null,
        replay_parent_execution_id: record.replayParentExecutionId ?? null,
        created_at: record.createdAt,
      })),
      total: result.total,
    };
  }

  private async ensureDefinitionIdentityAvailable(input: {
    accountId: string;
    name: string;
    source: CreateDefinitionInput["source"];
    sourceId: string | null;
    excludeId?: string;
  }): Promise<void> {
    const existing = await this.repo.findDefinitionByIdentity({
      accountId: input.accountId,
      name: input.name,
      source: input.source,
      sourceId: input.sourceId,
      excludeId: input.excludeId,
    });

    if (existing) {
      throw new ToolServiceError("tool_definition_conflict", this.buildDefinitionConflictMessage(input.name));
    }
  }

  private mapWriteError(error: unknown, name?: string): ToolServiceError {
    if (error instanceof ToolServiceError) {
      return error;
    }

    const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
    if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT")) {
      return new ToolServiceError("tool_definition_conflict", this.buildDefinitionConflictMessage(name));
    }

    throw error;
  }

  private buildDefinitionConflictMessage(name?: string): string {
    return name ? `Tool definition already exists: ${name}` : "Tool definition already exists";
  }

  private resolveDefaultWorkspaceId(accountId: string): string {
    return new WorkspaceScopeService(this.db).getDefaultWorkspace(accountId).id;
  }
}

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
} from "../adapters/drizzle-tool-execution-repository.js";
import { DrizzleToolRepository } from "../adapters/drizzle-tool-repository.js";
import type {
  ToolDefinitionRow,
  ToolDefinitionQuery,
  ToolCallRecordQuery,
} from "../adapters/drizzle-tool-repository.js";
import type { AppDb } from "../db/client.js";
import { parseJsonField, stringifyJsonField } from "../lib/http.js";

// ── Types ───────────────────────────────────────────

export interface CreateDefinitionInput {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  side_effect_level: 'none' | 'sandbox' | 'irreversible';
  allowed_slots: string[];
  source: 'preset' | 'character' | 'custom';
  source_id?: string | null;
  enabled?: boolean;
  handler_type: 'script' | 'prompt' | 'delegate';
  handler: Record<string, unknown>;
}

export interface UpdateDefinitionInput {
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  side_effect_level?: 'none' | 'sandbox' | 'irreversible';
  allowed_slots?: string[];
  source?: 'preset' | 'character' | 'custom';
  source_id?: string | null;
  handler_type?: 'script' | 'prompt' | 'delegate';
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
  handler_type: string;
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
  started_at: number;
  finished_at: number | null;
  attempt_no: number;
  replay_parent_execution_id: string | null;
  created_at: number;
}

// ── Helpers ─────────────────────────────────────────

function toDefinitionResponse(row: ToolDefinitionRow): ToolDefinitionResponse {
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

  constructor(db: AppDb) {
    this.repo = new DrizzleToolRepository(db);
    this.executionRepo = new DrizzleToolExecutionRepository(db);
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
    const now = Date.now();
    const row = await this.repo.insertDefinition({
      id: nanoid(),
      name: input.name,
      description: input.description,
      parametersJson: stringifyJsonField(input.parameters) ?? '{"type":"object","properties":{}}',
      sideEffectLevel: input.side_effect_level,
      allowedSlotsJson: stringifyJsonField(input.allowed_slots) ?? '[]',
      source: input.source,
      sourceId: input.source_id ?? null,
      enabled: input.enabled ?? true,
      handlerType: input.handler_type,
      handlerJson: stringifyJsonField(input.handler) ?? '{}',
      accountId,
      createdAt: now,
      updatedAt: now,
    });

    return toDefinitionResponse(row);
  }

  async getDefinition(id: string): Promise<ToolDefinitionResponse | null> {
    const row = await this.repo.getDefinitionById(id);
    return row ? toDefinitionResponse(row) : null;
  }

  async listDefinitions(
    query: ToolDefinitionQuery,
  ): Promise<{ definitions: ToolDefinitionResponse[]; total: number }> {
    const result = await this.repo.queryDefinitions(query);
    return {
      definitions: result.definitions.map(toDefinitionResponse),
      total: result.total,
    };
  }

  async updateDefinition(
    id: string,
    input: UpdateDefinitionInput,
  ): Promise<ToolDefinitionResponse | null> {
    const updates: Record<string, unknown> = {};

    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.parameters !== undefined) {
      updates.parametersJson = stringifyJsonField(input.parameters) ?? '{"type":"object","properties":{}}';
    }
    if (input.side_effect_level !== undefined) updates.sideEffectLevel = input.side_effect_level;
    if (input.allowed_slots !== undefined) {
      updates.allowedSlotsJson = stringifyJsonField(input.allowed_slots) ?? '[]';
    }
    if (input.source !== undefined) updates.source = input.source;
    if (input.source_id !== undefined) updates.sourceId = input.source_id;
    if (input.handler_type !== undefined) updates.handlerType = input.handler_type;
    if (input.handler !== undefined) {
      updates.handlerJson = stringifyJsonField(input.handler) ?? '{}';
    }

    if (Object.keys(updates).length === 0) return this.getDefinition(id);

    const row = await this.repo.updateDefinition(id, updates as any);
    return row ? toDefinitionResponse(row) : null;
  }

  async deleteDefinition(id: string): Promise<boolean> {
    return this.repo.deleteDefinition(id);
  }

  async toggleDefinition(
    id: string,
    enabled: boolean,
  ): Promise<ToolDefinitionResponse | null> {
    const row = await this.repo.toggleDefinition(id, enabled);
    return row ? toDefinitionResponse(row) : null;
  }

  // ── Call Records ──────────────────────────────────

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
        duration_ms: record.durationMs,
        started_at: record.startedAt ?? record.createdAt,
        finished_at: record.finishedAt ?? null,
        attempt_no: record.attemptNo ?? 1,
        replay_parent_execution_id: record.replayParentExecutionId ?? null,
        created_at: record.createdAt,
      })),
      total: result.total,
    };
  }
}

import type { PromptRuntimeInspectResult } from "../../services/prompt-runtime/types.js";
import type {
  PromptRuntimeInjectionRecord,
  PromptRuntimeInjectionResolvedStateSummary,
} from "../../services/prompt-runtime/injection-service.js";
import type { PromptRuntimeInjectionTraceItem } from "../../services/prompt-runtime-injection-types.js";
import {
  mapMemoryInjectionResultToSnakeCase,
  mapPromptSnapshotToSnakeCase,
  mapPromptRuntimeHistoryNormalizationToSnakeCase,
  mapPromptRuntimeMemoryTraceToSnakeCase,
  mapRuntimeTraceToSnakeCase,
  type RuntimeTracePresentationOptions,
} from "../chat/presenters.js";
import { shouldRedactInjectionContent } from "../../services/prompt-runtime/injection-governance.js";
import { mapModeViewToSnakeCase } from "./mappers.js";

function toSnakeCaseName(value: string): string {
  return value.replace(/[A-Z]/g, (segment) => `_${segment.toLowerCase()}`);
}

function mapUnknownKeysToSnakeCase(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => mapUnknownKeysToSnakeCase(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      toSnakeCaseName(key),
      mapUnknownKeysToSnakeCase(item),
    ]),
  );
}

function mapScopeToSnakeCase(scope: PromptRuntimeInspectResult["scope"]): Record<string, unknown> {
  return {
    session_id: scope.sessionId,
    target_branch_id: scope.targetBranchId,
    branch_exists: scope.branchExists,
    source_floor_id: scope.sourceFloorId ?? null,
    history_source_branch_id: scope.historySourceBranchId,
    history_source_mode: scope.historySourceMode,
  };
}

function mapDiagnosticToSnakeCase(diagnostic: PromptRuntimeInspectResult["diagnostics"][number]): Record<string, unknown> {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    ...(diagnostic.source ? { source: diagnostic.source } : {}),
    ...(diagnostic.fieldPath ? { field_path: diagnostic.fieldPath } : {}),
    ...(diagnostic.phase ? { phase: diagnostic.phase } : {}),
  };
}

function mapSectionStatToSnakeCase(stat: PromptRuntimeInspectResult["sectionStats"][number]): Record<string, unknown> {
  return {
    section_name: stat.sectionName,
    token_count: stat.tokenCount,
  };
}

function mapTrimReasonToSnakeCase(reason: PromptRuntimeInspectResult["trimReasons"][number]): Record<string, unknown> {
  return {
    group: reason.group,
    reason: reason.reason,
    ...(reason.detail ? { detail: reason.detail } : {}),
    ...(reason.prunedTokenCount !== undefined ? { pruned_token_count: reason.prunedTokenCount } : {}),
  };
}

function mapExcludedSourceToSnakeCase(source: PromptRuntimeInspectResult["excludedSources"][number]): Record<string, unknown> {
  return {
    source: source.source,
    reason: source.reason,
    ...(source.detail ? { detail: source.detail } : {}),
  };
}

function mapContributorToSnakeCase(
  contributor: PromptRuntimeInspectResult["preparedTurn"]["contributors"][number],
): Record<string, unknown> {
  return {
    id: contributor.id,
    kind: contributor.kind,
    source_kind: contributor.sourceKind,
    mode_scope: contributor.modeScope,
    prompt_renderable: contributor.promptRenderable
      ? {
          title: contributor.promptRenderable.title,
          content: contributor.promptRenderable.content,
        }
      : null,
    deterministic: contributor.deterministic,
    cache_scope: contributor.cacheScope,
  };
}

function mapPreparePhaseTraceEntryToSnakeCase(
  entry: PromptRuntimeInspectResult["preparedTurn"]["preparePhaseTrace"][number],
): Record<string, unknown> {
  return {
    phase: entry.phase,
    detail: entry.detail ? mapUnknownKeysToSnakeCase(entry.detail) : null,
  };
}

function mapInjectionItemToSnakeCase(
  item: PromptRuntimeInjectionTraceItem,
  options?: RuntimeTracePresentationOptions,
): Record<string, unknown> {
  const redacted = shouldRedactInjectionContent(item.visibility, {
    includeRestrictedContent: options?.includeRestrictedInjectionContent === true,
  });
  return {
    request_index: item.requestIndex,
    source_kind: item.sourceKind,
    visibility: item.visibility,
    injection_id: item.injectionId ?? null,
    enabled: item.enabled ?? null,
    scope: item.scope,
    placement_requested: item.placementRequested,
    placement_params_requested: mapInjectionPlacementParamsToSnakeCase(item.placementParamsRequested),
    order_requested: item.orderRequested,
    title: redacted ? null : item.title,
    content_length: item.contentLength,
    token_count: item.tokenCount ?? null,
    budget_group: item.budgetGroup ?? null,
    budget_status: item.budgetStatus ?? null,
    applied: item.applied,
    placement_resolved: item.placementResolved ?? null,
    anchor_resolved: mapInjectionAnchorToSnakeCase(item.anchorResolved),
    source_chain: redacted ? null : mapInjectionSourceChainToSnakeCase(item.sourceChain),
    not_applied_reason: item.notAppliedReason ?? null,
    restricted: redacted,
  };
}

/**
 * I3 placement_params trace 转换：camelCase -> snake_case，不输出未声明字段。
 */
function mapInjectionPlacementParamsToSnakeCase(
  params: PromptRuntimeInjectionTraceItem["placementParamsRequested"] | undefined,
): Record<string, unknown> | null {
  if (!params) {
    return null;
  }
  return {
    ...(params.floorNo !== undefined ? { floor_no: params.floorNo } : {}),
   ...(params.offset !== undefined ? { offset: params.offset } : {}),
    ...(params.depth !== undefined ? { depth: params.depth } : {}),
  };
}

/**
 * I3 锚点 trace 转换：camelCase -> snake_case，不暴露内部数字 order。
 */
function mapInjectionAnchorToSnakeCase(
  anchor: PromptRuntimeInjectionTraceItem["anchorResolved"] | undefined,
): Record<string, unknown> | null {
  if (!anchor) {
    return null;
  }
  switch (anchor.kind) {
    case "section":
      return { kind: anchor.kind, internal_key: anchor.internalKey };
    case "floor_by_no":
      return {
        kind: anchor.kind,
        floor_no: anchor.floorNo,
        edge: anchor.edge,
        ...(anchor.resolvedDepth !== undefined ? { resolved_depth: anchor.resolvedDepth } : {}),
      };
    case "floor_from_end":
      return { kind: anchor.kind, offset: anchor.offset, edge: anchor.edge };
    case "worldbook_depth":
      return { kind: anchor.kind, depth: anchor.depth };
    case "worldbook_edge":
      return { kind: anchor.kind, edge: anchor.edge };
    case "worldbook_author_note_top":
      return { kind: anchor.kind };
    case "contributor_block":
      return { kind: anchor.kind, edge: anchor.edge };
    default:
      return null;
  }
}

/**
 * I3 来源链 trace 转换：camelCase -> snake_case。
 */
function mapInjectionSourceChainToSnakeCase(
  sourceChain: PromptRuntimeInjectionTraceItem["sourceChain"] | undefined,
): Record<string, unknown> | null {
  if (!sourceChain) {
    return null;
  }
  return {
    ...(sourceChain.agentTypeId !== undefined ? { agent_type_id: sourceChain.agentTypeId } : {}),
    ...(sourceChain.agentRunId !== undefined ? { agent_run_id: sourceChain.agentRunId } : {}),
    ...(sourceChain.temporaryConversationId !== undefined
      ? { temporary_conversation_id: sourceChain.temporaryConversationId }
      : {}),
    ...(sourceChain.debugSessionTag !== undefined ? { debug_session_tag: sourceChain.debugSessionTag } : {}),
  };
}

function mapPreparedTurnToSnakeCase(
  result: PromptRuntimeInspectResult["preparedTurn"],
  options?: RuntimeTracePresentationOptions,
): Record<string, unknown> {
  return {
    messages: result.messages,
    token_estimate: result.tokenEstimate,
    available_for_reply: result.availableForReply,
    preprocessed_user_message: result.preprocessedUserMessage ?? null,
    prompt_snapshot: result.promptSnapshot ? mapPromptSnapshotToSnakeCase(result.promptSnapshot) : null,
    runtime_trace: result.runtimeTrace ? mapRuntimeTraceToSnakeCase(result.runtimeTrace, options) : null,
    ...(result.memoryInjection ? { memory_injection: mapMemoryInjectionResultToSnakeCase(result.memoryInjection) } : {}),
    memory_summary: result.memorySummary ?? null,
    ...(result.memory ? { memory: mapPromptRuntimeMemoryTraceToSnakeCase(result.memory) } : {}),
    generation_params: mapUnknownKeysToSnakeCase(result.generationParams),
    requested_turn_config: result.requestedTurnConfig ? mapUnknownKeysToSnakeCase(result.requestedTurnConfig) : null,
    turn_config: result.turnConfig ? mapUnknownKeysToSnakeCase(result.turnConfig) : null,
    session_state_writes: {
      total: result.sessionStateWrites.total,
      writes: result.sessionStateWrites.writes.map((write) => ({
        namespace: write.namespace,
        slot: write.slot,
        operation: write.operation,
      })),
    },
    contributors: result.contributors.map((contributor) => mapContributorToSnakeCase(contributor)),
    prepare_phase_trace: result.preparePhaseTrace.map((entry) => mapPreparePhaseTraceEntryToSnakeCase(entry)),
  };
}

function mapGovernanceViewToSnakeCase(view: PromptRuntimeInspectResult["governance"]): Record<string, unknown> {
  return {
    entries: view.entries.map((entry) => ({
      source_kind: entry.sourceKind,
      declared_level: entry.declaredLevel ?? null,
      registered: entry.registered,
      effective_retention: entry.effectiveRetention,
      pinned: entry.pinned,
      prunable: entry.prunable,
      budget_groups: entry.budgetGroups,
      section_names: entry.sectionNames,
      token_count: entry.tokenCount,
      retained_token_count: entry.retainedTokenCount,
      pruned_token_count: entry.prunedTokenCount,
    })),
    mismatches: view.mismatches.map((mismatch) => ({
      code: mismatch.code,
      source_kind: mismatch.sourceKind,
      declared_level: mismatch.declaredLevel ?? null,
      effective_retention: mismatch.effectiveRetention,
      budget_groups: mismatch.budgetGroups,
      message: mismatch.message,
    })),
    limitations: view.limitations,
  };
}

function mapResolvedPolicyToSnakeCase(policy: PromptRuntimeInspectResult["policy"]): Record<string, unknown> {
  return mapUnknownKeysToSnakeCase(policy) as Record<string, unknown>;
}

function mapSourceMapToSnakeCase(sourceMap: PromptRuntimeInspectResult["sourceMap"]): Record<string, unknown> {
  return mapUnknownKeysToSnakeCase(sourceMap) as Record<string, unknown>;
}

export function mapPromptRuntimeInjectionRecordToSnakeCase(
  record: PromptRuntimeInjectionRecord,
): Record<string, unknown> {
  return {
    id: record.id,
    scope: record.scope,
    source_kind: record.sourceKind,
    title: record.title,
    content: record.content,
    placement: record.placement,
    placement_params: mapInjectionPlacementParamsToSnakeCase(record.placementParams ?? undefined),
    order: record.order,
    enabled: record.enabled,
    mode_scope: record.modeScope,
    ttl_ms: record.ttlMs,
    created_by: record.createdBy,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function mapPromptRuntimeInjectionSummaryToSnakeCase(
  summary: PromptRuntimeInjectionResolvedStateSummary,
): Record<string, unknown> {
  return {
    session: {
      total: summary.session.total,
      enabled: summary.session.enabled,
    },
    branch: {
      total: summary.branch.total,
      enabled: summary.branch.enabled,
    },
  };
}

export function mapPromptRuntimeInspectResultToSnakeCase(
  result: PromptRuntimeInspectResult,
  options?: RuntimeTracePresentationOptions,
): Record<string, unknown> {
  return {
    scope: mapScopeToSnakeCase(result.scope),
    mode: mapModeViewToSnakeCase(result.mode),
    policy: mapResolvedPolicyToSnakeCase(result.policy),
    source_map: mapSourceMapToSnakeCase(result.sourceMap),
    diagnostics: result.diagnostics.map((diagnostic) => mapDiagnosticToSnakeCase(diagnostic)),
    ...(result.historyNormalization ? { history_normalization: mapPromptRuntimeHistoryNormalizationToSnakeCase(result.historyNormalization) } : {}),
    trim_reasons: result.trimReasons.map((reason) => mapTrimReasonToSnakeCase(reason)),
    excluded_sources: result.excludedSources.map((source) => mapExcludedSourceToSnakeCase(source)),
    section_stats: result.sectionStats.map((stat) => mapSectionStatToSnakeCase(stat)),
    limitations: result.limitations,
    injections: (result.injections ?? []).map((item) => mapInjectionItemToSnakeCase(item, options)),
    injection_summary: buildInjectionSummary(result.injections ?? []),
    prepared_turn: mapPreparedTurnToSnakeCase(result.preparedTurn, options),
    governance: mapGovernanceViewToSnakeCase(result.governance),
  };
}

function buildInjectionSummary(
  items: NonNullable<PromptRuntimeInspectResult["injections"]>,
): Record<string, unknown> {
  const applied = items.filter((item) => item.applied);
  return {
    requested_count: items.length,
    applied_count: applied.length,
    rejected_count: items.length - applied.length,
    token_count: applied.reduce((sum, item) => sum + (item.tokenCount ?? 0), 0),
    budget_group: applied.find((item) => item.budgetGroup)?.budgetGroup ?? null,
  };
}

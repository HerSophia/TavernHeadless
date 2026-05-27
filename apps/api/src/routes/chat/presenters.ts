import type { FastifyReply, FastifyRequest } from "fastify";
import type { MemoryInjectionResult } from "@tavern/core";

import type { PromptRuntimeTrace, PromptSnapshotPreview, WorldbookMatchDetail } from "../../services/prompt-assembler.js";
import { ChatServiceError } from "../../services/chat/errors.js";
import { SessionStateServiceError } from "../../session-state/session-state-service.js";
import { sendError } from "../../lib/http.js";
import { findNativePipelineError } from "../../lib/native-pipeline-error.js";

export function mapUsageToSnakeCase(usage: { promptTokens: number; completionTokens: number; totalTokens: number }) {
  return {
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
  };
}

export function mapMemoryToSnakeCase(memory: { mode: "sync" | "async"; status: "applied" | "queued"; jobId?: string } | undefined) {
  if (!memory) {
    return undefined;
  }

  return {
    mode: memory.mode,
    status: memory.status,
    job_id: memory.jobId ?? null,
  };
}

export function mapPromptRuntimeHistoryNormalizationToSnakeCase(
  historyNormalization: NonNullable<PromptRuntimeTrace["historyNormalization"]>,
): Record<string, unknown> {
  return {
    raw_entry_count: historyNormalization.rawEntryCount,
    effective_turn_count: historyNormalization.effectiveTurnCount,
    selected_turn_count: historyNormalization.selectedTurnCount,
    trailing_user_source_floor_ids: historyNormalization.trailingUserSourceFloorIds,
    merged_user_groups: historyNormalization.mergedUserGroups.map((group) => ({
      effective_role: group.effectiveRole,
      source_floor_ids: group.sourceFloorIds,
      source_message_ids: group.sourceMessageIds,
      includes_current_input: group.includesCurrentInput,
    })),
    violations: historyNormalization.violations.map((violation) => ({
      code: violation.code,
      message: violation.message,
      source_floor_ids: violation.sourceFloorIds,
      source_message_ids: violation.sourceMessageIds,
    })),
  };
}

export function mapRunToSnakeCase(run: {
  floorId: string;
  runId: string;
  runType: string;
  status: string;
  phase: string;
  publicPhase: string;
  phaseSeq: number;
  attemptNo: number;
  startedAt: number;
  updatedAt: number;
  completedAt?: number | null;
  pendingOutput?: { tempId: string; attemptNo: number; state: string; text: string; startedAt: number; updatedAt: number; error?: string } | null;
  verifier?: { status: string; suggestion?: string; issues?: Array<{ description: string; severity: string }> } | null;
  error?: { code: string; message: string } | null;
}) {
  return {
    floor_id: run.floorId, run_id: run.runId, run_type: run.runType, status: run.status, phase: run.phase,
    public_phase: run.publicPhase, phase_seq: run.phaseSeq, attempt_no: run.attemptNo, started_at: run.startedAt,
    updated_at: run.updatedAt, completed_at: run.completedAt ?? null,
    pending_output: run.pendingOutput ? {
      temp_id: run.pendingOutput.tempId, attempt_no: run.pendingOutput.attemptNo, state: run.pendingOutput.state,
      text: run.pendingOutput.text, started_at: run.pendingOutput.startedAt, updated_at: run.pendingOutput.updatedAt,
      error: run.pendingOutput.error ?? null,
    } : null,
    verifier: run.verifier ? { status: run.verifier.status, suggestion: run.verifier.suggestion ?? null, issues: run.verifier.issues ?? null } : null,
    error: run.error ? { code: run.error.code, message: run.error.message } : null,
  };
}

export function mapPromptSnapshotToSnakeCase(promptSnapshot: PromptSnapshotPreview): Record<string, unknown> {
  return {
    preset_id: promptSnapshot.presetId,
    preset_updated_at: promptSnapshot.presetUpdatedAt,
    preset_version: promptSnapshot.presetVersion,
    preset_version_id: promptSnapshot.presetVersionId ?? null,
    preset_content_hash: promptSnapshot.presetContentHash ?? null,
    worldbook_id: promptSnapshot.worldbookId,
    worldbook_updated_at: promptSnapshot.worldbookUpdatedAt,
    worldbook_version: promptSnapshot.worldbookVersion,
    worldbook_version_id: promptSnapshot.worldbookVersionId ?? null,
    worldbook_content_hash: promptSnapshot.worldbookContentHash ?? null,
    regex_profile_id: promptSnapshot.regexProfileId,
    regex_profile_updated_at: promptSnapshot.regexProfileUpdatedAt,
    regex_profile_version: promptSnapshot.regexProfileVersion,
    regex_profile_version_id: promptSnapshot.regexProfileVersionId ?? null,
    regex_profile_content_hash: promptSnapshot.regexProfileContentHash ?? null,
    character_id: promptSnapshot.characterId ?? null,
    character_version_id: promptSnapshot.characterVersionId ?? null,
    character_imported_format: promptSnapshot.characterImportedFormat ?? null,
    character_content_hash: promptSnapshot.characterContentHash ?? null,
    worldbook_activated_entry_uids: promptSnapshot.worldbookActivatedEntryUids,
    worldbook_activated_entries: (promptSnapshot.worldbookActivatedEntries ?? []).map(mapPromptSnapshotWorldbookActivationToSnakeCase),
    regex_pre_rule_names: promptSnapshot.regexPreRuleNames,
    regex_post_rule_names: promptSnapshot.regexPostRuleNames,
    prompt_mode: promptSnapshot.promptMode,
    asset_manifest_digest: promptSnapshot.assetManifestDigest ?? null,
    prompt_digest: promptSnapshot.promptDigest,
    token_estimate: promptSnapshot.tokenEstimate,
  };
}

export function mapPromptRuntimeMemoryTraceToSnakeCase(
  memory: NonNullable<PromptRuntimeTrace["memory"]>,
): Record<string, unknown> {
  return {
    summary_injected: memory.summaryInjected,
    ...(memory.runtimeMode !== undefined ? { runtime_mode: memory.runtimeMode } : {}),
    ...(memory.requestedWrite !== undefined ? { requested_write: memory.requestedWrite } : {}),
    ...(memory.effectiveWrite !== undefined ? { effective_write: memory.effectiveWrite } : {}),
    ...(memory.strategy !== undefined ? { strategy: memory.strategy } : {}),
    ...(memory.summaryText !== undefined ? { summary_text: memory.summaryText } : {}),
    ...(memory.summaryTextHash !== undefined ? { summary_text_hash: memory.summaryTextHash } : {}),
    ...(memory.selectedItems
      ? {
          selected_items: memory.selectedItems.map((item) => ({
            memory_id: item.memoryId,
            scope: item.scope,
            scope_id: item.scopeId,
            branch_id: item.branchId ?? null,
            kind: item.kind,
            ...(item.source !== undefined ? { source: item.source } : {}),
            ...(item.score !== undefined ? { score: item.score } : {}),
            ...(item.tokenCount !== undefined ? { token_count: item.tokenCount } : {}),
            ...(item.selectedReason !== undefined ? { selected_reason: item.selectedReason } : {}),
          })),
        }
      : {}),
    ...(memory.tokenStats
      ? {
          token_stats: {
            budget: memory.tokenStats.budget ?? null,
            used: memory.tokenStats.used,
            micro_summary: memory.tokenStats.microSummary,
            macro_summary: memory.tokenStats.macroSummary,
            direct_items: memory.tokenStats.directItems,
          },
        }
      : {}),
    ...(memory.scopeResolution
      ? {
          scope_resolution: {
            mode: memory.scopeResolution.mode,
            ...(memory.scopeResolution.strict !== undefined ? { strict: memory.scopeResolution.strict } : {}),
            requested_scopes: memory.scopeResolution.requestedScopes,
            resolved_scopes: memory.scopeResolution.resolvedScopes,
            requested_branch_id: memory.scopeResolution.requestedBranchId ?? null,
            resolved_branch_id: memory.scopeResolution.resolvedBranchId ?? null,
            fallback_reason: memory.scopeResolution.fallbackReason ?? null,
          },
        }
      : {}),
    ...(memory.pageId ? { page_id: memory.pageId } : {}),
    ...(memory.proposalBatchId ? { proposal_batch_id: memory.proposalBatchId } : {}),
    ...(memory.proposalStatus ? { proposal_status: memory.proposalStatus } : {}),
    ...(memory.promotionStatus ? { promotion_status: memory.promotionStatus } : {}),
  };
}

export function mapRuntimeTraceToSnakeCase(runtimeTrace: PromptRuntimeTrace): Record<string, unknown> {
  return {
    ...(runtimeTrace.preset
      ? {
          preset: {
            selected_prompt_order_character_id: runtimeTrace.preset.selectedPromptOrderCharacterId,
            ignored_prompt_order_character_ids: runtimeTrace.preset.ignoredPromptOrderCharacterIds,
            unsupported_fields: runtimeTrace.preset.unsupportedFields,
            ignored_fields: runtimeTrace.preset.ignoredFields,
            unresolved_markers: runtimeTrace.preset.unresolvedMarkers,
            warnings: runtimeTrace.preset.warnings,
            trigger_filtered_entry_ids: runtimeTrace.preset.triggerFilteredEntryIds,
            in_chat_inserted_entry_ids: runtimeTrace.preset.inChatInsertedEntryIds,
            continue_nudge_applied: runtimeTrace.preset.continueNudgeApplied,
            continue_nudge_text: runtimeTrace.preset.continueNudgeText ?? null,
            names_behavior_applied: runtimeTrace.preset.namesBehaviorApplied ?? null,
          },
        }
      : {}),
    ...(runtimeTrace.worldbook
      ? {
          worldbook: {
            hit_count: runtimeTrace.worldbook.hitCount,
            ...(runtimeTrace.worldbook.matches
              ? {
                  matches: runtimeTrace.worldbook.matches.map(mapWorldbookMatchDetail),
                }
              : {}),
          },
        }
      : {}),
    ...(runtimeTrace.regex
      ? {
          regex: {
            user_input_rules: runtimeTrace.regex.userInputRules,
            ai_output_rules: runtimeTrace.regex.aiOutputRules,
            preprocessed_user_message: runtimeTrace.regex.preprocessedUserMessage ?? null,
            ...(runtimeTrace.regex.phases
              ? {
                  phases: runtimeTrace.regex.phases.map((phase) => mapRegexPhaseTraceToSnakeCase(phase)),
                }
              : {}),
            ...(runtimeTrace.regex.reservedPlacements
              ? {
                  reserved_placements: runtimeTrace.regex.reservedPlacements,
                }
              : {}),
            ...(runtimeTrace.regex.substitutionMode
              ? {
                  substitution_mode: runtimeTrace.regex.substitutionMode,
                }
              : {}),
          },
        }
      : {}),
    ...(runtimeTrace.budgets
      ? {
          budgets: {
            by_group: runtimeTrace.budgets.byGroup.map((item) => ({
              group: item.group,
              token_count: item.tokenCount,
              ...(item.estimatedTokenCount !== undefined ? { estimated_token_count: item.estimatedTokenCount } : {}),
              ...(item.allocatedTokenCount !== undefined ? { allocated_token_count: item.allocatedTokenCount } : {}),
              ...(item.prunedTokenCount !== undefined ? { pruned_token_count: item.prunedTokenCount } : {}),
            })),
            ...(runtimeTrace.budgets.trimReasons
              ? {
                  trim_reasons: runtimeTrace.budgets.trimReasons.map((item) => mapTrimReasonToSnakeCase(item)),
                }
              : {}),
          },
        }
      : {}),
    ...(runtimeTrace.structure
      ? {
          structure: {
            mode: runtimeTrace.structure.mode,
            merge_adjacent_same_role: runtimeTrace.structure.mergeAdjacentSameRole,
            assistant_rewrite_count: runtimeTrace.structure.assistantRewriteCount,
            assistant_rewrite_strategy: runtimeTrace.structure.assistantRewriteStrategy ?? null,
            tail_assistant_detected: runtimeTrace.structure.tailAssistantDetected,
            ...(runtimeTrace.structure.transcriptized !== undefined ? { transcriptized: runtimeTrace.structure.transcriptized } : {}),
            ...(runtimeTrace.structure.transcriptMessageCount !== undefined ? { transcript_message_count: runtimeTrace.structure.transcriptMessageCount } : {}),
            ...(runtimeTrace.structure.assistantPrefillTranscriptized !== undefined ? { assistant_prefill_transcriptized: runtimeTrace.structure.assistantPrefillTranscriptized } : {}),
          },
        }
      : {}),
    ...(runtimeTrace.memory ? { memory: mapPromptRuntimeMemoryTraceToSnakeCase(runtimeTrace.memory) } : {}),
    ...(runtimeTrace.macro
      ? {
          macro: {
            warnings: runtimeTrace.macro.warnings.map((warning) => ({
              code: warning.code,
              message: warning.message,
              ...(warning.macroName ? { macro_name: warning.macroName } : {}),
              ...(warning.rawText ? { raw_text: warning.rawText } : {}),
            })),
            used_names: runtimeTrace.macro.usedNames,
            mutation_preview: runtimeTrace.macro.mutationPreview.map((preview) => ({
              kind: preview.kind,
              scope: preview.scope,
              key: preview.key,
              ...(preview.value !== undefined ? { value: preview.value } : {}),
            })),
            staged_mutations: runtimeTrace.macro.stagedMutations.map((mutation) => ({
              kind: mutation.kind,
              scope: mutation.scope,
              key: mutation.key,
              ...(mutation.value !== undefined ? { value: mutation.value } : {}),
              source_macro: mutation.sourceMacro,
            })),
            traces: runtimeTrace.macro.traces.map((trace) => mapMacroTraceEntryToSnakeCase(trace)),
          },
        }
      : {}),
    ...(runtimeTrace.sourceSelection
      ? {
          source_selection: {
            excluded_sources: runtimeTrace.sourceSelection.excludedSources.map((item) => ({
              source: item.source,
              reason: item.reason,
              ...(item.detail ? { detail: item.detail } : {}),
            })),
          },
        }
      : {}),
    ...(runtimeTrace.delivery
      ? {
          delivery: {
            assistant_prefill_requested: runtimeTrace.delivery.assistantPrefillRequested,
            assistant_prefill_applied: runtimeTrace.delivery.assistantPrefillApplied,
            assistant_prefill_strategy: runtimeTrace.delivery.assistantPrefillStrategy ?? null,
            allow_assistant_prefill: runtimeTrace.delivery.allowAssistantPrefill,
            require_last_user: runtimeTrace.delivery.requireLastUser,
            no_assistant: runtimeTrace.delivery.noAssistant,
            last_message_role: runtimeTrace.delivery.lastMessageRole ?? null,
            ends_with_user: runtimeTrace.delivery.endsWithUser,
            degraded: runtimeTrace.delivery.degraded,
            degrade_reasons: runtimeTrace.delivery.degradeReasons,
          },
        }
      : {}),
    ...(runtimeTrace.visibility
      ? {
          visibility: {
            hidden_floor_ranges: runtimeTrace.visibility.hiddenFloorRanges?.map((range) => ({
              start_floor_no: range.startFloorNo,
              end_floor_no: range.endFloorNo,
            })),
            filtered_floor_nos: runtimeTrace.visibility.filteredFloorNos,
          },
        }
      : {}),
    ...(runtimeTrace.historyNormalization
      ? {
          history_normalization: mapPromptRuntimeHistoryNormalizationToSnakeCase(runtimeTrace.historyNormalization),
        }
      : {}),
  };
}

export function mapOptionalRuntimeTraceResponseField(runtimeTrace?: PromptRuntimeTrace): Record<string, unknown> {
  return runtimeTrace
    ? { runtime_trace: mapRuntimeTraceToSnakeCase(runtimeTrace) }
    : {};
}

function mapMemoryInjectionScopeRefToSnakeCase(scopeRef: { scope: string; scopeId: string }): Record<string, unknown> {
  return {
    scope: scopeRef.scope,
    scopeId: scopeRef.scopeId,
  };
}


export function mapMemoryInjectionResultToSnakeCase(memoryInjection: MemoryInjectionResult): Record<string, unknown> {
  return {
    items: memoryInjection.items.map((item) => ({
      id: item.id,
      scope: item.scope,
      scope_id: item.scopeId,
      type: item.type,
      summary_tier: item.summaryTier ?? null,
      content: item.content,
      fact_key: item.factKey ?? null,
      importance: item.importance,
      confidence: item.confidence,
      source_floor_id: item.sourceFloorId ?? null,
      source_message_id: item.sourceMessageId ?? null,
      status: item.status,
      token_count_estimate: item.tokenCountEstimate ?? null,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    })),
    formatted_text: memoryInjection.formattedText,
    token_count: memoryInjection.tokenCount,
    scope_resolution: memoryInjection.scopeResolution
      ? {
          mode: memoryInjection.scopeResolution.mode,
          strict: memoryInjection.scopeResolution.strict,
          ...(memoryInjection.scopeResolution.scopeRefs
            ? { scope_refs: memoryInjection.scopeResolution.scopeRefs.map((scopeRef) => mapMemoryInjectionScopeRefToSnakeCase(scopeRef)) }
            : {}),
          ...(memoryInjection.scopeResolution.explicitScope
            ? { explicit_scope: mapMemoryInjectionScopeRefToSnakeCase(memoryInjection.scopeResolution.explicitScope) }
            : {}),
          ...(memoryInjection.scopeResolution.fallbackScopeId !== undefined
            ? { fallback_scope_id: memoryInjection.scopeResolution.fallbackScopeId }
            : {}),
          ...(memoryInjection.scopeResolution.error
            ? {
                error: {
                  name: memoryInjection.scopeResolution.error.name,
                  message: memoryInjection.scopeResolution.error.message,
                },
              }
            : {}),
        }
      : null,
  };
}

export function mapOptionalPromptDebugResponseFields(payload: {
  promptSnapshot?: PromptSnapshotPreview;
  runtimeTrace?: PromptRuntimeTrace;
}): Record<string, unknown> {
  return {
    ...(payload.promptSnapshot ? { prompt_snapshot: mapPromptSnapshotToSnakeCase(payload.promptSnapshot) } : {}),
    ...mapOptionalRuntimeTraceResponseField(payload.runtimeTrace),
  };
}

function mapTrimReasonToSnakeCase(reason: NonNullable<NonNullable<PromptRuntimeTrace["budgets"]>["trimReasons"]>[number]): Record<string, unknown> {
  return {
    group: reason.group,
    reason: reason.reason,
    ...(reason.detail ? { detail: reason.detail } : {}),
    ...(reason.prunedTokenCount !== undefined ? { pruned_token_count: reason.prunedTokenCount } : {}),
  };
}

function mapRegexPhaseTraceToSnakeCase(phase: NonNullable<NonNullable<PromptRuntimeTrace["regex"]>["phases"]>[number]): Record<string, unknown> {
  return {
    phase_id: phase.phaseId,
    placement: phase.placement,
    channel: phase.channel,
    status: phase.status,
    changed: phase.changed,
    depth: phase.depth,
    input_text_hash: phase.inputTextHash,
    output_text_hash: phase.outputTextHash,
    candidate_rule_names: phase.candidateRuleNames,
    matched_rule_names: phase.matchedRuleNames,
    skipped_rules: phase.skippedRules.map((rule) => ({
      rule_name: rule.ruleName,
      reason: rule.reason,
    })),
  };
}

function mapMacroTraceEntryToSnakeCase(trace: NonNullable<PromptRuntimeTrace["macro"]>["traces"][number]): Record<string, unknown> {
  return {
    macro_name: trace.macroName,
    raw_text: trace.rawText,
    resolved_text: trace.resolvedText,
    ...(trace.phase ? { phase: trace.phase } : {}),
    ...(trace.sourceKind ? { source_kind: trace.sourceKind } : {}),
    ...(trace.selectedBranch ? { selected_branch: trace.selectedBranch } : {}),
  };
}

function mapPromptSnapshotWorldbookActivationToSnakeCase(
  activation: NonNullable<PromptSnapshotPreview["worldbookActivatedEntries"]>[number],
): Record<string, unknown> {
  return {
    uid: activation.uid,
    activation_key: activation.activationKey,
    source: {
      kind: activation.source.kind,
      worldbook_id: activation.source.worldbookId,
      worldbook_name: activation.source.worldbookName,
      asset_scope_id: activation.source.assetScopeId,
    },
    insertion: {
      position: activation.insertion.position,
      ...(activation.insertion.depth !== undefined ? { depth: activation.insertion.depth } : {}),
      ...(activation.insertion.role ? { role: activation.insertion.role } : {}),
      ...(activation.insertion.outletName ? { outlet_name: activation.insertion.outletName } : {}),
    },
  };
}

export function mapWorldbookMatchDetail(match: WorldbookMatchDetail): Record<string, unknown> {
  return {
    uid: match.uid,
    activation_key: match.activationKey,
    asset_scope_id: match.assetScopeId,
    comment: match.comment,
    content_preview: match.contentPreview,
    order: match.order,
    source: {
      kind: match.source.kind,
      worldbook_id: match.source.worldbookId,
      worldbook_name: match.source.worldbookName,
      asset_scope_id: match.source.assetScopeId,
    },
    insertion: {
      position: match.insertion.position,
      ...(match.insertion.depth !== undefined ? { depth: match.insertion.depth } : {}),
      ...(match.insertion.role ? { role: match.insertion.role } : {}),
      ...(match.insertion.outletName ? { outlet_name: match.insertion.outletName } : {}),
    },
    activation: {
      mode: match.activation.mode,
      recursion_level: match.activation.recursionLevel,
      first_match: match.activation.firstMatch
        ? {
            source_kind: match.activation.firstMatch.sourceKind,
            ...(match.activation.firstMatch.messageIndexFromLatest !== undefined
              ? { message_index_from_latest: match.activation.firstMatch.messageIndexFromLatest }
              : {}),
            ...(match.activation.firstMatch.injectionIndex !== undefined
              ? { injection_index: match.activation.firstMatch.injectionIndex }
              : {}),
            matched_key: match.activation.firstMatch.matchedKey,
            matched_key_scope: match.activation.firstMatch.matchedKeyScope,
            matched_key_type: match.activation.firstMatch.matchedKeyType,
            char_start: match.activation.firstMatch.charStart,
            char_end: match.activation.firstMatch.charEnd,
            excerpt: match.activation.firstMatch.excerpt,
          }
        : null,
    },
  };
}

export function mapChatServiceError(error: ChatServiceError): { statusCode: number; code: string; message: string } {
  if (error.cause instanceof SessionStateServiceError) {
    return {
      statusCode: error.cause.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  switch (error.code) {
    case "session_not_found":
      return { statusCode: 404, code: "not_found", message: error.message };
    case "session_archived":
      return { statusCode: 409, code: "session_archived", message: error.message };
    case "message_not_found":
    case "floor_not_found":
    case "source_floor_not_found":
      return { statusCode: 404, code: error.code, message: error.message };
    case "no_floor_to_regenerate":
    case "no_user_message":
      return { statusCode: 404, code: error.code, message: error.message };
    case "invalid_message_role":
    case "invalid_message_scope":
    case "invalid_tool_mode":
      return { statusCode: 400, code: error.code, message: error.message };
    case "invalid_state":
    case "generation_target_stale":
    case "branch_exists":
    case "branch_local_snapshot_missing":
      return { statusCode: 409, code: error.code, message: error.message };
    case "generation_cancelled":
      return { statusCode: 499, code: error.code, message: error.message };
    case "generation_conflict":
    case "commit_conflict":
      return { statusCode: 409, code: error.code, message: error.message };
    case "tool_replay_blocked":
    case "tool_replay_confirmation_required":
    case "replay_confirmation_required":
    case "session_state_replay_blocked":
    case "session_state_replay_confirmation_required":
    case "profile_not_found":
    case "tool_catalog_conflict":
    case "instance_slot_disabled_required":
    case "adjacent_assistant_floors":
    case "missing_effective_user_tail":
    case "profile_disabled":
      return { statusCode: 409, code: error.code, message: error.message };
    case "secret_unavailable":
    case "feature_unavailable":
    case "commit_busy":
    case "generation_queue_timeout":
      return { statusCode: 503, code: error.code, message: error.message };
    case "generation_timeout":
      return { statusCode: 504, code: error.code, message: error.message };
    case "secret_invalid_format":
    case "orchestration_failed":
    case "turn_commit_failed":
    case "session_state_stage_failed":
      return { statusCode: 500, code: error.code, message: error.message };
    default:
      return { statusCode: 500, code: "internal_error", message: error.message };
  }
}

export function handleChatError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  logNativePipelineError(error, request, "chat_route");

  if (!(error instanceof ChatServiceError)) {
    throw error;
  }

  const mapped = mapChatServiceError(error);
  return sendError(reply, mapped.statusCode, mapped.code, mapped.message, error.details);
}

export function logNativePipelineError(
  error: unknown,
  request: FastifyRequest,
  stage: "chat_route" | "respond_stream",
): void {
  const nativePipelineError = findNativePipelineError(error);
  if (!nativePipelineError) {
    return;
  }

  request.log.error(
    {
      request_id: request.id,
      route: request.routeOptions.url ?? request.url.split("?")[0] ?? "/",
      stage,
      error_code: "native_pipeline_failed",
      node_name: nativePipelineError.nodeName,
      input_summary: nativePipelineError.inputSummary,
      state_summary: nativePipelineError.stateSummary,
      err: error,
    },
    "native prompt pipeline failed",
  );
}

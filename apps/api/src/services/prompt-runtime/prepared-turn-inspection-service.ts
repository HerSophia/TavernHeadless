import { OwnedSessionRepository } from "../owned-resource-repositories.js";
import { resolvePromptRuntimeExecutionContext } from "../prompt-runtime-execution.js";
import type { AppDb } from "../../db/client.js";
import { parseJsonField } from "../../lib/http.js";

import { ChatServiceError } from "../chat/errors.js";
import { buildInspectionPromptRuntimeRequestPolicy } from "../chat/shared/request-policy.js";
import { normalizeBranchId } from "../chat/shared/branch.js";
import { ChatTargetResolver } from "../chat/target-resolver.js";
import { TurnModelService } from "../chat/turn-model-service.js";
import { TurnSessionStateService } from "../chat/turn-session-state-service.js";
import { FirstPartyStateContextService } from "../chat/first-party-state-context-service.js";
import { PreparedPromptArtifactsBuilder } from "../chat/prepared-prompt-artifacts-builder.js";

import { buildPromptRuntimeGovernanceView } from "./governance-view-builder.js";
import { resolvePromptModeDetails, type SessionMetadata } from "../prompt-assembler.js";
import type { PromptRuntimeInspectRequest, PromptRuntimeInspectResult } from "./types.js";
import { createUnmaterializedBranchInspectDiagnostic } from "./shared/diagnostics.js";
import { mapPromptRuntimeSessionStateWritesSummary } from "./shared/mappers.js";

export class PreparedTurnInspectionService {
  constructor(
    private readonly db: AppDb,
    private readonly targetResolver: ChatTargetResolver,
    private readonly modelService: TurnModelService,
    private readonly turnSessionStateService: TurnSessionStateService,
    private readonly firstPartyStateContextService: FirstPartyStateContextService,
    private readonly preparedPromptArtifactsBuilder: PreparedPromptArtifactsBuilder,
  ) {}

  async inspect(
    sessionId: string,
    request: PromptRuntimeInspectRequest,
    accountId: string,
  ): Promise<PromptRuntimeInspectResult> {
    const session = await new OwnedSessionRepository(this.db).getById(accountId, sessionId);
    if (!session) {
      throw new ChatServiceError("session_not_found", `Session '${sessionId}' not found`);
    }

    if (session.status === "archived") {
      throw new ChatServiceError("session_archived", "Cannot inspect prompt runtime in an archived session");
    }

    this.turnSessionStateService.assertTurnSessionStateWritesAvailable(request.sessionStateWrites);

    const branchId = normalizeBranchId(request.branchId);
    const resolvedTurnModels = await this.modelService.resolveTurnModelsForSession(sessionId, accountId);
    this.modelService.assertNarratorSlotEnabled(resolvedTurnModels);

    const branchContext = await this.targetResolver.resolveRespondBranchContext(
      sessionId,
      branchId,
      request.sourceFloorId,
      accountId,
    );
    const executionContext = resolvePromptRuntimeExecutionContext({
      sessionId,
      metadataJson: session.metadataJson,
      branchId,
      branchExists: branchContext.branchExists,
      historySourceBranchId: branchContext.historySourceBranchId,
      historySourceMode: branchContext.historySourceMode,
      sourceFloorId: branchContext.inheritanceSource?.floorId ?? request.sourceFloorId ?? null,
      request: buildInspectionPromptRuntimeRequestPolicy(request),
    });
    const firstPartyStateContext = this.firstPartyStateContextService.loadFirstPartyStateContext({
      accountId,
      sessionId,
      branchId,
      sourceFloorId: branchContext.inheritanceSource?.floorId ?? null,
      expectedSourceBranchId: branchContext.inheritanceSource?.branchId ?? null,
      resolutionMode: branchContext.inheritanceSource ? "source_floor" : "current_effective",
    });
    const sessionInfo = this.modelService.buildSessionPromptInfo(
      session,
      resolvedTurnModels,
      firstPartyStateContext,
      branchContext.assetBinding,
    );

    const prepared = await this.preparedPromptArtifactsBuilder.prepare({
      mode: "inspect",
      runType: "inspect",
      sessionId,
      branchId,
      accountId,
      session,
      rawUserMessage: request.message,
      regexChannel: "persist",
      request,
      executionContext,
      historyLoad: {
        branchId: branchContext.historySourceBranchId,
        beforeFloorNo: branchContext.nextFloorNo,
      },
      resolvedTurnModels,
      firstPartyStateContext,
      sessionInfo,
      extraDiagnostics: branchContext.branchExists
        ? []
        : [createUnmaterializedBranchInspectDiagnostic(branchId)],
      includeRuntimeTrace: true,
    });

    const governance = buildPromptRuntimeGovernanceView({
      assembled: prepared.assembled,
    });
    const modeDetails = resolvePromptModeDetails(
      { promptMode: session.promptMode ?? null },
      (() => {
        const metadata = parseJsonField(session.metadataJson);
        return metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as SessionMetadata)
          : {};
      })(),
    );
    const mode = {
      promptMode: modeDetails.promptMode,
      sessionPromptMode: modeDetails.sessionPromptMode,
      effectivePromptMode: modeDetails.effectivePromptMode,
      defaultPromptMode: modeDetails.defaultPromptMode,
      legacyFallback: modeDetails.legacyFallback,
      source: modeDetails.source,
    };

    return {
      scope: prepared.inspection.scope,
      mode,
      policy: prepared.executionContext.resolvedPolicy,
      sourceMap: prepared.inspection.sourceMap,
      diagnostics: prepared.inspection.diagnostics,
      trimReasons: prepared.inspection.trimReasons,
      historyNormalization: prepared.historyNormalization,
      excludedSources: prepared.inspection.excludedSources,
      sectionStats: prepared.inspection.sectionStats,
      limitations: [...prepared.inspection.limitations],
      preparedTurn: {
        messages: prepared.materialized.messages,
        tokenEstimate: prepared.tokenEstimate,
        availableForReply: prepared.availableForReply,
        preprocessedUserMessage: prepared.preprocessedUserMessage,
        promptSnapshot: prepared.promptSnapshot,
        runtimeTrace: prepared.runtimeTrace,
        memorySummary: prepared.memorySummary,
        generationParams: prepared.generationParams,
        requestedTurnConfig: prepared.requestedTurnConfig,
        turnConfig: prepared.turnConfig,
        sessionStateWrites: mapPromptRuntimeSessionStateWritesSummary(request.sessionStateWrites),
      },
      governance,
    };
  }
}

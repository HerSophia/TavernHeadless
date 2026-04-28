import { previewPromptMacroText, resolveEffectivePromptBudget } from "../prompt-assembler.js";
import {
  buildPromptRuntimeExecutionTrace,
  buildPromptRuntimePreviewTrace,
  resolvePromptRuntimeExecutionContext,
} from "../prompt-runtime-execution.js";
import { PROMPT_RUNTIME_PREVIEW_LIMITATIONS, type PromptRuntimeDiagnostic } from "../prompt-runtime-control-service.js";
import type { AppDb } from "../../db/client.js";
import { OwnedSessionRepository } from "../owned-resource-repositories.js";
import { VariableService } from "../variable-service.js";
import {
  BranchLocalSnapshotMissingError,
  BranchLocalVariableSnapshotService,
} from "../branch-local-variable-snapshot-service.js";

import type { PromptRuntimePreviewRequest, PromptRuntimePreviewResult } from "./contracts.js";
import { ChatServiceError } from "./errors.js";
import { ChatTargetResolver } from "./target-resolver.js";
import { PromptPreparationService } from "./prompt-preparation-service.js";
import { TurnModelService } from "./turn-model-service.js";
import { TurnMemoryService } from "./turn-memory-service.js";
import { normalizeBranchId } from "./shared/branch.js";

export class PromptRuntimePreviewService {
  constructor(
    private readonly db: AppDb,
    private readonly targetResolver: ChatTargetResolver,
    private readonly promptPreparationService: PromptPreparationService,
    private readonly modelService: TurnModelService,
    private readonly memoryService: TurnMemoryService,
  ) {}

  async run(
    sessionId: string,
    request: PromptRuntimePreviewRequest,
    accountId: string,
  ): Promise<PromptRuntimePreviewResult> {
    const session = await new OwnedSessionRepository(this.db).getById(accountId, sessionId);
    if (!session) {
      throw new ChatServiceError("session_not_found", `Session '${sessionId}' not found`);
    }

    if (session.status === "archived") {
      throw new ChatServiceError("session_archived", "Cannot preview prompt runtime in an archived session");
    }

    const branchId = normalizeBranchId(request.branchId);
    const branchContext = await this.targetResolver.resolveRespondBranchContext(sessionId, branchId, request.sourceFloorId);
    const executionContext = resolvePromptRuntimeExecutionContext({
      sessionId,
      metadataJson: session.metadataJson,
      branchId,
      branchExists: branchContext.branchExists,
      historySourceBranchId: branchContext.historySourceBranchId,
      historySourceMode: branchContext.historySourceMode,
      sourceFloorId: request.sourceFloorId ?? null,
      request,
    });
    const { history, visibilityTrace } = await this.promptPreparationService.loadPromptRuntimeHistoryWindow({
      sessionId,
      branchId: branchContext.historySourceBranchId,
      beforeFloorNo: branchContext.nextFloorNo,
      visibility: executionContext.resolvedPolicy.visibility,
      sourceSelection: executionContext.resolvedPolicy.sourceSelection,
    });
    const memorySummary = await this.memoryService.retrieveMemorySummary(sessionId, accountId, undefined, branchId);
    const resolvedTurnModels = await this.modelService.resolveTurnModelsForSession(sessionId, accountId);
    const narratorParams = this.modelService.getSlotGenerationParams(resolvedTurnModels, "narrator");
    const effectivePreviewBudget = resolveEffectivePromptBudget({
      budget: executionContext.effectivePolicy?.budget,
      maxContextTokensOverride: narratorParams?.maxContextTokens,
      maxOutputTokensOverride: narratorParams?.maxOutputTokens,
    });
    const sessionInfo = this.modelService.buildSessionPromptInfo(session, resolvedTurnModels);

    let variableState: Awaited<ReturnType<PromptRuntimePreviewService["resolvePromptRuntimePreviewVariables"]>>;
    try {
      variableState = await this.resolvePromptRuntimePreviewVariables({
        accountId,
        sessionId,
        branchId,
        branchExists: branchContext.branchExists,
        inheritanceSource: branchContext.inheritanceSource,
      });
    } catch (error) {
      this.rethrowBranchLocalSnapshotError(error);
    }

    const effectivePreviewMemorySummary = executionContext.resolvedPolicy.sourceSelection.memory.enabled
      ? memorySummary
      : undefined;
    const preview = previewPromptMacroText({
      session: sessionInfo,
      text: request.text,
      chatHistory: history.filter((message): message is { role: "user" | "assistant"; content: string } => (
        message.role === "user" || message.role === "assistant"
      )),
      ordinaryVariables: variableState.ordinaryVariables,
      localValues: variableState.localValues,
      globalValues: variableState.globalValues,
      memorySummary: effectivePreviewMemorySummary,
      maxPrompt: effectivePreviewBudget.maxInputTokens,
      runKind: "dry_run",
    });

    const inspection = await this.promptPreparationService.buildPromptRuntimeInspection({
      accountId,
      context: executionContext,
      phase: "preview",
      history,
      visibilityTrace,
      memorySummary: effectivePreviewMemorySummary,
      extraDiagnostics: branchContext.branchExists
        ? []
        : [{
            code: "unmaterialized_branch_preview",
            message: `Preview targeted unmaterialized branch '${branchId}'. Branch policy overlay is unavailable until the branch is materialized.`,
            severity: "info",
            source: "branch",
            phase: "preview",
          } satisfies PromptRuntimeDiagnostic],
    });
    const runtimeTrace = buildPromptRuntimePreviewTrace(
      buildPromptRuntimeExecutionTrace({
        inspection,
        visibilityTrace,
        baseRuntimeTrace: preview.runtimeTrace,
      }) ?? preview.runtimeTrace,
    );

    return {
      scope: inspection.scope,
      policy: executionContext.resolvedPolicy,
      sourceMap: inspection.sourceMap,
      diagnostics: inspection.diagnostics,
      limitations: [...inspection.limitations, ...PROMPT_RUNTIME_PREVIEW_LIMITATIONS],
      text: preview.text,
      runtimeTrace,
    };
  }

  private async resolvePromptRuntimePreviewVariables(args: {
    accountId: string;
    sessionId: string;
    branchId: string;
    branchExists: boolean;
    inheritanceSource?: { floorId: string; branchId: string };
  }): Promise<{
    ordinaryVariables: Record<string, unknown>;
    localValues: Record<string, import("../st-macros/index.js").StMacroJsonValue>;
    globalValues: Record<string, import("../st-macros/index.js").StMacroJsonValue>;
  }> {
    const variableService = new VariableService(this.db);

    if (args.branchExists) {
      const snapshot = await variableService.resolveSnapshot({
        accountId: args.accountId,
        sessionId: args.sessionId,
        branchId: args.branchId,
        includeLayers: true,
      });

      return {
        ordinaryVariables: Object.fromEntries(snapshot.resolved.map((item) => [item.key, item.value])),
        localValues: mapPromptRuntimePreviewVariableItems((snapshot.layers?.branch ?? snapshot.layers?.chat)?.items),
        globalValues: mapPromptRuntimePreviewVariableItems(snapshot.layers?.global?.items),
      };
    }

    const snapshot = await variableService.resolveSnapshot({
      accountId: args.accountId,
      sessionId: args.sessionId,
      includeLayers: true,
    });
    const globalValues = mapPromptRuntimePreviewVariableItems(snapshot.layers?.global?.items);

    if (args.inheritanceSource) {
      const localValues = toPromptRuntimePreviewJsonRecord(
        new BranchLocalVariableSnapshotService(this.db).requireSourceFloorLocalValues({
          accountId: args.accountId,
          sessionId: args.sessionId,
          sourceFloorId: args.inheritanceSource.floorId,
          sourceBranchId: args.inheritanceSource.branchId,
        }).values,
      );

      return {
        ordinaryVariables: { ...globalValues, ...localValues },
        localValues,
        globalValues,
      };
    }

    return {
      ordinaryVariables: Object.fromEntries(snapshot.resolved.map((item) => [item.key, item.value])),
      localValues: mapPromptRuntimePreviewVariableItems(snapshot.layers?.chat?.items),
      globalValues,
    };
  }

  private rethrowBranchLocalSnapshotError(error: unknown): never {
    if (error instanceof BranchLocalSnapshotMissingError) {
      throw new ChatServiceError(error.code, error.message, error, error.details);
    }

    throw error;
  }
}

function mapPromptRuntimePreviewVariableItems(
  items: Array<{ key: string; value: unknown }> | undefined,
): Record<string, import("../st-macros/index.js").StMacroJsonValue> {
  if (!items || items.length === 0) {
    return {};
  }

  return toPromptRuntimePreviewJsonRecord(Object.fromEntries(items.map((item) => [item.key, item.value])));
}

function toPromptRuntimePreviewJsonRecord(values: Record<string, unknown>): Record<string, import("../st-macros/index.js").StMacroJsonValue> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value as import("../st-macros/index.js").StMacroJsonValue]),
  );
}

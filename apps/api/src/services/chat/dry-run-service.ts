import { assemblePrompt, buildPromptAssemblyCompat } from "../prompt-assembler.js";
import { buildPromptRuntimeExecutionResult, resolvePromptRuntimeExecutionContext } from "../prompt-runtime-execution.js";
import type { AppDb } from "../../db/client.js";
import { OwnedSessionRepository } from "../owned-resource-repositories.js";

import type { DryRunRequest, DryRunResult } from "./contracts.js";
import { ChatServiceError } from "./errors.js";
import { PromptPreparationService } from "./prompt-preparation-service.js";
import { TurnModelService } from "./turn-model-service.js";
import { TurnMemoryService } from "./turn-memory-service.js";
import { RegexInputService } from "./regex-input-service.js";

export class DryRunService {
  constructor(
    private readonly db: AppDb,
    private readonly tokenCounter: import("@tavern/core").TokenCounter,
    private readonly promptPreparationService: PromptPreparationService,
    private readonly modelService: TurnModelService,
    private readonly memoryService: TurnMemoryService,
    private readonly regexInputService: RegexInputService,
  ) {}

  async run(
    sessionId: string,
    request: DryRunRequest,
    accountId: string,
  ): Promise<DryRunResult> {
    const session = await new OwnedSessionRepository(this.db).getById(accountId, sessionId);
    if (!session) {
      throw new ChatServiceError("session_not_found", `Session '${sessionId}' not found`);
    }

    if (session.status === "archived") {
      throw new ChatServiceError("session_archived", "Cannot dry-run in an archived session");
    }

    const executionContext = resolvePromptRuntimeExecutionContext({
      sessionId,
      metadataJson: session.metadataJson,
      branchId: "main",
      branchExists: true,
      historySourceBranchId: "main",
      historySourceMode: "existing_branch",
      request,
    });
    const { history, visibilityTrace } = await this.promptPreparationService.loadPromptRuntimeHistoryWindow({
      sessionId,
      branchId: "main",
      visibility: executionContext.resolvedPolicy.visibility,
      sourceSelection: executionContext.effectivePolicy?.sourceSelection,
    });
    const memorySummary = await this.memoryService.retrieveMemorySummary(sessionId, accountId, undefined, "main");
    const effectiveMemorySummary = executionContext.resolvedPolicy.sourceSelection.memory.enabled === false
      ? undefined
      : memorySummary;
    const resolvedTurnModels = await this.modelService.resolveTurnModelsForSession(sessionId, accountId);
    const assistantPrefillStrategy = this.modelService.resolveNarratorAssistantPrefillStrategy(resolvedTurnModels);
    const narratorParams = this.modelService.getSlotGenerationParams(resolvedTurnModels, "narrator");
    const maxContextTokensOverride = narratorParams?.maxContextTokens;
    const maxOutputTokensOverride = narratorParams?.maxOutputTokens;

    const sessionInfo = this.modelService.buildSessionPromptInfo(session, resolvedTurnModels);
    const persistedUserMessage = await this.regexInputService.applyPersistedUserInputRegex({
      accountId,
      sessionId,
      session,
      sessionInfo,
      rawUserMessage: request.message,
      regexChannel: "persist",
    });

    const assembled = await assemblePrompt(
      this.db,
      accountId,
      sessionInfo,
      history,
      persistedUserMessage,
      this.tokenCounter,
      effectiveMemorySummary,
      {
        includeDebug: true,
        maxContextTokensOverride,
        maxOutputTokensOverride,
        variableContext: { sessionId, branchId: "main" },
        intent: request.promptIntent,
        runKind: this.modelService.resolvePromptRunKind("dry_run"),
        includeWorldbookMatchTrace: request.debugOptions?.includeWorldbookMatches,
        assistantPrefillStrategy,
        budget: executionContext.effectivePolicy?.budget,
        sourceSelection: executionContext.effectivePolicy?.sourceSelection,
      },
    );

    const materialized = this.promptPreparationService.materializeTurnPromptMessages(
      assembled.messages,
      assembled.sendDirectives,
      assistantPrefillStrategy,
      executionContext.effectivePolicy?.structure,
      executionContext.effectivePolicy?.delivery,
    );

    const inspection = await this.promptPreparationService.buildPromptRuntimeInspection({
      accountId,
      context: executionContext,
      phase: "dry_run",
      history,
      visibilityTrace,
      memorySummary: effectiveMemorySummary,
      assembled,
      worldbookHitCount: assembled.runtimeTraceSeed.worldbookHits,
    });
    const execution = buildPromptRuntimeExecutionResult({
      tokenCounter: this.tokenCounter,
      userMessage: persistedUserMessage,
      includeRuntimeTrace: true,
      artifacts: {
        inspection,
        assembled,
        materialized,
        visibilityTrace,
      },
    });

    return {
      messages: materialized.messages,
      tokenEstimate: execution.tokenEstimate!,
      availableForReply: execution.availableForReply!,
      memorySummary: effectiveMemorySummary,
      promptSnapshot: execution.promptSnapshotPreview!,
      assembly: buildPromptAssemblyCompat({
        compatSeed: assembled.assemblyCompatSeed,
        traceSeed: assembled.runtimeTraceSeed,
        runtimeTrace: execution.runtimeTrace,
        preprocessedUserMessage: execution.preprocessedUserMessage,
      }),
      runtimeTrace: execution.runtimeTrace,
    };
  }
}

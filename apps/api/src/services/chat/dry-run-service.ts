import { assemblePrompt, buildPromptAssemblyCompat } from "../prompt-assembler.js";
import { buildPromptRuntimeExecutionResult, resolvePromptRuntimeExecutionContext } from "../prompt-runtime-execution.js";
import { buildPromptRuntimeMemoryTrace } from "../memory/shared/index.js";
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
    const resolvedTurnModels = await this.modelService.resolveTurnModelsForSession(sessionId, accountId);
    const requestedTurnConfig = this.modelService.resolveRequestedTurnConfig(undefined, resolvedTurnModels);
    const memoryWritePolicy = this.modelService.resolveMemoryWritePolicy(requestedTurnConfig);
    const memoryInjection = executionContext.resolvedPolicy.sourceSelection.memory.enabled === false
      ? undefined
      : await this.memoryService.retrieveMemoryInjection(sessionId, accountId, undefined, "main");
    const effectiveMemorySummary = memoryInjection?.memorySummary;
    const memoryRuntimeTrace = {
      ...memoryWritePolicy,
      ...(memoryInjection?.memoryTrace ?? {}),
      ...(!memoryInjection ? { strategy: "none" as const } : {}),
    };
    const memoryTrace = buildPromptRuntimeMemoryTrace({
      summaryInjected: Boolean(effectiveMemorySummary),
      memoryTrace: memoryRuntimeTrace,
    });
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
    const conversationState = await this.promptPreparationService.loadPromptRuntimeConversationWindow({
      sessionId,
      branchId: "main",
      visibility: executionContext.resolvedPolicy.visibility,
      sourceSelection: executionContext.effectivePolicy?.sourceSelection,
      currentInput: {
        content: persistedUserMessage.text,
      },
    });
    if (conversationState.historyNormalization.violations.length > 0) {
      throw new ChatServiceError(
        "adjacent_assistant_floors",
        "Cannot dry-run prompt runtime when consecutive assistant floors are present in the visible history.",
      );
    }
    if (!conversationState.effectiveUserMessage) {
      throw new ChatServiceError("missing_effective_user_tail", "Prompt runtime dry-run requires a trailing effective user turn.");
    }

    const assembled = await assemblePrompt(
      this.db,
      accountId,
      sessionInfo,
      conversationState.history,
      conversationState.effectiveUserMessage,
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
        memoryRuntimeTrace,
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
      history: conversationState.history,
      visibilityTrace: conversationState.visibilityTrace,
      memorySummary: effectiveMemorySummary,
      assembled,
      memoryTrace,
      historyNormalization: conversationState.historyNormalization,
      worldbookHitCount: assembled.runtimeTraceSeed.worldbookHits,
    });
    const execution = buildPromptRuntimeExecutionResult({
      tokenCounter: this.tokenCounter,
      userMessage: conversationState.effectiveUserMessage,
      includeRuntimeTrace: true,
      artifacts: {
        inspection,
        assembled,
        materialized,
        visibilityTrace: conversationState.visibilityTrace,
        ...(persistedUserMessage.runtimeTrace ? { baseRuntimeTrace: { regex: persistedUserMessage.runtimeTrace } } : {}),
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

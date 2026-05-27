import { assemblePrompt, buildPromptAssemblyCompat } from "../prompt-assembler.js";
import { buildPromptRuntimeExecutionResult, resolvePromptRuntimeExecutionContext } from "../prompt-runtime-execution.js";
import type { AppDb } from "../../db/client.js";
import { OwnedSessionRepository } from "../owned-resource-repositories.js";

import type { DryRunRequest, DryRunResult } from "./contracts.js";
import { ChatServiceError } from "./errors.js";
import { PromptPreparationService } from "./prompt-preparation-service.js";
import { TurnModelService } from "./turn-model-service.js";
import { RegexInputService } from "./regex-input-service.js";
import { PreparedPromptArtifactsBuilder } from "./prepared-prompt-artifacts-builder.js";

export class DryRunService {
  constructor(
    private readonly db: AppDb,
    private readonly tokenCounter: import("@tavern/core").TokenCounter,
    private readonly promptPreparationService: PromptPreparationService,
    private readonly modelService: TurnModelService,
    private readonly regexInputService: RegexInputService,
    private readonly preparedPromptArtifactsBuilder: PreparedPromptArtifactsBuilder,
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

    const prepared = await this.preparedPromptArtifactsBuilder.prepare({
      mode: "dry_run",
      runType: "dry_run",
      sessionId,
      branchId: "main",
      accountId,
      session,
      sessionInfo,
      rawUserMessage: request.message,
      regexChannel: "persist",
      request,
      executionContext,
      conversationWindow: conversationState,
      resolvedTurnModels,
      includeRuntimeTrace: true,
      baseRuntimeTrace: persistedUserMessage.runtimeTrace
        ? { regex: persistedUserMessage.runtimeTrace }
        : undefined,
    });

    const execution = buildPromptRuntimeExecutionResult({
      tokenCounter: this.tokenCounter,
      userMessage: prepared.userMessage,
      includeRuntimeTrace: true,
      artifacts: {
        inspection: prepared.inspection,
        assembled: prepared.assembled,
        materialized: prepared.materialized,
        visibilityTrace: prepared.visibilityTrace,
        ...(persistedUserMessage.runtimeTrace ? { baseRuntimeTrace: { regex: persistedUserMessage.runtimeTrace } } : {}),
      },
    });

    return {
      messages: prepared.materialized.messages,
      tokenEstimate: execution.tokenEstimate!,
      availableForReply: execution.availableForReply!,
      memory: prepared.memoryTrace,
      memorySummary: prepared.memorySummary,
      promptSnapshot: execution.promptSnapshotPreview!,
      assembly: buildPromptAssemblyCompat({
        compatSeed: prepared.assembled.assemblyCompatSeed,
        traceSeed: prepared.assembled.runtimeTraceSeed,
        runtimeTrace: execution.runtimeTrace,
        preprocessedUserMessage: execution.preprocessedUserMessage,
      }),
      runtimeTrace: execution.runtimeTrace,
    };
  }
}

import { createHash } from "node:crypto";

import type { ChatMessage, TokenCounter } from "@tavern/core";

import type { PromptVisibilityPolicy, PromptVisibilityTrace } from "./chat-history-loader.js";
import {
  buildPromptRuntimeBudgetTrace,
  buildPromptRuntimeTrace,
  buildPromptSnapshotPreview,
  buildPromptSnapshotRecord,
  type AssembleResult,
  type MaterializePromptRuntimeMessagesResult,
  type PromptBudgetPolicy,
  type PromptDeliveryPolicy,
  type PromptRuntimePreviewTrace as PromptRuntimePreviewTraceSurface,
  type PromptRuntimeTrace,
  type PromptSnapshotPreview,
  type PromptSourceSelectionPolicy,
  type PromptStructurePolicy,
} from "./prompt-assembler.js";
import { mergePromptRuntimeRegexTrace } from "./prompt-runtime/regex/index.js";
import {
  buildResolvedPromptRuntimePolicy,
  mergePromptRuntimePersistentPolicies,
  readPromptRuntimeBranchPersistentPolicy,
  readPromptRuntimePersistentPolicy,
  type PromptRuntimeHistorySourceMode,
  type PromptRuntimeInspectionResult,
  type PromptRuntimePersistentPolicy,
  type PromptRuntimeScopeRef,
  type ResolvedPromptRuntimePolicy,
} from "./prompt-runtime-control-service.js";

export interface PromptRuntimeExecutionInput {
  sessionId: string;
  metadataJson: string | null;
  branchId: string;
  branchExists: boolean;
  historySourceBranchId: string;
  historySourceMode: PromptRuntimeHistorySourceMode;
  sourceFloorId?: string | null;
  request?: {
    structure?: PromptStructurePolicy;
    delivery?: PromptDeliveryPolicy;
    budget?: PromptBudgetPolicy;
    sourceSelection?: PromptSourceSelectionPolicy;
    visibility?: PromptVisibilityPolicy;
  };
}

export interface PromptRuntimeResolvedContext {
  scope: PromptRuntimeScopeRef;
  sessionPersistentPolicy?: PromptRuntimePersistentPolicy;
  sessionPolicyWarnings: string[];
  branchPersistentPolicy?: PromptRuntimePersistentPolicy;
  branchPolicyWarnings: string[];
  requestPolicy?: PromptRuntimePersistentPolicy;
  effectivePolicy?: PromptRuntimePersistentPolicy;
  resolvedPolicy: ResolvedPromptRuntimePolicy;
}

export interface PromptRuntimeExecutionArtifacts {
  inspection: PromptRuntimeInspectionResult;
  assembled?: AssembleResult;
  materialized?: MaterializePromptRuntimeMessagesResult;
  visibilityTrace?: PromptVisibilityTrace;
  preprocessedUserMessage?: string;
  baseRuntimeTrace?: PromptRuntimeTrace;
}

export interface PromptRuntimeExecutionResult {
  tokenEstimate?: number;
  availableForReply?: number;
  preprocessedUserMessage?: string;
  promptSnapshotPreview?: PromptSnapshotPreview;
  promptSnapshotRecord?: ReturnType<typeof buildPromptSnapshotRecord>;
  runtimeTrace?: PromptRuntimeTrace;
}

export type PromptRuntimePreviewTrace = PromptRuntimePreviewTraceSurface;

interface PromptRuntimeExecutionUsageSummary {
  tokenEstimate: number;
  availableForReply: number;
}

interface PromptRuntimeExecutionPromptSnapshotArtifacts {
  snapshot: AssembleResult["promptSnapshot"];
  promptSnapshotPreview: PromptSnapshotPreview;
  promptSnapshotRecord?: ReturnType<typeof buildPromptSnapshotRecord>;
}


export function buildPromptRuntimeRequestPolicy(request?: {
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  budget?: PromptBudgetPolicy;
  sourceSelection?: PromptSourceSelectionPolicy;
  visibility?: PromptVisibilityPolicy;
}): PromptRuntimePersistentPolicy | undefined {
  if (!request?.structure && !request?.delivery && !request?.budget && !request?.sourceSelection && !request?.visibility) {
    return undefined;
  }

  return {
    ...(request.structure ? { structure: request.structure } : {}),
    ...(request.delivery ? { delivery: request.delivery } : {}),
    ...(request.budget ? { budget: request.budget } : {}),
    ...(request.sourceSelection ? { sourceSelection: request.sourceSelection } : {}),
    ...(request.visibility ? { visibility: request.visibility } : {}),
  };
}

export function resolvePromptRuntimeExecutionContext(
  input: PromptRuntimeExecutionInput,
): PromptRuntimeResolvedContext {
  const sessionPolicyState = readPromptRuntimePersistentPolicy(input.metadataJson);
  const branchPolicyState = input.branchExists
    ? readPromptRuntimeBranchPersistentPolicy(input.metadataJson, input.branchId)
    : {
        persistentPolicy: undefined,
        warnings: [] as string[],
      };
  const requestPolicy = buildPromptRuntimeRequestPolicy(input.request);
  const effectivePolicy = mergePromptRuntimePersistentPolicies(
    sessionPolicyState.persistentPolicy,
    branchPolicyState.persistentPolicy,
    requestPolicy,
  );

  return {
    scope: {
      sessionId: input.sessionId,
      targetBranchId: input.branchId,
      branchExists: input.branchExists,
      sourceFloorId: input.sourceFloorId ?? null,
      historySourceBranchId: input.historySourceBranchId,
      historySourceMode: input.historySourceMode,
    },
    sessionPersistentPolicy: sessionPolicyState.persistentPolicy,
    sessionPolicyWarnings: sessionPolicyState.warnings,
    branchPersistentPolicy: branchPolicyState.persistentPolicy,
    branchPolicyWarnings: branchPolicyState.warnings,
    requestPolicy,
    effectivePolicy,
    resolvedPolicy: buildResolvedPromptRuntimePolicy(
      sessionPolicyState.persistentPolicy,
      branchPolicyState.persistentPolicy,
      requestPolicy,
    ),
  };
}

export function buildPromptRuntimeExecutionTrace(
  artifacts: PromptRuntimeExecutionArtifacts,
): PromptRuntimeTrace | undefined {
  const budgetTrace = artifacts.assembled
    ? buildPromptRuntimeBudgetTrace({
        byGroup: artifacts.assembled.tokenUsage.byGroup,
        estimatedByGroup: artifacts.assembled.tokenUsage.allocator?.estimatedByGroup,
        allocatedByGroup: artifacts.assembled.tokenUsage.allocator?.allocatedByGroup,
        prunedByGroup: artifacts.assembled.tokenUsage.prunedByGroup,
        trimReasons: artifacts.inspection.trimReasons.length > 0 ? artifacts.inspection.trimReasons : undefined,
      })
    : undefined;
  const assembledTrace = artifacts.assembled?.runtimeTraceSeed
    ? buildPromptRuntimeTrace({
        traceSeed: artifacts.assembled.runtimeTraceSeed,
        preprocessedUserMessage: artifacts.preprocessedUserMessage,
      })
    : undefined;
  const visibilityTrace = toPromptRuntimeVisibilityTrace(artifacts.visibilityTrace);
  const mergedRegexTrace = mergePromptRuntimeRegexTrace(
    artifacts.baseRuntimeTrace?.regex,
    assembledTrace?.regex,
  );

  const trace: PromptRuntimeTrace = {
    ...(artifacts.baseRuntimeTrace ?? {}),
    ...(budgetTrace ? { budgets: budgetTrace } : {}),
    ...(artifacts.inspection.excludedSources.length > 0
      ? { sourceSelection: { excludedSources: artifacts.inspection.excludedSources } }
      : {}),
    ...(assembledTrace ?? {}),
    ...(mergedRegexTrace ? { regex: mergedRegexTrace } : {}),
    ...(artifacts.materialized?.structureTrace ? { structure: artifacts.materialized.structureTrace } : {}),
    ...(artifacts.materialized?.deliveryTrace ? { delivery: artifacts.materialized.deliveryTrace } : {}),
    ...(artifacts.inspection.historyNormalization ? { historyNormalization: artifacts.inspection.historyNormalization } : {}),
    ...(visibilityTrace ? { visibility: visibilityTrace } : {}),
  };

  return Object.keys(trace).length > 0 ? trace : undefined;
}

export function buildPromptRuntimePreviewTrace(runtimeTrace?: PromptRuntimeTrace): PromptRuntimePreviewTrace {
  if (!runtimeTrace) {
    return {};
  }

  return {
    ...(runtimeTrace.macro ? { macro: runtimeTrace.macro } : {}),
    ...(runtimeTrace.sourceSelection ? { sourceSelection: runtimeTrace.sourceSelection } : {}),
    ...(runtimeTrace.historyNormalization ? { historyNormalization: runtimeTrace.historyNormalization } : {}),
    ...(runtimeTrace.visibility ? { visibility: runtimeTrace.visibility } : {}),
  };
}

export function buildPromptRuntimeExecutionResult(args: {
  tokenCounter: TokenCounter;
  userMessage: string;
  floorId?: string;
  sessionId?: string;
  includeRuntimeTrace?: boolean;
  artifacts: PromptRuntimeExecutionArtifacts & {
    assembled: AssembleResult;
    materialized: MaterializePromptRuntimeMessagesResult;
  };
}): PromptRuntimeExecutionResult {
  const usageSummary = buildPromptRuntimeExecutionUsageSummary({
    tokenCounter: args.tokenCounter,
    assembled: args.artifacts.assembled,
    materialized: args.artifacts.materialized,
  });
  const preprocessedUserMessage = args.artifacts.preprocessedUserMessage
    ?? resolvePreprocessedUserMessage(args.artifacts.assembled, args.userMessage);
  const promptSnapshot = buildPromptRuntimeExecutionPromptSnapshot({
    assembled: args.artifacts.assembled,
    materialized: args.artifacts.materialized,
    tokenEstimate: usageSummary.tokenEstimate,
    floorId: args.floorId,
    sessionId: args.sessionId,
  });

  return {
    tokenEstimate: usageSummary.tokenEstimate,
    availableForReply: usageSummary.availableForReply,
    preprocessedUserMessage,
    promptSnapshotPreview: promptSnapshot.promptSnapshotPreview,
    ...(promptSnapshot.promptSnapshotRecord ? { promptSnapshotRecord: promptSnapshot.promptSnapshotRecord } : {}),
    ...(args.includeRuntimeTrace
      ? {
          runtimeTrace: buildPromptRuntimeExecutionTrace({
            ...args.artifacts,
            preprocessedUserMessage,
          }),
        }
      : {}),
  };
}

function buildPromptRuntimeExecutionUsageSummary(args: {
  tokenCounter: TokenCounter;
  assembled: AssembleResult;
  materialized: MaterializePromptRuntimeMessagesResult;
}): PromptRuntimeExecutionUsageSummary {
  const maxPromptTokens = args.assembled.tokenUsage.total + args.assembled.tokenUsage.availableForReply;
  const tokenEstimate = args.materialized.messages.reduce(
    (sum, message) => sum + args.tokenCounter.count(message.content),
    0,
  );

  return {
    tokenEstimate,
    availableForReply: Math.max(0, maxPromptTokens - tokenEstimate),
  };
}

function buildPromptRuntimeExecutionPromptSnapshot(args: {
  assembled: AssembleResult;
  materialized: MaterializePromptRuntimeMessagesResult;
  tokenEstimate: number;
  floorId?: string;
  sessionId?: string;
}): PromptRuntimeExecutionPromptSnapshotArtifacts {
  const snapshot = {
    ...args.assembled.promptSnapshot,
    promptDigest: createPromptDigestPreview(args.materialized.messages),
    tokenEstimate: args.tokenEstimate,
  };

  return {
    snapshot,
    promptSnapshotPreview: buildPromptSnapshotPreview(snapshot),
    ...(args.floorId && args.sessionId
      ? {
          promptSnapshotRecord: buildPromptSnapshotRecord({
            floorId: args.floorId,
            sessionId: args.sessionId,
            snapshot,
          }),
        }
      : {}),
  };
}

function resolvePreprocessedUserMessage(
  assembled: AssembleResult,
  userMessage: string,
): string | undefined {
  if (typeof assembled.runtimeTraceSeed.regexPromptUserInputText === "string") {
    return assembled.runtimeTraceSeed.regexPromptUserInputText;
  }

  return assembled.preProcess
    ? assembled.preProcess([{ role: "user", content: userMessage }])[0]?.content
    : userMessage;
}

function toPromptRuntimeVisibilityTrace(
  visibilityTrace?: PromptVisibilityTrace,
): PromptRuntimeTrace["visibility"] | undefined {
  if (!visibilityTrace) {
    return undefined;
  }

  const filteredFloorNos = visibilityTrace.filteredFloorNos ?? [];
  if (filteredFloorNos.length === 0 && !visibilityTrace.hiddenFloorRanges) {
    return undefined;
  }

  return {
    ...(visibilityTrace.hiddenFloorRanges ? { hiddenFloorRanges: visibilityTrace.hiddenFloorRanges } : {}),
    filteredFloorNos,
  };
}

function createPromptDigestPreview(messages: ChatMessage[]): string {
  const hash = createHash("sha256");
  for (const message of messages) {
    hash.update(message.role);
    hash.update("\u0000");
    hash.update(message.content);
    hash.update("\u0001");
  }
  return hash.digest("hex");
}

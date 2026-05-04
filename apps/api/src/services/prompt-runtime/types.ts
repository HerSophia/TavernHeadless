import type {
  ChatMessage,
  GenerationParams,
  PromptRunIntent,
  TurnConfig,
} from "@tavern/core";

import type { PromptVisibilityPolicy } from "../chat-history-loader.js";
import type {
  PromptBudgetPolicy,
  PromptDeliveryPolicy,
  PromptRuntimeTrace,
  PromptSnapshotPreview,
  PromptSourceExclusionReason,
  PromptSourceSelectionPolicy,
  PromptStructurePolicy,
  PromptTrimReason,
} from "../prompt-assembler.js";
import type {
  PromptRuntimeDiagnostic,
  PromptRuntimeGovernanceView as PromptRuntimeGovernanceViewModel,
  PromptRuntimeScopeRef,
  PromptRuntimeModeView,
  PromptRuntimeSectionStat,
  PromptRuntimeSourceMap,
  ResolvedPromptRuntimePolicy,
} from "./control-service.js";
import type {
  PromptLiveDebugOptions,
  TurnSessionStateWriteRequest,
} from "../chat/contracts.js";
import type { PromptRuntimeHistoryNormalizationSummary } from "../chat/conversation-history-normalizer.js";

export type {
  PromptRuntimeGovernanceEntry,
  PromptRuntimeGovernanceMismatch,
  PromptRuntimeGovernanceMismatchCode,
  PromptRuntimeGovernanceView,
  PromptRuntimeModeSource,
  PromptRuntimeModeView,
  PromptRuntimeCapabilityMode,
} from "./control-service.js";

export interface PromptRuntimeSessionStateWriteSummary {
  namespace: string;
  slot: string;
  operation: "set" | "delete";
}

export interface PromptRuntimeSessionStateWritesSummary {
  total: number;
  writes: PromptRuntimeSessionStateWriteSummary[];
}

export interface PromptRuntimeInspectionPreparedTurn {
  messages: ChatMessage[];
  tokenEstimate: number;
  availableForReply: number;
  preprocessedUserMessage?: string;
  promptSnapshot?: PromptSnapshotPreview;
  runtimeTrace?: PromptRuntimeTrace;
  memorySummary?: string;
  generationParams: GenerationParams;
  requestedTurnConfig?: TurnConfig;
  turnConfig?: TurnConfig;
  sessionStateWrites: PromptRuntimeSessionStateWritesSummary;
}

export interface PromptRuntimeInspectRequest {
  message: string;
  branchId?: string;
  sourceFloorId?: string;
  promptIntent?: PromptRunIntent;
  config?: TurnConfig;
  generationParams?: Partial<GenerationParams>;
  sessionStateWrites?: TurnSessionStateWriteRequest[];
  debugOptions?: PromptLiveDebugOptions;
  visibility?: PromptVisibilityPolicy;
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  budget?: PromptBudgetPolicy;
  sourceSelection?: PromptSourceSelectionPolicy;
}

export interface PromptRuntimeInspectResult {
  scope: PromptRuntimeScopeRef;
  mode: PromptRuntimeModeView;
  policy: ResolvedPromptRuntimePolicy;
  sourceMap: PromptRuntimeSourceMap;
  diagnostics: PromptRuntimeDiagnostic[];
  trimReasons: PromptTrimReason[];
  excludedSources: PromptSourceExclusionReason[];
  historyNormalization?: PromptRuntimeHistoryNormalizationSummary;
  sectionStats: PromptRuntimeSectionStat[];
  limitations: string[];
  preparedTurn: PromptRuntimeInspectionPreparedTurn;
  governance: PromptRuntimeGovernanceViewModel;
}

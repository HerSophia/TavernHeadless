import type {
  ChatMessage,
  GenerationParams,
  PromptRunIntent,
  TurnConfig,
} from "@tavern/core";

import type { PromptVisibilityPolicy } from "../chat-history-loader.js";
import type { GenerationParamsInput } from "../../lib/llm-params.js";
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
import type {
  PreparedPromptArtifactsPhaseTraceEntry,
  PromptRuntimeContributorView,
} from "../chat/types.js";

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
  preprocessedUserMessage?: string | null;
  promptSnapshot?: PromptSnapshotPreview | null;
  runtimeTrace?: PromptRuntimeTrace | null;
  memoryInjection?: import("@tavern/core").MemoryInjectionResult;
  memory?: PromptRuntimeTrace["memory"];
  memorySummary?: string | null;
  generationParams: GenerationParams;
  requestedTurnConfig?: TurnConfig | null;
  turnConfig?: TurnConfig | null;
  sessionStateWrites: PromptRuntimeSessionStateWritesSummary;
  contributors: PromptRuntimeContributorView[];
  preparePhaseTrace: PromptRuntimeInspectionPreparePhaseTraceEntry[];
}

export interface PromptRuntimeInspectionPreparePhaseTraceEntry {
  phase: PreparedPromptArtifactsPhaseTraceEntry["phase"];
  detail?: Record<string, unknown> | null;
}

export interface PromptRuntimeInspectRequest {
  message: string;
  branchId?: string;
  sourceFloorId?: string;
  promptIntent?: PromptRunIntent;
  config?: TurnConfig;
  generationParams?: GenerationParamsInput;
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

import type {
  PresetDetail,
  PresetEditorDetail,
  PresetEditorDocument,
  PresetEditorEntry,
  PresetEditorOrderContext,
  RegenerateResult,
  RespondGenerationParams,
  TavernRespondStreamEvent,
  TavernRespondToolPayload,
  RespondResult,
  WorldbookDetail,
} from "@tavern/sdk";

export type WorkspaceSession = {
  account: string;
  archived: boolean;
  characterName: string;
  id: string;
  title: string;
  userName: string;
  worldbookCount: number;
  worldbookProfileId: string | null;
};

export type WorkspaceMessageRole = "assistant" | "narrator" | "system" | "user";

export type WorkspaceAssetKind = "character" | "preset" | "user" | "worldbook";

export type WorkspaceLibraryAsset = {
  createdAt: number;
  id: string;
  kind: WorkspaceAssetKind;
  name: string;
  source: string;
  status?: string;
  updatedAt: number;
  version?: number;
};

export type WorkspaceAssetImportInput = {
  fileName: string;
  kind: WorkspaceAssetKind;
  payload: unknown;
};

export type WorkspaceAssetImportResult = {
  id: string;
  kind: WorkspaceAssetKind;
  name: string;
  source: string;
};

export type WorkspacePresetAssetDetail = PresetDetail;

export type WorkspaceWorldbookAssetDetail = WorldbookDetail;

export type WorkspacePresetEditorEntry = PresetEditorEntry;

export type WorkspacePresetEditorOrderContext = PresetEditorOrderContext;

export type WorkspacePresetEditorDocument = PresetEditorDocument;

export type WorkspacePresetEditorDetail = PresetEditorDetail;

export type WorkspaceCharacterAssetSnapshot = {
  name: string;
} & Record<string, unknown>;

export type WorkspaceCharacterAssetDetail = {
  createdAt: number;
  deletedAt: number | null;
  id: string;
  latestVersionId: string | null;
  latestVersionNo: number | null;
  name: string;
  snapshot: WorkspaceCharacterAssetSnapshot | null;
  source: string;
  status: "active" | "deleted" | string;
  updatedAt: number;
};

export type WorkspaceCharacterVersionResult = {
  createdAt: number;
  id: string;
  snapshot: WorkspaceCharacterAssetSnapshot;
  versionNo: number;
};

export type WorkspaceTimelineMessage = {
  at: number;
  content: string;
  contentFormat: "json" | "markdown" | "text";
  floorState: string;
  floorId: string;
  floorNo: number;
  id: string;
  pageId: string;
  role: WorkspaceMessageRole;
  seq: number;
  tokenIn: number;
  tokenOut: number;
};

export type WorkspaceMessageUpdateResult = {
  content: string;
  id: string;
  role: WorkspaceMessageRole;
};

export type WorkspaceRespondResult = Pick<
  RespondResult,
  | "branchId"
  | "finalState"
  | "floorId"
  | "floorNo"
  | "generatedText"
  | "inputTokens"
  | "outputTokens"
  | "summaries"
  | "totalUsage"
  | "totalTokens"
>;

export type WorkspaceRegenerateResult = Pick<
  RegenerateResult,
  | "branchId"
  | "finalState"
  | "floorId"
  | "floorNo"
  | "generatedText"
  | "inputTokens"
  | "outputTokens"
  | "summaries"
  | "sourceFloorId"
  | "sourceMessageId"
  | "totalUsage"
  | "totalTokens"
>;

export type WorkspaceGenerationParams = RespondGenerationParams;

export type StreamStartPayload = {
  branch_id?: string;
  floor_id?: string;
  floor_no?: number;
};

export type WorkspaceRespondToolPayload = TavernRespondToolPayload;

export type WorkspaceRespondStreamEvent = TavernRespondStreamEvent;

export type WorkspaceToolReplaySafety = "safe" | "confirm_on_replay" | "never_auto_replay" | "uncertain";

export type WorkspaceReplayBlockingExecution = {
  errorMessage?: string;
  executionId: string;
  lifecycleState: string | null;
  providerId: string;
  providerType: string | null;
  reason: string;
  replaySafety: WorkspaceToolReplaySafety;
  sideEffectLevel: string | null;
  status: string;
  toolName: string;
};

export type StreamRespondOptions = {
  accountId?: string;
  generationParams?: WorkspaceGenerationParams;
  onChunk?: (chunk: string) => void;
  onDone?: (result: WorkspaceRespondResult) => void;
  onEvent?: (event: WorkspaceRespondStreamEvent) => void;
  onError?: (message: string) => void;
  onStart?: (payload: StreamStartPayload) => void;
  onSummary?: (summaries: string[]) => void;
  onTool?: (payload: WorkspaceRespondToolPayload) => void;
  signal?: AbortSignal;
};

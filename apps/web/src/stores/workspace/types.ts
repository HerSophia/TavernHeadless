import type {
  WorkspaceCharacterAssetSnapshot,
  WorkspaceMessageRole,
  WorkspacePresetEditorDocument,
  WorkspaceRespondResult,
  WorkspaceReplayBlockingExecution,
  WorkspaceReplayBlockingSessionStateMutation,
  WorkspaceRegenerateResult
} from "../../lib/workspace-api";

export type WorkspaceLocale = "zh" | "en";

export type LocalizedTitle = {
  en: string;
  zh: string;
};

export type SessionState = {
  account: string;
  archived: boolean;
  characterName: string;
  id: string;
  title: LocalizedTitle;
  userName: string;
  worldbookProfileId: string | null;
  worldbookCount: number;
};

export type TimelineMessage = {
  at: number;
  contentFormat: "json" | "markdown" | "text";
  content: string;
  floorId?: string;
  floorNo?: number;
  floorState?: string;
  id: string;
  latencyMs?: number;
  pageId?: string;
  persisted: boolean;
  role: WorkspaceMessageRole;
  seq: number;
  source: "local" | "remote";
  streaming?: boolean;
  tokens?: number;
};

export type WorkspaceAssetKind = "character" | "preset" | "user" | "worldbook";

export type WorkspaceAsset = {
  account: string;
  favorite: boolean;
  id: string;
  kind: WorkspaceAssetKind;
  name: string;
  summary: string;
  tags: string[];
  updatedAt: number;
  uses: number;
};

export type AssetApplyResult = {
  asset: WorkspaceAsset | null;
  bindingChanged: boolean;
  ok: boolean;
  reason?: "missing" | "no_session";
};

export type AssetFavoriteResult = {
  asset: WorkspaceAsset | null;
  ok: boolean;
};

export type LibraryHydrationResult = {
  apiSyncFailed: boolean;
  count: number;
};

export type LibraryImportFailure = {
  assetName?: string;
  fileName: string;
  message?: string;
  reason: "api" | "duplicate_batch" | "duplicate_existing";
};

export type LibraryImportDuplicatePolicy = "allow" | "skip";

export type LibraryImportProgress = {
  currentFile: string;
  failed: number;
  imported: number;
  phase: "done" | "hydrating" | "importing" | "preparing";
  processed: number;
  skipped: number;
  total: number;
};

export type WorkspaceAssetImportEntry = {
  fileName: string;
  payload: unknown;
};

export type LibraryImportOptions = {
  duplicatePolicy?: LibraryImportDuplicatePolicy;
  onProgress?: (progress: LibraryImportProgress) => void;
};

export type LibraryImportResult = {
  apiSyncFailed: boolean;
  failed: number;
  imported: number;
  ok: boolean;
  reason?: "empty";
  skipped: number;
  failures: LibraryImportFailure[];
};

export type PresetAssetDetail = {
  createdAt: number;
  editor: WorkspacePresetEditorDocument;
  id: string;
  name: string;
  source: string;
  updatedAt: number;
  version: number;
};

export type PresetAssetDetailResult = {
  detail: PresetAssetDetail | null;
  ok: boolean;
  reason?: "failed" | "missing" | "unsupported";
};

export type PresetAssetSaveMode = "duplicate" | "update";

export type PresetAssetMutationResult = {
  apiSyncFailed: boolean;
  asset: WorkspaceAsset | null;
  deleteSyncFailed: boolean;
  ok: boolean;
  reason?: "failed" | "missing" | "preset_conflict" | "resource_busy" | "unsupported";
};

export type PresetAssetDeleteResult = Omit<PresetAssetMutationResult, "asset">;

export type WorldbookAssetDetail = {
  createdAt: number;
  data: Record<string, unknown>;
  id: string;
  name: string;
  source: string;
  updatedAt: number;
  version: number;
};

export type WorldbookAssetDetailResult = {
  detail: WorldbookAssetDetail | null;
  ok: boolean;
  reason?: "failed" | "missing" | "unsupported";
};

export type WorldbookAssetSaveMode = "duplicate" | "update";

export type WorldbookAssetMutationResult = {
  apiSyncFailed: boolean;
  asset: WorkspaceAsset | null;
  ok: boolean;
  reason?: "failed" | "missing" | "resource_busy" | "unsupported" | "worldbook_conflict";
};

export type CharacterAssetDetail = {
  createdAt: number;
  deletedAt: number | null;
  id: string;
  latestVersionNo: number | null;
  name: string;
  snapshot: WorkspaceCharacterAssetSnapshot;
  source: string;
  status: "active" | "deleted" | string;
  updatedAt: number;
};

export type CharacterAssetDetailResult = {
  detail: CharacterAssetDetail | null;
  ok: boolean;
  reason?: "failed" | "missing" | "unsupported";
};

export type CharacterAssetMutationResult = {
  apiSyncFailed: boolean;
  asset: WorkspaceAsset | null;
  ok: boolean;
  reason?: "failed" | "missing" | "unsupported";
};

export type SendMessageResult = {
  latencyMs: number;
  timelineSyncFailed: boolean;
  localFallback: boolean;
  ok: boolean;
  streamFallback: boolean;
  result?: WorkspaceRespondResult;
  tokens: number;
  reason?: "empty" | "failed" | "guarded" | "no_session";
};

export type HydrateWorkspaceResult = {
  sessionSyncFailed: boolean;
  timelineSyncFailed: boolean;
  librarySyncFailed: boolean;
};

export type MessageMutationResult = {
  apiSyncFailed: boolean;
  message: TimelineMessage | null;
  ok: boolean;
  reason?: "empty" | "failed" | "guarded" | "missing" | "unsupported";
};

export type RegenerateFromMessageResult = {
  apiSyncFailed: boolean;
  blockingExecutions?: WorkspaceReplayBlockingExecution[];
  blockingSessionStateMutations?: WorkspaceReplayBlockingSessionStateMutation[];
  ok: boolean;
  reason?: "blocked" | "confirmation_required" | "empty" | "failed" | "guarded" | "missing" | "unsupported";
  result?: WorkspaceRegenerateResult;
};

export type UpdateOrDeleteResult = MessageMutationResult;

export type TimelineHydrationResult = {
  apiSyncFailed: boolean;
  count: number;
};

export type MessageBucketLocation = {
  bucket: TimelineMessage[];
  index: number;
};

export type SessionResponse = {
  character_binding: {
    snapshot_summary: {
      has_greeting: boolean;
      name: string;
    } | null;
  } | null;
  created_at: number;
  id: string;
  status: "active" | "archived";
  title: string | null;
  updated_at: number;
  user_binding: {
    snapshot_summary: {
      name: string;
    } | null;
  } | null;
  worldbook_profile_id?: string | null;
};

export type RespondResponse = {
  data?: {
    branch_id?: string;
    floor_id?: string;
    floor_no?: number;
    generated_text?: string;
    total_usage?: {
      completion_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
      prompt_tokens?: number;
      total_tokens?: number;
    };
  };
};

export type StreamStartPayload = {
  branch_id?: string;
  floor_id?: string;
  floor_no?: number;
};

export type StreamChunkPayload = {
  chunk?: string;
};

export type StreamSummaryPayload = {
  summaries?: string[];
};

export type StreamDonePayload = {
  floor_id?: string;
  floor_no?: number;
  generated_text?: string;
  total_usage?: {
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

export type StreamErrorPayload = {
  code?: string;
  message?: string;
};

export type TimelineMessageResponse = {
  content: string;
  content_format: "json" | "markdown" | "text" | string;
  id: string;
  role: string;
  seq: number;
};

export type TimelineFloorResponse = {
  active_page: {
    id: string;
    messages: TimelineMessageResponse[];
    page_kind: string;
    page_no: number;
    version: number;
  } | null;
  created_at: number;
  floor_no: number;
  id: string;
  page_count: number;
  state: string;
  token_in: number;
  token_out: number;
};

export type TimelineResponse = {
  data?: {
    branch_id?: string;
    floors?: TimelineFloorResponse[];
    session_id?: string;
  };
};

export type MessageResponse = {
  content: string;
  content_format: "json" | "markdown" | "text";
  created_at: number;
  id: string;
  is_hidden: boolean;
  page_id: string;
  role: "assistant" | "narrator" | "system" | "user";
  seq: number;
  source: string | null;
  token_count: number;
};

export type MessageMutationResponse = {
  data?: MessageResponse;
};

export type ResourceListItemResponse = {
  created_at: number;
  id: string;
  name: string;
  source: string;
  updated_at: number;
};

export type ResourceListResponse = {
  data?: ResourceListItemResponse[];
};

export type ResourceDetailResponse = {
  data?: {
    created_at: number;
    data: unknown;
    id: string;
    name: string;
    source: string;
    updated_at: number;
  };
};

export type PresetEditorResponse = {
  data?: {
    created_at: number;
    editor: {
      default_character_id: number;
      entries: Array<{
        identifier: string;
        name: string;
        role: "assistant" | "system" | "user";
        content: string;
        system_prompt: boolean;
        marker: boolean;
        injection_position: number;
        injection_depth?: number;
        injection_order?: number;
        forbid_overrides?: boolean;
        injection_trigger?: unknown[];
        enabled: boolean;
        extra?: Record<string, unknown>;
      }>;
      format: "legacy-compact" | "st-raw";
      order_contexts: Array<{
        character_id: number;
        order: Array<{ identifier: string; enabled: boolean }>;
        extra?: Record<string, unknown>;
      }>;
      top_level: Record<string, unknown>;
    };
    id: string;
    name: string;
    source: string;
    updated_at: number;
  };
};

export type PresetUpdateResponse = { data?: ResourceListItemResponse };

export type CharacterVersionResponse = {
  character_id: string;
  content_hash: string;
  created_at: number;
  id: string;
  snapshot: unknown;
  version_no: number;
};

export type CharacterDetailResponse = {
  data?: {
    created_at: number;
    deleted_at: number | null;
    id: string;
    latest_version: CharacterVersionResponse | null;
    latest_version_no: number | null;
    name: string;
    source: string;
    status: "active" | "deleted" | string;
    updated_at: number;
  };
};

export type CharacterVersionMutationResponse = {
  data?: CharacterVersionResponse;
};

export type CharacterListItemResponse = {
  created_at: number;
  id: string;
  name: string;
  source: string;
  status: string;
  updated_at: number;
};

export type CharacterListResponse = {
  data?: CharacterListItemResponse[];
};

export type UserListResponse = {
  data?: Array<{ created_at: number; id: string; name: string; status: string; updated_at: number }>;
};

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
};

export type WorkspaceAssetImportInput = { fileName: string; kind: WorkspaceAssetKind; payload: unknown };
export type WorkspaceAssetImportResult = { id: string; kind: WorkspaceAssetKind; name: string; source: string };

export type WorkspacePresetAssetDetail = {
  createdAt: number;
  data: Record<string, unknown>;
  id: string;
  name: string;
  source: string;
  updatedAt: number;
};

export type WorkspaceWorldbookAssetDetail = {
  createdAt: number;
  data: Record<string, unknown>;
  id: string;
  name: string;
  source: string;
  updatedAt: number;
};

export type WorkspacePresetEditorEntry = {
  identifier: string;
  name: string;
  role: "assistant" | "system" | "user";
  content: string;
  systemPrompt: boolean;
  marker: boolean;
  injectionPosition: number;
  injectionDepth?: number;
  injectionOrder?: number;
  forbidOverrides?: boolean;
  injectionTrigger?: unknown[];
  enabled: boolean;
  extra: Record<string, unknown>;
};

export type WorkspacePresetEditorOrderContext = {
  characterId: number;
  order: Array<{ identifier: string; enabled: boolean }>;
  extra: Record<string, unknown>;
};

export type WorkspacePresetEditorDocument = {
  format: "legacy-compact" | "st-raw";
  defaultCharacterId: number;
  entries: WorkspacePresetEditorEntry[];
  orderContexts: WorkspacePresetEditorOrderContext[];
  topLevel: Record<string, unknown>;
};

export type WorkspacePresetEditorDetail = {
  createdAt: number;
  editor: WorkspacePresetEditorDocument;
  id: string;
  name: string;
  source: string;
  updatedAt: number;
};

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
  contentFormat: "json" | "markdown" | "text";
  content: string;
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

export type UsagePayload = NonNullable<RespondResponse["data"]>["total_usage"];

export type WorkspaceRegenerateResult = {
  branchId?: string;
  floorId: string;
  floorNo: number;
  totalTokens: number;
};

export type WorkspaceMessageUpdateResult = Pick<MessageResponse, "content" | "id" | "role">;

export type WorkspaceRespondResult = {
  floorId: string;
  floorNo: number;
  generatedText: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type WorkspaceGenerationParams = {
  frequencyPenalty?: number;
  maxOutputTokens?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  stream?: boolean;
  temperature?: number;
  topK?: number;
  topP?: number;
};

export type StreamRespondOptions = {
  accountId?: string;
  generationParams?: WorkspaceGenerationParams;
  onChunk?: (chunk: string) => void;
  onDone?: (result: WorkspaceRespondResult) => void;
  onError?: (message: string) => void;
  onStart?: (payload: StreamStartPayload) => void;
  onSummary?: (summaries: string[]) => void;
  signal?: AbortSignal;
};

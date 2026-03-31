import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  }
);

export const accountUsers = sqliteTable(
  "account_user",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    name: text("name").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    status: text("status", { enum: ["active", "disabled", "deleted"] }).notNull().default("active"),
    revision: integer("revision").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    accountUpdatedIdx: index("account_user_account_updated_idx").on(table.accountId, table.updatedAt),
    accountNameUnique: uniqueIndex("account_user_account_name_uq").on(table.accountId, table.name),
  })
);

export const characters = sqliteTable(
  "character",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    source: text("source").notNull().default("sillytavern"),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    status: text("status", { enum: ["active", "deleted"] }).notNull().default("active"),
    deletedAt: integer("deleted_at"),
    revision: integer("revision").notNull().default(0),
    latestVersionNo: integer("latest_version_no").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    accountUpdatedIdx: index("character_account_updated_idx").on(table.accountId, table.updatedAt),
  })
);

export const characterVersions = sqliteTable(
  "character_version",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    dataJson: text("data_json").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    characterVersionUnique: uniqueIndex("character_version_character_no_uq").on(table.characterId, table.versionNo),
    characterCreatedAtIdx: index("character_version_character_created_idx").on(table.characterId, table.createdAt),
  })
);

export const sessions = sqliteTable("session", {
  id: text("id").primaryKey(),
  title: text("title"),
  characterId: text("character_id").references(() => characters.id, { onDelete: "set null" }),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
  characterVersionId: text("character_version_id").references(() => characterVersions.id, { onDelete: "set null" }),
  characterSnapshotJson: text("character_snapshot_json"),
  characterSyncPolicy: text("character_sync_policy", { enum: ["pin", "manual", "force"] }).notNull().default("pin"),
  userId: text("user_id").references(() => accountUsers.id, { onDelete: "set null" }),
  userSnapshotJson: text("user_snapshot_json"),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  presetId: text("preset_id"),
  regexProfileId: text("regex_profile_id"),
  worldbookProfileId: text("worldbook_profile_id"),
  modelProvider: text("model_provider"),
  modelName: text("model_name"),
  modelParamsJson: text("model_params_json"),
  promptMode: text("prompt_mode", { enum: ["compat_strict", "compat_plus", "native"] }),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const floors = sqliteTable(
  "floor",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    floorNo: integer("floor_no").notNull(),
    branchId: text("branch_id").notNull().default("main"),
    parentFloorId: text("parent_floor_id"),
    state: text("state", { enum: ["draft", "generating", "committed", "failed"] })
      .notNull()
      .default("draft"),
    metadataJson: text("metadata_json"),
    tokenIn: integer("token_in").notNull().default(0),
    tokenOut: integer("token_out").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => ({
    sessionFloorBranchUnique: uniqueIndex("floor_session_no_branch_uq").on(
      table.sessionId,
      table.floorNo,
      table.branchId
    ),
    floorHistoryLookupIdx: index("floor_session_branch_state_no_idx").on(
      table.sessionId, table.branchId, table.state, table.floorNo
    )
  })
);

export const messagePages = sqliteTable(
  "message_page",
  {
    id: text("id").primaryKey(),
    floorId: text("floor_id").notNull().references(() => floors.id, { onDelete: "cascade" }),
    pageNo: integer("page_no").notNull(),
    pageKind: text("page_kind", { enum: ["input", "output", "mixed"] }).notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
    checksum: text("checksum"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => ({
    floorPageVersionUnique: uniqueIndex("message_page_floor_no_version_uq").on(
      table.floorId,
      table.pageNo,
      table.version
    ),
    floorActivePageIdx: index("message_page_floor_active_no_idx").on(
      table.floorId, table.isActive, table.pageNo
    )
  })
);

export const messages = sqliteTable(
  "message",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id").notNull().references(() => messagePages.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role", { enum: ["user", "assistant", "system", "narrator"] }).notNull(),
    content: text("content").notNull(),
    contentFormat: text("content_format", { enum: ["text", "markdown", "json"] })
      .notNull()
      .default("text"),
    tokenCount: integer("token_count").notNull().default(0),
    isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
    source: text("source"),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    pageSeqUnique: uniqueIndex("message_page_seq_uq").on(table.pageId, table.seq),
    pageVisibleSeqIdx: index("message_page_hidden_seq_idx").on(
      table.pageId, table.isHidden, table.seq
    )
  })
);

export const variables = sqliteTable(
  "variable",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    scope: text("scope", { enum: ["global", "chat", "floor", "page"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    key: text("key").notNull(),
    valueJson: text("value_json").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => ({
    accountScopeScopeIdKeyUnique: uniqueIndex("variable_account_scope_scope_id_key_uq").on(
      table.accountId,
      table.scope,
      table.scopeId,
      table.key
    ),
    accountScopeScopeIdUpdatedIdx: index("variable_account_scope_scope_id_updated_idx").on(
      table.accountId,
      table.scope,
      table.scopeId,
      table.updatedAt
    ),
    accountScopeUpdatedIdx: index("variable_account_scope_updated_idx").on(
      table.accountId,
      table.scope,
      table.updatedAt
    )
  })
);

export const memoryItems = sqliteTable(
  "memory_item",
  {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: ["global", "chat", "floor"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    type: text("type", { enum: ["fact", "summary", "open_loop"] }).notNull(),
    summaryTier: text("summary_tier", { enum: ["micro", "macro"] }),
    contentJson: text("content_json").notNull(),
    factKey: text("fact_key"),
    importance: real("importance").notNull().default(0.5),
    confidence: real("confidence").notNull().default(1),
    sourceFloorId: text("source_floor_id"),
    sourceMessageId: text("source_message_id"),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    status: text("status", { enum: ["active", "deprecated"] }).notNull().default("active"),
    lifecycleStatus: text("lifecycle_status", { enum: ["active", "compacted", "deprecated"] }).notNull().default("active"),
    sourceJobId: text("source_job_id"),
    tokenCountEstimate: integer("token_count_estimate"),
    lastUsedAt: integer("last_used_at"),
    coverageStartFloorNo: integer("coverage_start_floor_no"),
    coverageEndFloorNo: integer("coverage_end_floor_no"),
    derivedFromCount: integer("derived_from_count"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    accountScopeIdx: index("memory_item_account_scope_idx").on(table.accountId, table.scope, table.scopeId),
    factLookupIdx: index("memory_item_fact_lookup_idx").on(table.accountId, table.scope, table.scopeId, table.type, table.status, table.factKey),
    accountScopeLifecycleTypeUpdatedIdx: index("memory_item_account_scope_lifecycle_type_updated_idx").on(
      table.accountId,
      table.scope,
      table.scopeId,
      table.lifecycleStatus,
      table.type,
      table.updatedAt,
    ),
    accountScopeSummaryTierLifecycleIdx: index("memory_item_account_scope_summary_tier_lifecycle_idx").on(
      table.accountId,
      table.scope,
      table.scopeId,
      table.summaryTier,
      table.lifecycleStatus,
      table.updatedAt,
    ),
  })
);

export const memoryEdges = sqliteTable(
  "memory_edge",
  {
    id: text("id").primaryKey(),
    fromId: text("from_id").notNull().references(() => memoryItems.id, { onDelete: "cascade" }),
    toId: text("to_id").notNull().references(() => memoryItems.id, { onDelete: "cascade" }),
    relation: text("relation", { enum: ["supports", "contradicts", "updates", "derived_from", "compacts", "resolves"] }).notNull(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    accountIdx: index("memory_edge_account_idx").on(table.accountId),
  })
);

export const memoryScopeStates = sqliteTable(
  "memory_scope_state",
  {
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
    scope: text("scope", { enum: ["global", "chat", "floor"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    revision: integer("revision").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseUntil: integer("lease_until"),
    lastProcessedFloorNo: integer("last_processed_floor_no"),
    lastCompactionAt: integer("last_compaction_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    accountScopeScopeIdUnique: uniqueIndex("memory_scope_state_account_scope_scope_id_uq").on(
      table.accountId,
      table.scope,
      table.scopeId,
    ),
    leaseIdx: index("memory_scope_state_lease_idx").on(table.leaseUntil),
  })
);

export const memoryJobs = sqliteTable(
  "memory_job",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
    scope: text("scope", { enum: ["global", "chat", "floor"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    jobType: text("job_type", { enum: ["ingest_turn", "compact_macro", "maintenance", "rebuild_scope"] }).notNull(),
    status: text("status", { enum: ["pending", "leased", "running", "retry_waiting", "succeeded", "dead_letter", "cancelled"] }).notNull().default("pending"),
    floorId: text("floor_id").references(() => floors.id, { onDelete: "set null" }),
    basedOnRevision: integer("based_on_revision"),
    payloadJson: text("payload_json").notNull().default("{}"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: integer("available_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseUntil: integer("lease_until"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => ({
    statusAvailableIdx: index("memory_job_status_available_idx").on(table.status, table.availableAt),
    accountScopeStatusAvailableIdx: index("memory_job_account_scope_status_available_idx").on(
      table.accountId,
      table.scope,
      table.scopeId,
      table.status,
      table.availableAt,
    ),
    accountScopeCreatedIdx: index("memory_job_account_scope_created_idx").on(
      table.accountId,
      table.scope,
      table.scopeId,
      table.createdAt,
    ),
  })
);

export const chatTransferJobs = sqliteTable(
  "chat_transfer_job",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
    jobKind: text("job_kind", { enum: ["import_chat", "export_chat"] }).notNull(),
    format: text("format", { enum: ["thchat", "sillytavern_jsonl", "st_jsonl"] }),
    status: text("status", { enum: ["pending", "leased", "running", "retry_waiting", "succeeded", "dead_letter", "cancelled"] }).notNull().default("pending"),
    phase: text("phase", { enum: ["queued", "parsing", "normalizing", "publishing", "snapshotting", "rendering", "writing_artifact", "finalizing", "completed"] }).notNull().default("queued"),
    requestedSessionId: text("requested_session_id").references(() => sessions.id, { onDelete: "set null" }),
    resultSessionId: text("result_session_id").references(() => sessions.id, { onDelete: "set null" }),
    requestJson: text("request_json").notNull().default("{}"),
    resultJson: text("result_json"),
    inputArtifactPath: text("input_artifact_path"),
    normalizedArtifactPath: text("normalized_artifact_path"),
    outputArtifactPath: text("output_artifact_path"),
    outputExpiresAt: integer("output_expires_at"),
    progressCurrent: integer("progress_current").notNull().default(0),
    progressTotal: integer("progress_total"),
    progressMessage: text("progress_message"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: integer("available_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseUntil: integer("lease_until"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => ({
    statusAvailableIdx: index("chat_transfer_job_status_available_idx").on(table.status, table.availableAt),
    accountStatusAvailableIdx: index("chat_transfer_job_account_status_available_idx").on(
      table.accountId,
      table.status,
      table.availableAt,
    ),
    accountJobKindCreatedIdx: index("chat_transfer_job_account_kind_created_idx").on(
      table.accountId,
      table.jobKind,
      table.createdAt,
    ),
    accountRequestedSessionCreatedIdx: index("chat_transfer_job_account_requested_session_created_idx").on(table.accountId, table.requestedSessionId, table.createdAt),
    outputExpiresIdx: index("chat_transfer_job_output_expires_idx").on(table.outputExpiresAt),
  })
);

export const runtimeScopeStates = sqliteTable(
  "runtime_scope_state",
  {
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
    scopeType: text("scope_type").notNull(),
    scopeKey: text("scope_key").notNull(),
    revision: integer("revision").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseUntil: integer("lease_until"),
    lastProcessedAt: integer("last_processed_at"),
    lastSuccessJobId: text("last_success_job_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    accountScopeUnique: uniqueIndex("runtime_scope_state_account_scope_uq").on(
      table.accountId,
      table.scopeType,
      table.scopeKey,
    ),
    leaseIdx: index("runtime_scope_state_lease_idx").on(table.leaseUntil),
  })
);

export const runtimeJobs = sqliteTable(
  "runtime_job",
  {
    id: text("id").primaryKey(),
    jobType: text("job_type").notNull(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
    scopeType: text("scope_type").notNull(),
    scopeKey: text("scope_key").notNull(),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    floorId: text("floor_id").references(() => floors.id, { onDelete: "set null" }),
    pageId: text("page_id").references(() => messagePages.id, { onDelete: "set null" }),
    status: text("status", { enum: ["pending", "leased", "running", "retry_waiting", "succeeded", "dead_letter", "cancelled"] }).notNull().default("pending"),
    phase: text("phase"),
    payloadJson: text("payload_json").notNull().default("{}"),
    stateJson: text("state_json"),
    resultJson: text("result_json"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: integer("available_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    leaseOwner: text("lease_owner"),
    leaseUntil: integer("lease_until"),
    basedOnRevision: integer("based_on_revision"),
    dedupeKey: text("dedupe_key"),
    progressCurrent: integer("progress_current").notNull().default(0),
    progressTotal: integer("progress_total"),
    progressMessage: text("progress_message"),
    lastError: text("last_error"),
    lastErrorCode: text("last_error_code"),
    lastErrorClass: text("last_error_class"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    dueIdx: index("runtime_job_due_idx").on(table.status, table.availableAt),
    scopeIdx: index("runtime_job_scope_idx").on(table.accountId, table.scopeType, table.scopeKey, table.createdAt),
    sessionIdx: index("runtime_job_session_idx").on(table.accountId, table.sessionId, table.createdAt),
    dedupeUnique: uniqueIndex("runtime_job_account_type_dedupe_uq").on(table.accountId, table.jobType, table.dedupeKey),
  })
);



// ── 导入资源表 ────────────────────────────────────────

export const presets = sqliteTable(
  "preset",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    source: text("source").notNull().default("sillytavern"),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    dataJson: text("data_json").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    accountUpdatedIdx: index("preset_account_updated_idx").on(table.accountId, table.updatedAt),
  })
);

export const worldbooks = sqliteTable(
  "worldbook",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    source: text("source").notNull().default("sillytavern"),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    dataJson: text("data_json").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    accountUpdatedIdx: index("worldbook_account_updated_idx").on(table.accountId, table.updatedAt),
  })
);

export const worldbookEntries = sqliteTable(
  "worldbook_entry",
  {
    id: text("id").primaryKey(),
    worldbookId: text("worldbook_id")
      .notNull()
      .references(() => worldbooks.id, { onDelete: "cascade" }),
    uid: integer("uid").notNull(),
    comment: text("comment").notNull().default(""),
    content: text("content").notNull().default(""),
    keysJson: text("keys_json").notNull().default("[]"),
    keysSecondaryJson: text("keys_secondary_json").notNull().default("[]"),
    selective: integer("selective", { mode: "boolean" }).notNull().default(true),
    selectiveLogic: integer("selective_logic").notNull().default(0),
    constant: integer("constant", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0),
    order: integer("order").notNull().default(100),
    depth: integer("depth").notNull().default(4),
    role: integer("role").notNull().default(0),
    disable: integer("disable", { mode: "boolean" }).notNull().default(false),
    scanDepth: integer("scan_depth"),
    caseSensitive: integer("case_sensitive", { mode: "boolean" }),
    matchWholeWords: integer("match_whole_words", { mode: "boolean" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    worldbookOrderIdx: index("wb_entry_worldbook_order_idx").on(table.worldbookId, table.order),
    worldbookUpdatedIdx: index("wb_entry_worldbook_updated_idx").on(table.worldbookId, table.updatedAt),
  })
);

export const regexProfiles = sqliteTable(
  "regex_profile",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    source: text("source").notNull().default("sillytavern"),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    dataJson: text("data_json").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    accountUpdatedIdx: index("regex_profile_account_updated_idx").on(table.accountId, table.updatedAt),
  })
);

export const promptSnapshots = sqliteTable(
  "prompt_snapshot",
  {
    floorId: text("floor_id").primaryKey().references(() => floors.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    presetId: text("preset_id").references(() => presets.id, { onDelete: "set null" }),
    presetUpdatedAt: integer("preset_updated_at"),
    presetVersion: integer("preset_version"),
    worldbookId: text("worldbook_id").references(() => worldbooks.id, { onDelete: "set null" }),
    worldbookUpdatedAt: integer("worldbook_updated_at"),
    worldbookVersion: integer("worldbook_version"),
    regexProfileId: text("regex_profile_id").references(() => regexProfiles.id, { onDelete: "set null" }),
    regexProfileUpdatedAt: integer("regex_profile_updated_at"),
    regexProfileVersion: integer("regex_profile_version"),
    worldbookActivatedEntryUidsJson: text("worldbook_activated_entry_uids_json").notNull().default("[]"),
    regexPreRuleNamesJson: text("regex_pre_rule_names_json").notNull().default("[]"),
    regexPostRuleNamesJson: text("regex_post_rule_names_json").notNull().default("[]"),
    promptMode: text("prompt_mode", { enum: ["compat_strict", "compat_plus", "native"] }).notNull(),
    promptDigest: text("prompt_digest").notNull(),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    sessionCreatedIdx: index("prompt_snapshot_session_created_idx").on(table.sessionId, table.createdAt),
    digestIdx: index("prompt_snapshot_digest_idx").on(table.promptDigest),
  })
);

// ── LLM Profile Vault ──────────────────────────────────

export const llmProfiles = sqliteTable(
  "llm_profile",
  {
    id: text("id").primaryKey(),
    presetName: text("preset_name").notNull(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    provider: text("provider", { enum: ["openai", "anthropic", "google", "deepseek", "xai", "openai-compatible"] }).notNull(),
    modelId: text("model_id").notNull(),
    baseUrl: text("base_url"),
    apiKeyName: text("api_key_name"),
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    apiKeyMasked: text("api_key_masked").notNull(),
    status: text("status", { enum: ["active", "disabled", "deleted"] }).notNull().default("active"),
    lastUsedAt: integer("last_used_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    presetNameUnique: uniqueIndex("llm_profile_account_preset_name_uq").on(table.accountId, table.presetName),
    statusUpdatedIdx: index("llm_profile_status_updated_idx").on(table.status, table.updatedAt),
  })
);

export const llmProfileBindings = sqliteTable(
  "llm_profile_binding",
  {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: ["global", "session"] }).notNull(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    scopeId: text("scope_id").notNull(),
    instanceSlot: text("instance_slot").notNull().default("*"),
    paramsJson: text("params_json"),
    profileId: text("profile_id").notNull().references(() => llmProfiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    scopeSlotUnique: uniqueIndex("llm_profile_binding_account_scope_scope_id_slot_uq").on(table.accountId, table.scope, table.scopeId, table.instanceSlot),
    profileScopeIdx: index("llm_profile_binding_profile_account_scope_idx").on(table.profileId, table.accountId, table.scope, table.scopeId, table.instanceSlot),
  })
);

export const llmInstanceConfigs = sqliteTable(
  "llm_instance_config",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    scope: text("scope", { enum: ["global", "session"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    instanceSlot: text("instance_slot", { enum: ["*", "narrator", "director", "verifier", "memory"] }).notNull(),
    presetId: text("preset_id"),
    enabled: integer("enabled").notNull().default(1),
    paramsJson: text("params_json"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    scopeSlotUnique: uniqueIndex("llm_instance_config_account_scope_slot_uq").on(table.accountId, table.scope, table.scopeId, table.instanceSlot),
    scopeIdx: index("llm_instance_config_account_scope_idx").on(table.accountId, table.scope, table.scopeId),
  })
);


// ── Tool Calling ────────────────────────────────────────

export const toolCallRecords = sqliteTable(
  "tool_call_record",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id").notNull().references(() => messagePages.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    callerSlot: text("caller_slot").notNull(),
    toolName: text("tool_name").notNull(),
    argsJson: text("args_json").notNull().default('{}'),
    resultJson: text("result_json").notNull().default('{}'),
    status: text("status", { enum: ["success", "error", "denied"] }).notNull().default("success"),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    pageSeqIdx: index("tool_call_record_page_seq_idx").on(table.pageId, table.seq),
    toolNameIdx: index("tool_call_record_tool_name_idx").on(table.toolName),
  })
);

export const toolExecutionRecords = sqliteTable(
  "tool_execution_record",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    floorId: text("floor_id").notNull().references(() => floors.id, { onDelete: "cascade" }),
    pageId: text("page_id").references(() => messagePages.id, { onDelete: "set null" }),
    callerSlot: text("caller_slot").notNull(),
    providerId: text("provider_id").notNull(),
    toolName: text("tool_name").notNull(),
    providerType: text("provider_type", { enum: ["builtin", "preset", "mcp", "unknown"] }).notNull().default("unknown"),
    argsJson: text("args_json").notNull().default("{}"),
    resultJson: text("result_json").notNull().default("{}"),
    status: text("status", { enum: ["running", "success", "error", "denied", "timeout", "uncertain", "blocked"] }).notNull().default("running"),
    lifecycleState: text("lifecycle_state", { enum: ["opened", "finished"] }).notNull().default("finished"),
    commitOutcome: text("commit_outcome", { enum: ["pending", "committed", "discarded", "replay_blocked", "uncertain"] }).notNull().default("pending"),
    sideEffectLevel: text("side_effect_level", { enum: ["none", "sandbox", "irreversible"] }),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms").notNull().default(0),
    startedAt: integer("started_at").notNull().default(0),
    finishedAt: integer("finished_at"),
    attemptNo: integer("attempt_no").notNull().default(1),
    replayParentExecutionId: text("replay_parent_execution_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    floorCreatedIdx: index("tool_execution_record_floor_created_idx").on(table.floorId, table.startedAt),
    runIdx: index("tool_execution_record_run_idx").on(table.runId, table.startedAt),
    pageCreatedIdx: index("tool_execution_record_page_created_idx").on(table.pageId, table.startedAt),
    toolNameIdx: index("tool_execution_record_tool_name_idx").on(table.toolName),
  })
);

export const toolDefinitions = sqliteTable(
  "tool_definition",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(''),
    parametersJson: text("parameters_json").notNull().default('{"type":"object","properties":{}}'),
    sideEffectLevel: text("side_effect_level", { enum: ["none", "sandbox", "irreversible"] }).notNull().default("none"),
    allowedSlotsJson: text("allowed_slots_json").notNull().default('[]'),
    source: text("source", { enum: ["preset", "character", "custom"] }).notNull().default("preset"),
    sourceId: text("source_id"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    handlerType: text("handler_type", { enum: ["script", "prompt", "delegate"] }).notNull().default("script"),
    handlerJson: text("handler_json").notNull().default('{}'),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    nameSourceUnique: uniqueIndex("tool_definition_name_source_source_id_uq").on(table.name, table.source, table.sourceId),
    accountSourceIdx: index("tool_definition_account_source_idx").on(table.accountId, table.source),
  })
);

// ── MCP Server Configuration ────────────────────────────

export const mcpServerConfigs = sqliteTable(
  "mcp_server_config",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }).default("default-admin"),
    transport: text("transport", { enum: ["stdio", "http"] }).notNull(),
    configJson: text("config_json").notNull(),
    toolPrefix: text("tool_prefix"),
    enabled: integer("enabled").notNull().default(1),
    connectTimeoutMs: integer("connect_timeout_ms").notNull().default(30000),
    callTimeoutMs: integer("call_timeout_ms").notNull().default(60000),
    toolRefreshIntervalMs: integer("tool_refresh_interval_ms").notNull().default(300000),
    defaultSideEffectLevel: text("default_side_effect_level", {
      enum: ["none", "sandbox", "irreversible"],
    }).notNull().default("irreversible"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    accountNameUnique: uniqueIndex("mcp_server_config_account_name_uq").on(
      table.accountId,
      table.name,
    ),
    accountUpdatedIdx: index("mcp_server_config_account_updated_idx").on(table.accountId, table.updatedAt),
  })
);

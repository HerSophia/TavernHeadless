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
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    accountUpdatedIdx: index("account_user_account_updated_idx").on(table.accountId, table.updatedAt),
    accountNameUnique: uniqueIndex("account_user_account_name_uq").on(table.accountId, table.name),
  })
);

export const characters = sqliteTable("character", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull().default("sillytavern"),
  status: text("status", { enum: ["active", "deleted"] }).notNull().default("active"),
  deletedAt: integer("deleted_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

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
    scope: text("scope", { enum: ["global", "chat", "floor", "page"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    key: text("key").notNull(),
    valueJson: text("value_json").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => ({
    scopeScopeIdKeyUnique: uniqueIndex("variable_scope_scope_id_key_uq").on(
      table.scope,
      table.scopeId,
      table.key
    )
  })
);

export const memoryItems = sqliteTable("memory_item", {
  id: text("id").primaryKey(),
  scope: text("scope", { enum: ["global", "chat", "floor"] }).notNull(),
  scopeId: text("scope_id").notNull(),
  type: text("type", { enum: ["fact", "summary", "open_loop"] }).notNull(),
  contentJson: text("content_json").notNull(),
  importance: real("importance").notNull().default(0.5),
  confidence: real("confidence").notNull().default(1),
  sourceFloorId: text("source_floor_id"),
  sourceMessageId: text("source_message_id"),
  status: text("status", { enum: ["active", "deprecated"] }).notNull().default("active"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const memoryEdges = sqliteTable("memory_edge", {
  id: text("id").primaryKey(),
  fromId: text("from_id").notNull().references(() => memoryItems.id, { onDelete: "cascade" }),
  toId: text("to_id").notNull().references(() => memoryItems.id, { onDelete: "cascade" }),
  relation: text("relation", { enum: ["supports", "contradicts", "updates"] }).notNull(),
  createdAt: integer("created_at").notNull()
});

// ── 导入资源表 ────────────────────────────────────────

export const presets = sqliteTable("preset", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull().default("sillytavern"),
  dataJson: text("data_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const worldbooks = sqliteTable("worldbook", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull().default("sillytavern"),
  dataJson: text("data_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const regexProfiles = sqliteTable("regex_profile", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull().default("sillytavern"),
  dataJson: text("data_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

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
    profileId: text("profile_id").notNull().references(() => llmProfiles.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    scopeSlotUnique: uniqueIndex("llm_profile_binding_account_scope_scope_id_slot_uq").on(table.accountId, table.scope, table.scopeId, table.instanceSlot),
    profileScopeIdx: index("llm_profile_binding_profile_account_scope_idx").on(table.profileId, table.accountId, table.scope, table.scopeId, table.instanceSlot),
  })
);

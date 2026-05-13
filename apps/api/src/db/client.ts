import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";
import { AssetVersionService } from "../services/asset-version-service.js";

const DEFAULT_DATABASE_PATH = "data/tavern-headless.db";
const DEFAULT_MIGRATIONS_PATH = fileURLToPath(new URL("../../drizzle", import.meta.url));
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

type SqliteTableInfoRow = {
  name: string;
};

function tableExists(sqlite: Database.Database, tableName: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { name: string } | undefined;

  return row?.name === tableName;
}

function getTableColumnNames(sqlite: Database.Database, tableName: string): Set<string> {
  const rows = sqlite
    .prepare(`PRAGMA table_info(\`${tableName}\`)`)
    .all() as SqliteTableInfoRow[];

  return new Set(rows.map((row) => row.name));
}

/**
 * 修复已知的 additive migration 漂移。
 *
 * 这里处理的不是正常升级路径，而是历史本地库处于“迁移记录已前进，
 * 但若干纯 additive 的表、索引或列没有真正落到文件上”的异常状态。
 *
 * 这类修复只覆盖可安全补齐的 additive 结构：
 * - 旧表上的新增列
 * - 缺失的治理/审计辅助表与索引
 * - session_branch 注册表及其 main branch 回填
 */
function repairKnownAdditiveSchemaDrift(sqlite: Database.Database): void {
  repairBranchLocalVariableSnapshotDrift(sqlite);
  repairClientDataPhase2Drift(sqlite);
  repairSessionStateGovernanceDrift(sqlite);
  repairSessionBranchRegistryDrift(sqlite);
  repairWorkspaceProjectScopeDrift(sqlite);
}

function tableHasColumns(
  sqlite: Database.Database,
  tableName: string,
  columnNames: readonly string[],
): boolean {
  if (!tableExists(sqlite, tableName)) {
    return false;
  }

  const columns = getTableColumnNames(sqlite, tableName);
  return columnNames.every((columnName) => columns.has(columnName));
}

function addColumnIfMissing(
  sqlite: Database.Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  if (!tableExists(sqlite, tableName)) {
    return;
  }

  const columns = getTableColumnNames(sqlite, tableName);
  if (!columns.has(columnName)) {
    sqlite.exec(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definition};`);
  }
}

function createIndexIfColumnsExist(
  sqlite: Database.Database,
  tableName: string,
  columnNames: readonly string[],
  statement: string,
): void {
  if (tableHasColumns(sqlite, tableName, columnNames)) {
    sqlite.exec(statement);
  }
}

function repairBranchLocalVariableSnapshotDrift(sqlite: Database.Database): void {
  const tableName = "branch_local_variable_snapshot";

  if (!tableExists(sqlite, tableName)) {
    return;
  }

  const columns = getTableColumnNames(sqlite, tableName);

  if (!columns.has("snapshot_version")) {
    sqlite.exec("ALTER TABLE `branch_local_variable_snapshot` ADD COLUMN `snapshot_version` integer NOT NULL DEFAULT 1;");
    columns.add("snapshot_version");
  }

  if (!columns.has("provenance_json")) {
    sqlite.exec("ALTER TABLE `branch_local_variable_snapshot` ADD COLUMN `provenance_json` text;");
  }
}

function repairClientDataPhase2Drift(sqlite: Database.Database): void {
  if (tableExists(sqlite, "client_data_domain")) {
    const domainColumns = getTableColumnNames(sqlite, "client_data_domain");
    if (!domainColumns.has("version")) {
      sqlite.exec("ALTER TABLE `client_data_domain` ADD COLUMN `version` integer NOT NULL DEFAULT 1;");
    }
  }

  if (tableExists(sqlite, "client_data_collection")) {
    const collectionColumns = getTableColumnNames(sqlite, "client_data_collection");
    if (!collectionColumns.has("version")) {
      sqlite.exec("ALTER TABLE `client_data_collection` ADD COLUMN `version` integer NOT NULL DEFAULT 1;");
    }
  }

  if (!tableExists(sqlite, "client_data_domain_grant")) {
    sqlite.exec(`CREATE TABLE \`client_data_domain_grant\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`domain_id\` text NOT NULL,
  \`grantee_owner_type\` text NOT NULL,
  \`grantee_owner_id\` text NOT NULL,
  \`can_read\` integer DEFAULT false NOT NULL,
  \`can_write\` integer DEFAULT false NOT NULL,
  \`can_delete\` integer DEFAULT false NOT NULL,
  \`can_list\` integer DEFAULT false NOT NULL,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  \`expires_at\` integer,
  FOREIGN KEY (\`account_id\`) REFERENCES \`account\`(\`id\`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (\`domain_id\`) REFERENCES \`client_data_domain\`(\`id\`) ON UPDATE no action ON DELETE cascade
);`);
  }
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS `client_data_domain_grant_unique_uq` ON `client_data_domain_grant` (`domain_id`,`grantee_owner_type`,`grantee_owner_id`);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS `client_data_domain_grant_account_grantee_idx` ON `client_data_domain_grant` (`account_id`,`grantee_owner_type`,`grantee_owner_id`);");

  if (!tableExists(sqlite, "client_data_audit_log")) {
    sqlite.exec(`CREATE TABLE \`client_data_audit_log\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`domain_id\` text,
  \`owner_type\` text,
  \`owner_id\` text,
  \`actor_type\` text NOT NULL,
  \`actor_id\` text,
  \`action\` text NOT NULL,
  \`target_type\` text NOT NULL,
  \`target_id\` text,
  \`request_id\` text,
  \`metadata_json\` text,
  \`created_at\` integer NOT NULL,
  FOREIGN KEY (\`account_id\`) REFERENCES \`account\`(\`id\`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (\`domain_id\`) REFERENCES \`client_data_domain\`(\`id\`) ON UPDATE no action ON DELETE set null
);`);
  }
  sqlite.exec("CREATE INDEX IF NOT EXISTS `client_data_audit_log_account_created_idx` ON `client_data_audit_log` (`account_id`,`created_at`);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS `client_data_audit_log_domain_created_idx` ON `client_data_audit_log` (`domain_id`,`created_at`);");
}

function repairSessionStateGovernanceDrift(sqlite: Database.Database): void {
  if (!tableExists(sqlite, "client_data_managed_domain")) {
    sqlite.exec(`CREATE TABLE \`client_data_managed_domain\` (
  \`domain_id\` text PRIMARY KEY NOT NULL REFERENCES \`client_data_domain\`(\`id\`) ON DELETE cascade,
  \`account_id\` text NOT NULL REFERENCES \`account\`(\`id\`) ON DELETE restrict,
  \`manager_kind\` text NOT NULL,
  \`host_type\` text NOT NULL,
  \`host_id\` text NOT NULL,
  \`state_namespace\` text NOT NULL,
  \`require_caller_owner\` integer NOT NULL DEFAULT 1,
  \`allow_auto_create_collection\` integer NOT NULL DEFAULT 0,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  CHECK(\`manager_kind\` IN ('session_state')),
  CHECK(\`host_type\` IN ('session'))
);`);
  }
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS `client_data_managed_domain_account_manager_host_namespace_uq` ON `client_data_managed_domain` (`account_id`, `manager_kind`, `host_type`, `host_id`, `state_namespace`);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS `client_data_managed_domain_account_host_idx` ON `client_data_managed_domain` (`account_id`, `host_type`, `host_id`, `state_namespace`);");

  if (!tableExists(sqlite, "session_state_mutation")) {
    sqlite.exec(`CREATE TABLE \`session_state_mutation\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL REFERENCES \`account\`(\`id\`) ON DELETE restrict,
  \`domain_id\` text NOT NULL REFERENCES \`client_data_domain\`(\`id\`) ON DELETE cascade,
  \`state_namespace\` text NOT NULL,
  \`session_id\` text NOT NULL REFERENCES \`session\`(\`id\`) ON DELETE cascade,
  \`branch_id\` text NOT NULL,
  \`source_floor_id\` text REFERENCES \`floor\`(\`id\`) ON DELETE set null,
  \`target_slot\` text NOT NULL,
  \`visibility_mode\` text NOT NULL,
  \`write_mode\` text NOT NULL,
  \`replay_safety\` text NOT NULL,
  \`status\` text NOT NULL DEFAULT 'staged',
  \`request_id\` text,
  \`run_id\` text,
  \`payload_json\` text NOT NULL DEFAULT '{}',
  \`source_snapshot_floor_id\` text REFERENCES \`floor\`(\`id\`) ON DELETE set null,
  \`live_head_key\` text,
  \`discard_reason\` text,
  \`blocked_reason\` text,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  \`applied_at\` integer,
  CHECK(\`visibility_mode\` IN ('session_shared', 'branch_local', 'fork_on_branch')),
  CHECK(\`write_mode\` IN ('direct', 'commit_bound')),
  CHECK(\`replay_safety\` IN ('safe', 'confirm_on_replay', 'never_auto_replay', 'uncertain')),
  CHECK(\`status\` IN ('staged', 'applied', 'discarded', 'blocked', 'uncertain'))
);`);
  }
  sqlite.exec("CREATE INDEX IF NOT EXISTS `session_state_mutation_session_branch_status_created_idx` ON `session_state_mutation` (`session_id`, `branch_id`, `status`, `created_at`);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS `session_state_mutation_source_floor_idx` ON `session_state_mutation` (`source_floor_id`, `status`, `created_at`);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS `session_state_mutation_run_idx` ON `session_state_mutation` (`run_id`, `created_at`);");

  if (!tableExists(sqlite, "session_state_namespace_registration")) {
    sqlite.exec(`CREATE TABLE \`session_state_namespace_registration\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL REFERENCES \`account\`(\`id\`) ON DELETE restrict,
  \`session_id\` text NOT NULL REFERENCES \`session\`(\`id\`) ON DELETE cascade,
  \`domain_id\` text NOT NULL REFERENCES \`client_data_domain\`(\`id\`) ON DELETE cascade,
  \`namespace\` text NOT NULL,
  \`logical_owner_type\` text NOT NULL,
  \`logical_owner_id\` text NOT NULL,
  \`default_visibility_mode\` text NOT NULL,
  \`default_write_mode\` text NOT NULL,
  \`default_replay_safety\` text NOT NULL,
  \`client_writable\` integer NOT NULL DEFAULT 1,
  \`allowed_write_modes_json\` text NOT NULL DEFAULT '[]',
  \`supports_snapshot\` integer NOT NULL DEFAULT 1,
  \`supports_diff\` integer NOT NULL DEFAULT 1,
  \`replay_policy_source\` text NOT NULL,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  CHECK(\`default_visibility_mode\` IN ('session_shared', 'branch_local', 'fork_on_branch')),
  CHECK(\`default_write_mode\` IN ('direct', 'commit_bound')),
  CHECK(\`default_replay_safety\` IN ('safe', 'confirm_on_replay', 'never_auto_replay', 'uncertain'))
);`);
  }
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS `session_state_namespace_registration_account_session_namespace_uq` ON `session_state_namespace_registration` (`account_id`, `session_id`, `namespace`);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS `session_state_namespace_registration_account_session_created_idx` ON `session_state_namespace_registration` (`account_id`, `session_id`, `created_at`);");
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS `session_state_namespace_registration_domain_id_uq` ON `session_state_namespace_registration` (`domain_id`);");
}

function repairSessionBranchRegistryDrift(sqlite: Database.Database): void {
  if (!tableExists(sqlite, "session_branch")) {
    sqlite.exec(`CREATE TABLE \`session_branch\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL REFERENCES \`account\`(\`id\`) ON DELETE restrict,
  \`session_id\` text NOT NULL REFERENCES \`session\`(\`id\`) ON DELETE cascade,
  \`branch_id\` text NOT NULL,
  \`source_floor_id\` text REFERENCES \`floor\`(\`id\`) ON DELETE set null,
  \`source_branch_id\` text,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL
);`);
  }
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS `session_branch_account_session_branch_uq` ON `session_branch` (`account_id`,`session_id`,`branch_id`);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS `session_branch_account_session_created_idx` ON `session_branch` (`account_id`,`session_id`,`created_at`);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS `session_branch_account_session_branch_created_idx` ON `session_branch` (`account_id`,`session_id`,`branch_id`,`created_at`);");
  sqlite.exec(`INSERT OR IGNORE INTO \`session_branch\` (\`id\`, \`account_id\`, \`session_id\`, \`branch_id\`, \`source_floor_id\`, \`source_branch_id\`, \`created_at\`, \`updated_at\`)
SELECT
  lower(hex(randomblob(16))),
  \`s\`.\`account_id\`,
  \`f\`.\`session_id\`,
  \`f\`.\`branch_id\`,
  NULL,
  NULL,
  min(\`f\`.\`created_at\`),
  max(\`f\`.\`updated_at\`)
FROM \`floor\` AS \`f\`
INNER JOIN \`session\` AS \`s\` ON \`s\`.\`id\` = \`f\`.\`session_id\`
GROUP BY \`s\`.\`account_id\`, \`f\`.\`session_id\`, \`f\`.\`branch_id\`;
INSERT OR IGNORE INTO \`session_branch\` (\`id\`, \`account_id\`, \`session_id\`, \`branch_id\`, \`source_floor_id\`, \`source_branch_id\`, \`created_at\`, \`updated_at\`)
SELECT
  lower(hex(randomblob(16))),
  \`s\`.\`account_id\`,
  \`s\`.\`id\`,
  'main',
  NULL,
  NULL,
  \`s\`.\`created_at\`,
  \`s\`.\`updated_at\`
FROM \`session\` AS \`s\`
WHERE NOT EXISTS (
  SELECT 1
  FROM \`session_branch\` AS \`sb\`
  WHERE \`sb\`.\`account_id\` = \`s\`.\`account_id\`
    AND \`sb\`.\`session_id\` = \`s\`.\`id\`
    AND \`sb\`.\`branch_id\` = 'main'
);`);
}

function repairWorkspaceProjectScopeDrift(sqlite: Database.Database): void {
  if (!tableExists(sqlite, "account")) {
    return;
  }

  if (!tableExists(sqlite, "workspace")) {
    sqlite.exec(`CREATE TABLE \`workspace\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`name\` text NOT NULL,
  \`kind\` text NOT NULL DEFAULT 'default',
  \`is_default\` integer NOT NULL DEFAULT 0,
  \`status\` text NOT NULL DEFAULT 'active',
  \`settings_json\` text NOT NULL DEFAULT '{}',
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  FOREIGN KEY (\`account_id\`) REFERENCES \`account\`(\`id\`) ON DELETE restrict
);`);
  }

  sqlite.exec("CREATE INDEX IF NOT EXISTS `workspace_account_updated_idx` ON `workspace` (`account_id`, `updated_at`);");
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS `workspace_account_default_uq` ON `workspace` (`account_id`) WHERE `is_default` = 1;");

  if (!tableExists(sqlite, "project")) {
    sqlite.exec(`CREATE TABLE \`project\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`workspace_id\` text NOT NULL,
  \`name\` text NOT NULL,
  \`description\` text,
  \`kind\` text NOT NULL DEFAULT 'session_default',
  \`status\` text NOT NULL DEFAULT 'active',
  \`settings_override_json\` text NOT NULL DEFAULT '{}',
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  FOREIGN KEY (\`account_id\`) REFERENCES \`account\`(\`id\`) ON DELETE restrict,
  FOREIGN KEY (\`workspace_id\`) REFERENCES \`workspace\`(\`id\`) ON DELETE restrict
);`);
  }

  sqlite.exec("CREATE INDEX IF NOT EXISTS `project_account_workspace_updated_idx` ON `project` (`account_id`, `workspace_id`, `updated_at`);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS `project_workspace_updated_idx` ON `project` (`workspace_id`, `updated_at`);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS `project_account_status_updated_idx` ON `project` (`account_id`, `status`, `updated_at`);");

  addWorkspaceProjectScopeColumns(sqlite);
  backfillDefaultWorkspaces(sqlite);
  backfillWorkspaceIdFromDefaultWorkspace(sqlite, "character");
  backfillWorkspaceIdFromDefaultWorkspace(sqlite, "account_user");
  backfillWorkspaceIdFromDefaultWorkspace(sqlite, "preset");
  backfillWorkspaceIdFromDefaultWorkspace(sqlite, "worldbook");
  backfillWorkspaceIdFromDefaultWorkspace(sqlite, "regex_profile");
  backfillWorkspaceIdFromDefaultWorkspace(sqlite, "llm_profile");
  backfillWorkspaceIdFromDefaultWorkspace(sqlite, "tool_definition");
  backfillWorkspaceIdFromDefaultWorkspace(sqlite, "mcp_server_config");
  backfillSessionProjects(sqlite);
  backfillConfigWorkspaceIds(sqlite, "llm_profile_binding");
  backfillConfigWorkspaceIds(sqlite, "llm_instance_config");
  createWorkspaceProjectScopeIndexes(sqlite);
}

function addWorkspaceProjectScopeColumns(sqlite: Database.Database): void {
  addColumnIfMissing(
    sqlite,
    "session",
    "workspace_id",
    "`workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict",
  );
  addColumnIfMissing(
    sqlite,
    "session",
    "project_id",
    "`project_id` text REFERENCES `project`(`id`) ON DELETE restrict",
  );
  addColumnIfMissing(
    sqlite,
    "character",
    "workspace_id",
    "`workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict",
  );
  addColumnIfMissing(
    sqlite,
    "account_user",
    "workspace_id",
    "`workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict",
  );
  addColumnIfMissing(
    sqlite,
    "preset",
    "workspace_id",
    "`workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict",
  );
  addColumnIfMissing(
    sqlite,
    "worldbook",
    "workspace_id",
    "`workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict",
  );
  addColumnIfMissing(
    sqlite,
    "regex_profile",
    "workspace_id",
    "`workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict",
  );
  addColumnIfMissing(
    sqlite,
    "llm_profile",
    "workspace_id",
    "`workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict",
  );
  addColumnIfMissing(
    sqlite,
    "llm_profile_binding",
    "workspace_id",
    "`workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict",
  );
  addColumnIfMissing(
    sqlite,
    "llm_instance_config",
    "workspace_id",
    "`workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict",
  );
  addColumnIfMissing(
    sqlite,
    "tool_definition",
    "workspace_id",
    "`workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict",
  );
  addColumnIfMissing(
    sqlite,
    "mcp_server_config",
    "workspace_id",
    "`workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict",
  );
}

function backfillDefaultWorkspaces(sqlite: Database.Database): void {
  sqlite.exec(`INSERT OR IGNORE INTO \`workspace\` (
  \`id\`,
  \`account_id\`,
  \`name\`,
  \`kind\`,
  \`is_default\`,
  \`status\`,
  \`settings_json\`,
  \`created_at\`,
  \`updated_at\`
)
SELECT
  'ws_default_' || \`account\`.\`id\`,
  \`account\`.\`id\`,
  '默认 Workspace',
  'default',
  1,
  'active',
  '{}',
  \`account\`.\`created_at\`,
  \`account\`.\`updated_at\`
FROM \`account\`
WHERE NOT EXISTS (
  SELECT 1
  FROM \`workspace\`
  WHERE \`workspace\`.\`account_id\` = \`account\`.\`id\`
    AND \`workspace\`.\`is_default\` = 1
);`);
}

function backfillWorkspaceIdFromDefaultWorkspace(sqlite: Database.Database, tableName: string): void {
  if (!tableHasColumns(sqlite, tableName, ["account_id", "workspace_id"])) {
    return;
  }

  sqlite.exec(`UPDATE \`${tableName}\`
SET \`workspace_id\` = (
  SELECT \`workspace\`.\`id\`
  FROM \`workspace\`
  WHERE \`workspace\`.\`account_id\` = \`${tableName}\`.\`account_id\`
    AND \`workspace\`.\`is_default\` = 1
)
WHERE \`workspace_id\` IS NULL
  AND EXISTS (
    SELECT 1
    FROM \`workspace\`
    WHERE \`workspace\`.\`account_id\` = \`${tableName}\`.\`account_id\`
      AND \`workspace\`.\`is_default\` = 1
  );`);
}

function backfillSessionProjects(sqlite: Database.Database): void {
  if (!tableHasColumns(sqlite, "session", ["id", "account_id", "workspace_id", "project_id", "created_at", "updated_at"])) {
    return;
  }

  sqlite.exec(`INSERT OR IGNORE INTO \`project\` (
  \`id\`,
  \`account_id\`,
  \`workspace_id\`,
  \`name\`,
  \`description\`,
  \`kind\`,
  \`status\`,
  \`settings_override_json\`,
  \`created_at\`,
  \`updated_at\`
)
SELECT
  'proj_session_' || \`session\`.\`id\`,
  \`session\`.\`account_id\`,
  \`workspace\`.\`id\`,
  COALESCE(NULLIF(TRIM(\`session\`.\`title\`), ''), '默认项目 - ' || \`session\`.\`id\`),
  NULL,
  'session_default',
  'active',
  '{}',
  \`session\`.\`created_at\`,
  \`session\`.\`updated_at\`
FROM \`session\`
JOIN \`workspace\`
  ON \`workspace\`.\`account_id\` = \`session\`.\`account_id\`
  AND \`workspace\`.\`is_default\` = 1
WHERE \`session\`.\`project_id\` IS NULL;

UPDATE \`session\`
SET
  \`workspace_id\` = (
    SELECT \`project\`.\`workspace_id\`
    FROM \`project\`
    WHERE \`project\`.\`id\` = 'proj_session_' || \`session\`.\`id\`
  ),
  \`project_id\` = 'proj_session_' || \`id\`
WHERE \`project_id\` IS NULL
  AND EXISTS (
    SELECT 1
    FROM \`project\`
    WHERE \`project\`.\`id\` = 'proj_session_' || \`session\`.\`id\`
  );

UPDATE \`session\`
SET \`workspace_id\` = (
  SELECT \`project\`.\`workspace_id\`
  FROM \`project\`
  WHERE \`project\`.\`id\` = \`session\`.\`project_id\`
)
WHERE \`workspace_id\` IS NULL
  AND \`project_id\` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM \`project\`
    WHERE \`project\`.\`id\` = \`session\`.\`project_id\`
  );`);
}

function backfillConfigWorkspaceIds(sqlite: Database.Database, tableName: string): void {
  if (!tableHasColumns(sqlite, tableName, ["account_id", "workspace_id", "scope", "scope_id"])) {
    return;
  }

  sqlite.exec(`UPDATE \`${tableName}\`
SET \`workspace_id\` = COALESCE(
  CASE
    WHEN \`scope\` = 'session' THEN (
      SELECT \`session\`.\`workspace_id\`
      FROM \`session\`
      WHERE \`session\`.\`id\` = \`${tableName}\`.\`scope_id\`
        AND \`session\`.\`account_id\` = \`${tableName}\`.\`account_id\`
    )
  END,
  (
    SELECT \`workspace\`.\`id\`
    FROM \`workspace\`
    WHERE \`workspace\`.\`account_id\` = \`${tableName}\`.\`account_id\`
      AND \`workspace\`.\`is_default\` = 1
  )
)
WHERE \`workspace_id\` IS NULL;`);
}

function createWorkspaceProjectScopeIndexes(sqlite: Database.Database): void {
  createIndexIfColumnsExist(sqlite, "session", ["account_id", "workspace_id", "updated_at"], "CREATE INDEX IF NOT EXISTS `session_account_workspace_updated_idx` ON `session` (`account_id`, `workspace_id`, `updated_at`);");
  createIndexIfColumnsExist(sqlite, "session", ["account_id", "project_id", "updated_at"], "CREATE INDEX IF NOT EXISTS `session_account_project_updated_idx` ON `session` (`account_id`, `project_id`, `updated_at`);");
  createIndexIfColumnsExist(sqlite, "session", ["project_id", "updated_at"], "CREATE INDEX IF NOT EXISTS `session_project_updated_idx` ON `session` (`project_id`, `updated_at`);");
  createIndexIfColumnsExist(sqlite, "character", ["account_id", "workspace_id", "updated_at"], "CREATE INDEX IF NOT EXISTS `character_account_workspace_updated_idx` ON `character` (`account_id`, `workspace_id`, `updated_at`);");
  createIndexIfColumnsExist(sqlite, "account_user", ["account_id", "workspace_id", "updated_at"], "CREATE INDEX IF NOT EXISTS `account_user_account_workspace_updated_idx` ON `account_user` (`account_id`, `workspace_id`, `updated_at`);");
  createIndexIfColumnsExist(sqlite, "preset", ["account_id", "workspace_id", "updated_at"], "CREATE INDEX IF NOT EXISTS `preset_account_workspace_updated_idx` ON `preset` (`account_id`, `workspace_id`, `updated_at`);");
  createIndexIfColumnsExist(sqlite, "worldbook", ["account_id", "workspace_id", "updated_at"], "CREATE INDEX IF NOT EXISTS `worldbook_account_workspace_updated_idx` ON `worldbook` (`account_id`, `workspace_id`, `updated_at`);");
  createIndexIfColumnsExist(sqlite, "regex_profile", ["account_id", "workspace_id", "updated_at"], "CREATE INDEX IF NOT EXISTS `regex_profile_account_workspace_updated_idx` ON `regex_profile` (`account_id`, `workspace_id`, `updated_at`);");
  createIndexIfColumnsExist(sqlite, "llm_profile", ["account_id", "workspace_id", "updated_at"], "CREATE INDEX IF NOT EXISTS `llm_profile_account_workspace_updated_idx` ON `llm_profile` (`account_id`, `workspace_id`, `updated_at`);");
  createIndexIfColumnsExist(sqlite, "llm_profile_binding", ["account_id", "workspace_id", "scope", "scope_id"], "CREATE INDEX IF NOT EXISTS `llm_profile_binding_account_workspace_scope_idx` ON `llm_profile_binding` (`account_id`, `workspace_id`, `scope`, `scope_id`);");
  createIndexIfColumnsExist(sqlite, "llm_instance_config", ["account_id", "workspace_id", "scope", "scope_id"], "CREATE INDEX IF NOT EXISTS `llm_instance_config_account_workspace_scope_idx` ON `llm_instance_config` (`account_id`, `workspace_id`, `scope`, `scope_id`);");
  createIndexIfColumnsExist(sqlite, "tool_definition", ["account_id", "workspace_id", "source"], "CREATE INDEX IF NOT EXISTS `tool_definition_account_workspace_source_idx` ON `tool_definition` (`account_id`, `workspace_id`, `source`);");
  createIndexIfColumnsExist(sqlite, "mcp_server_config", ["account_id", "workspace_id", "updated_at"], "CREATE INDEX IF NOT EXISTS `mcp_server_config_account_workspace_updated_idx` ON `mcp_server_config` (`account_id`, `workspace_id`, `updated_at`);");
}

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Transaction executor type — the `tx` parameter received inside
 * `db.transaction(tx => ...)`.  Used to replace `any` in methods
 * that accept a transaction callback parameter.
 */
export type DbExecutor = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

export type DatabaseConnection = {
  db: AppDb;
  close: () => void;
};

function resolveDatabasePath(databasePath: string): string {
  if (databasePath === ":memory:") {
    return databasePath;
  }

  const resolvedPath = resolve(process.cwd(), databasePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  return resolvedPath;
}

export function createDatabase(
  databasePath = process.env.DATABASE_URL ?? DEFAULT_DATABASE_PATH,
  migrationsPath = DEFAULT_MIGRATIONS_PATH
): DatabaseConnection {
  const sqlite = new Database(resolveDatabasePath(databasePath));

  // 基础一致性与锁竞争配置。
  // :memory: 数据库不适用 WAL，因此仅在文件数据库上启用。
  // 若后续需要更细的锁争用观测，可在数据库工厂外围补充日志采样。
  if (databasePath !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }

  sqlite.pragma(`busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`);

  const db = drizzle(sqlite, { schema });

  // Drizzle 的 SQLite migrator 会把整组 migration 放进单个事务。
  // 对于 0034 这类通过重建表来移除默认值的 migration，
  // 必须在进入事务前关闭 foreign_keys，否则文件内的 PRAGMA 不会生效。
  sqlite.pragma("foreign_keys = OFF");

  try {
    migrate(db, {
      migrationsFolder: resolveMigrationsPath(migrationsPath)
    });
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }

  repairKnownAdditiveSchemaDrift(sqlite);
  new AssetVersionService(db).ensureInitialVersionsForAllAccounts();

  return {
    db,
    close: () => sqlite.close()
  };
}

function resolveMigrationsPath(migrationsPath: string): string {
  if (migrationsPath === ":memory:") {
    return migrationsPath;
  }

  return resolve(process.cwd(), migrationsPath);
}

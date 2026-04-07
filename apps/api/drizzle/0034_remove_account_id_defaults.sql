PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_account_user` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict,
  `name` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `revision` integer NOT NULL DEFAULT 0,
  CHECK(`status` IN ('active', 'disabled', 'deleted'))
);
--> statement-breakpoint
INSERT INTO `__new_account_user` (`id`, `account_id`, `name`, `snapshot_json`, `status`, `created_at`, `updated_at`, `revision`)
SELECT `id`, `account_id`, `name`, `snapshot_json`, `status`, `created_at`, `updated_at`, `revision`
FROM `account_user`;
--> statement-breakpoint
DROP TABLE `account_user`;
--> statement-breakpoint
ALTER TABLE `__new_account_user` RENAME TO `account_user`;
--> statement-breakpoint
CREATE UNIQUE INDEX `account_user_account_name_uq` ON `account_user` (`account_id`, `name`);
--> statement-breakpoint
CREATE INDEX `account_user_account_updated_idx` ON `account_user` (`account_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `__new_character` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `source` text DEFAULT 'sillytavern' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `deleted_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `account_id` text NOT NULL,
  `revision` integer NOT NULL DEFAULT 0,
  `latest_version_no` integer NOT NULL DEFAULT 0,
  CHECK(`status` IN ('active', 'deleted'))
);
--> statement-breakpoint
INSERT INTO `__new_character` (`id`, `name`, `source`, `status`, `deleted_at`, `created_at`, `updated_at`, `account_id`, `revision`, `latest_version_no`)
SELECT `id`, `name`, `source`, `status`, `deleted_at`, `created_at`, `updated_at`, `account_id`, `revision`, `latest_version_no`
FROM `character`;
--> statement-breakpoint
DROP TABLE `character`;
--> statement-breakpoint
ALTER TABLE `__new_character` RENAME TO `character`;
--> statement-breakpoint
CREATE INDEX `character_account_updated_idx` ON `character` (`account_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `__new_session` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text,
  `status` text DEFAULT 'active' NOT NULL,
  `preset_id` text,
  `regex_profile_id` text,
  `worldbook_profile_id` text,
  `model_provider` text,
  `model_name` text,
  `model_params_json` text,
  `metadata_json` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `prompt_mode` text CHECK(`prompt_mode` IN ('compat_strict', 'compat_plus', 'native')),
  `character_id` text REFERENCES `character`(`id`) ON DELETE set null,
  `character_version_id` text REFERENCES `character_version`(`id`) ON DELETE set null,
  `character_snapshot_json` text,
  `character_sync_policy` text DEFAULT 'pin' NOT NULL CHECK(`character_sync_policy` IN ('pin', 'manual', 'force')),
  `account_id` text NOT NULL,
  `user_id` text REFERENCES `account_user`(`id`) ON UPDATE no action ON DELETE set null,
  `user_snapshot_json` text,
  CHECK(`status` IN ('active', 'archived'))
);
--> statement-breakpoint
INSERT INTO `__new_session` (`id`, `title`, `status`, `preset_id`, `regex_profile_id`, `worldbook_profile_id`, `model_provider`, `model_name`, `model_params_json`, `metadata_json`, `created_at`, `updated_at`, `prompt_mode`, `character_id`, `character_version_id`, `character_snapshot_json`, `character_sync_policy`, `account_id`, `user_id`, `user_snapshot_json`)
SELECT `id`, `title`, `status`, `preset_id`, `regex_profile_id`, `worldbook_profile_id`, `model_provider`, `model_name`, `model_params_json`, `metadata_json`, `created_at`, `updated_at`, `prompt_mode`, `character_id`, `character_version_id`, `character_snapshot_json`, `character_sync_policy`, `account_id`, `user_id`, `user_snapshot_json`
FROM `session`;
--> statement-breakpoint
DROP TABLE `session`;
--> statement-breakpoint
ALTER TABLE `__new_session` RENAME TO `session`;
--> statement-breakpoint
CREATE INDEX `session_account_updated_idx` ON `session` (`account_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `__new_variable` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE RESTRICT,
  `scope` text NOT NULL,
  `scope_id` text NOT NULL,
  `key` text NOT NULL,
  `value_json` text NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK(`scope` IN ('global', 'chat', 'floor', 'branch', 'page'))
);
--> statement-breakpoint
INSERT INTO `__new_variable` (`id`, `account_id`, `scope`, `scope_id`, `key`, `value_json`, `updated_at`)
SELECT `id`, `account_id`, `scope`, `scope_id`, `key`, `value_json`, `updated_at`
FROM `variable`;
--> statement-breakpoint
DROP TABLE `variable`;
--> statement-breakpoint
ALTER TABLE `__new_variable` RENAME TO `variable`;
--> statement-breakpoint
CREATE UNIQUE INDEX `variable_account_scope_scope_id_key_uq` ON `variable` (`account_id`, `scope`, `scope_id`, `key`);
--> statement-breakpoint
CREATE INDEX `variable_account_scope_scope_id_updated_idx` ON `variable` (`account_id`, `scope`, `scope_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `variable_account_scope_updated_idx` ON `variable` (`account_id`, `scope`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `__new_memory_item` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `scope_id` text NOT NULL,
  `type` text NOT NULL,
  `content_json` text NOT NULL,
  `importance` real DEFAULT 0.5 NOT NULL,
  `confidence` real DEFAULT 1 NOT NULL,
  `source_floor_id` text,
  `source_message_id` text,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `account_id` text NOT NULL,
  `fact_key` text,
  `summary_tier` text CHECK(`summary_tier` IN ('micro', 'macro')),
  `lifecycle_status` text NOT NULL DEFAULT 'active' CHECK(`lifecycle_status` IN ('active', 'compacted', 'deprecated')),
  `source_job_id` text,
  `token_count_estimate` integer,
  `last_used_at` integer,
  `coverage_start_floor_no` integer,
  `coverage_end_floor_no` integer,
  `derived_from_count` integer,
  CHECK(`scope` IN ('global', 'chat', 'floor')),
  CHECK(`type` IN ('fact', 'summary', 'open_loop')),
  CHECK(`status` IN ('active', 'deprecated'))
);
--> statement-breakpoint
INSERT INTO `__new_memory_item` (`id`, `scope`, `scope_id`, `type`, `content_json`, `importance`, `confidence`, `source_floor_id`, `source_message_id`, `status`, `created_at`, `updated_at`, `account_id`, `fact_key`, `summary_tier`, `lifecycle_status`, `source_job_id`, `token_count_estimate`, `last_used_at`, `coverage_start_floor_no`, `coverage_end_floor_no`, `derived_from_count`)
SELECT `id`, `scope`, `scope_id`, `type`, `content_json`, `importance`, `confidence`, `source_floor_id`, `source_message_id`, `status`, `created_at`, `updated_at`, `account_id`, `fact_key`, `summary_tier`, `lifecycle_status`, `source_job_id`, `token_count_estimate`, `last_used_at`, `coverage_start_floor_no`, `coverage_end_floor_no`, `derived_from_count`
FROM `memory_item`;
--> statement-breakpoint
DROP TABLE `memory_item`;
--> statement-breakpoint
ALTER TABLE `__new_memory_item` RENAME TO `memory_item`;
--> statement-breakpoint
CREATE INDEX `memory_item_account_scope_idx` ON `memory_item` (`account_id`, `scope`, `scope_id`);
--> statement-breakpoint
CREATE INDEX `memory_item_account_scope_lifecycle_type_updated_idx`
  ON `memory_item` (`account_id`, `scope`, `scope_id`, `lifecycle_status`, `type`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `memory_item_account_scope_summary_tier_lifecycle_idx`
  ON `memory_item` (`account_id`, `scope`, `scope_id`, `summary_tier`, `lifecycle_status`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `memory_item_fact_lookup_idx` ON `memory_item`(`account_id`, `scope`, `scope_id`, `type`, `status`, `fact_key`);
--> statement-breakpoint
CREATE INDEX `memory_item_scope_id_status_type_importance_idx` ON `memory_item` (`scope_id`,`status`,`type`,`importance`);
--> statement-breakpoint
CREATE INDEX `memory_item_status_updated_at_idx` ON `memory_item` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `__new_memory_edge` (
  `id` text PRIMARY KEY NOT NULL,
  `from_id` text NOT NULL REFERENCES `memory_item`(`id`) ON DELETE cascade,
  `to_id` text NOT NULL REFERENCES `memory_item`(`id`) ON DELETE cascade,
  `relation` text NOT NULL,
  `account_id` text NOT NULL,
  `created_at` integer NOT NULL,
  CHECK(`relation` IN ('supports', 'contradicts', 'updates', 'derived_from', 'compacts', 'resolves'))
);
--> statement-breakpoint
INSERT INTO `__new_memory_edge` (`id`, `from_id`, `to_id`, `relation`, `account_id`, `created_at`)
SELECT `id`, `from_id`, `to_id`, `relation`, `account_id`, `created_at`
FROM `memory_edge`;
--> statement-breakpoint
DROP TABLE `memory_edge`;
--> statement-breakpoint
ALTER TABLE `__new_memory_edge` RENAME TO `memory_edge`;
--> statement-breakpoint
CREATE INDEX `memory_edge_account_idx` ON `memory_edge` (`account_id`);
--> statement-breakpoint
CREATE TABLE `__new_preset` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `source` text DEFAULT 'sillytavern' NOT NULL,
  `data_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `account_id` text NOT NULL,
  `version` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
INSERT INTO `__new_preset` (`id`, `name`, `source`, `data_json`, `created_at`, `updated_at`, `account_id`, `version`)
SELECT `id`, `name`, `source`, `data_json`, `created_at`, `updated_at`, `account_id`, `version`
FROM `preset`;
--> statement-breakpoint
DROP TABLE `preset`;
--> statement-breakpoint
ALTER TABLE `__new_preset` RENAME TO `preset`;
--> statement-breakpoint
CREATE INDEX `preset_account_updated_idx` ON `preset` (`account_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `__new_worldbook` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `source` text DEFAULT 'sillytavern' NOT NULL,
  `data_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `account_id` text NOT NULL,
  `version` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
INSERT INTO `__new_worldbook` (`id`, `name`, `source`, `data_json`, `created_at`, `updated_at`, `account_id`, `version`)
SELECT `id`, `name`, `source`, `data_json`, `created_at`, `updated_at`, `account_id`, `version`
FROM `worldbook`;
--> statement-breakpoint
DROP TABLE `worldbook`;
--> statement-breakpoint
ALTER TABLE `__new_worldbook` RENAME TO `worldbook`;
--> statement-breakpoint
CREATE INDEX `worldbook_account_updated_idx` ON `worldbook` (`account_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `__new_regex_profile` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `source` text DEFAULT 'sillytavern' NOT NULL,
  `data_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `account_id` text NOT NULL,
  `version` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
INSERT INTO `__new_regex_profile` (`id`, `name`, `source`, `data_json`, `created_at`, `updated_at`, `account_id`, `version`)
SELECT `id`, `name`, `source`, `data_json`, `created_at`, `updated_at`, `account_id`, `version`
FROM `regex_profile`;
--> statement-breakpoint
DROP TABLE `regex_profile`;
--> statement-breakpoint
ALTER TABLE `__new_regex_profile` RENAME TO `regex_profile`;
--> statement-breakpoint
CREATE INDEX `regex_profile_account_updated_idx` ON `regex_profile` (`account_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `__new_llm_profile` (
  `id` text PRIMARY KEY NOT NULL,
  `preset_name` text NOT NULL,
  `provider` text NOT NULL,
  `model_id` text NOT NULL,
  `base_url` text,
  `api_key_name` text,
  `api_key_encrypted` text NOT NULL,
  `api_key_masked` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `last_used_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `account_id` text NOT NULL,
  CHECK(`provider` IN ('openai', 'anthropic', 'google', 'deepseek', 'xai', 'openai-compatible')),
  CHECK(`status` IN ('active', 'disabled', 'deleted'))
);
--> statement-breakpoint
INSERT INTO `__new_llm_profile` (`id`, `preset_name`, `provider`, `model_id`, `base_url`, `api_key_name`, `api_key_encrypted`, `api_key_masked`, `status`, `last_used_at`, `created_at`, `updated_at`, `account_id`)
SELECT `id`, `preset_name`, `provider`, `model_id`, `base_url`, `api_key_name`, `api_key_encrypted`, `api_key_masked`, `status`, `last_used_at`, `created_at`, `updated_at`, `account_id`
FROM `llm_profile`;
--> statement-breakpoint
DROP TABLE `llm_profile`;
--> statement-breakpoint
ALTER TABLE `__new_llm_profile` RENAME TO `llm_profile`;
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_profile_account_preset_name_uq` ON `llm_profile` (`account_id`, `preset_name`);
--> statement-breakpoint
CREATE INDEX `llm_profile_status_updated_idx` ON `llm_profile` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `__new_llm_profile_binding` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `scope_id` text NOT NULL,
  `profile_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `instance_slot` text NOT NULL DEFAULT '*',
  `account_id` text NOT NULL,
  `params_json` text,
  FOREIGN KEY (`profile_id`) REFERENCES `llm_profile`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK(`scope` IN ('global', 'session'))
);
--> statement-breakpoint
INSERT INTO `__new_llm_profile_binding` (`id`, `scope`, `scope_id`, `profile_id`, `created_at`, `updated_at`, `instance_slot`, `account_id`, `params_json`)
SELECT `id`, `scope`, `scope_id`, `profile_id`, `created_at`, `updated_at`, `instance_slot`, `account_id`, `params_json`
FROM `llm_profile_binding`;
--> statement-breakpoint
DROP TABLE `llm_profile_binding`;
--> statement-breakpoint
ALTER TABLE `__new_llm_profile_binding` RENAME TO `llm_profile_binding`;
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_profile_binding_account_scope_scope_id_slot_uq` ON `llm_profile_binding` (`account_id`, `scope`, `scope_id`, `instance_slot`);
--> statement-breakpoint
CREATE INDEX `llm_profile_binding_profile_account_scope_idx` ON `llm_profile_binding` (`profile_id`, `account_id`, `scope`, `scope_id`, `instance_slot`);
--> statement-breakpoint
CREATE TABLE `__new_llm_instance_config` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE RESTRICT,
  `scope` text NOT NULL,
  `scope_id` text NOT NULL,
  `instance_slot` text NOT NULL,
  `preset_id` text,
  `enabled` integer NOT NULL DEFAULT 1,
  `params_json` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_llm_instance_config` (`id`, `account_id`, `scope`, `scope_id`, `instance_slot`, `preset_id`, `enabled`, `params_json`, `created_at`, `updated_at`)
SELECT `id`, `account_id`, `scope`, `scope_id`, `instance_slot`, `preset_id`, `enabled`, `params_json`, `created_at`, `updated_at`
FROM `llm_instance_config`;
--> statement-breakpoint
DROP TABLE `llm_instance_config`;
--> statement-breakpoint
ALTER TABLE `__new_llm_instance_config` RENAME TO `llm_instance_config`;
--> statement-breakpoint
CREATE INDEX `llm_instance_config_account_scope_idx` ON `llm_instance_config`(`account_id`, `scope`, `scope_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_instance_config_account_scope_slot_uq` ON `llm_instance_config`(`account_id`, `scope`, `scope_id`, `instance_slot`);
--> statement-breakpoint
CREATE TABLE `__new_tool_definition` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `parameters_json` text NOT NULL DEFAULT '{"type":"object","properties":{}}',
  `side_effect_level` text NOT NULL DEFAULT 'none',
  `allowed_slots_json` text NOT NULL DEFAULT '[]',
  `source` text NOT NULL DEFAULT 'preset',
  `source_id` text,
  `enabled` integer NOT NULL DEFAULT 1,
  `handler_type` text NOT NULL DEFAULT 'script',
  `handler_json` text NOT NULL DEFAULT '{}',
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE RESTRICT,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tool_definition` (`id`, `name`, `description`, `parameters_json`, `side_effect_level`, `allowed_slots_json`, `source`, `source_id`, `enabled`, `handler_type`, `handler_json`, `account_id`, `created_at`, `updated_at`)
SELECT `id`, `name`, `description`, `parameters_json`, `side_effect_level`, `allowed_slots_json`, `source`, `source_id`, `enabled`, `handler_type`, `handler_json`, `account_id`, `created_at`, `updated_at`
FROM `tool_definition`;
--> statement-breakpoint
DROP TABLE `tool_definition`;
--> statement-breakpoint
ALTER TABLE `__new_tool_definition` RENAME TO `tool_definition`;
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_definition_account_name_source_source_id_uq`
ON `tool_definition`(`account_id`, `name`, `source`, `source_id`);
--> statement-breakpoint
CREATE INDEX `tool_definition_account_source_idx` ON `tool_definition`(`account_id`, `source`);
--> statement-breakpoint
CREATE TABLE `__new_mcp_server_config` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE RESTRICT,
  `transport` text NOT NULL,
  `config_json` text NOT NULL,
  `tool_prefix` text,
  `enabled` integer NOT NULL DEFAULT 1,
  `connect_timeout_ms` integer NOT NULL DEFAULT 30000,
  `call_timeout_ms` integer NOT NULL DEFAULT 60000,
  `tool_refresh_interval_ms` integer NOT NULL DEFAULT 300000,
  `default_side_effect_level` text NOT NULL DEFAULT 'irreversible',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `secret_config_encrypted` text,
  `secret_config_masked_json` text
);
--> statement-breakpoint
INSERT INTO `__new_mcp_server_config` (`id`, `name`, `account_id`, `transport`, `config_json`, `tool_prefix`, `enabled`, `connect_timeout_ms`, `call_timeout_ms`, `tool_refresh_interval_ms`, `default_side_effect_level`, `created_at`, `updated_at`, `secret_config_encrypted`, `secret_config_masked_json`)
SELECT `id`, `name`, `account_id`, `transport`, `config_json`, `tool_prefix`, `enabled`, `connect_timeout_ms`, `call_timeout_ms`, `tool_refresh_interval_ms`, `default_side_effect_level`, `created_at`, `updated_at`, `secret_config_encrypted`, `secret_config_masked_json`
FROM `mcp_server_config`;
--> statement-breakpoint
DROP TABLE `mcp_server_config`;
--> statement-breakpoint
ALTER TABLE `__new_mcp_server_config` RENAME TO `mcp_server_config`;
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_server_config_account_name_uq` ON `mcp_server_config`(`account_id`, `name`);
--> statement-breakpoint
CREATE INDEX `mcp_server_config_account_updated_idx` ON `mcp_server_config`(`account_id`, `updated_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;

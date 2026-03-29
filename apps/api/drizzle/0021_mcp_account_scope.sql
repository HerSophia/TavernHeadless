CREATE TABLE `__new_mcp_server_config` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `account_id` text NOT NULL DEFAULT 'default-admin' REFERENCES `account`(`id`) ON DELETE RESTRICT,
  `transport` text NOT NULL,
  `config_json` text NOT NULL,
  `tool_prefix` text,
  `enabled` integer NOT NULL DEFAULT 1,
  `connect_timeout_ms` integer NOT NULL DEFAULT 30000,
  `call_timeout_ms` integer NOT NULL DEFAULT 60000,
  `tool_refresh_interval_ms` integer NOT NULL DEFAULT 300000,
  `default_side_effect_level` text NOT NULL DEFAULT 'irreversible',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_mcp_server_config` (
  `id`,
  `name`,
  `account_id`,
  `transport`,
  `config_json`,
  `tool_prefix`,
  `enabled`,
  `connect_timeout_ms`,
  `call_timeout_ms`,
  `tool_refresh_interval_ms`,
  `default_side_effect_level`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `name`,
  'default-admin',
  `transport`,
  `config_json`,
  `tool_prefix`,
  `enabled`,
  `connect_timeout_ms`,
  `call_timeout_ms`,
  `tool_refresh_interval_ms`,
  `default_side_effect_level`,
  `created_at`,
  `updated_at`
FROM `mcp_server_config`;
--> statement-breakpoint
DROP TABLE `mcp_server_config`;
--> statement-breakpoint
ALTER TABLE `__new_mcp_server_config` RENAME TO `mcp_server_config`;
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_server_config_account_name_uq` ON `mcp_server_config`(`account_id`, `name`);
--> statement-breakpoint
CREATE INDEX `mcp_server_config_account_updated_idx` ON `mcp_server_config`(`account_id`, `updated_at`);

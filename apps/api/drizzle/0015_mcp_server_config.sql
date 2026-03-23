CREATE TABLE `mcp_server_config` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
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
CREATE UNIQUE INDEX `mcp_server_config_name_uq` ON `mcp_server_config`(`name`);

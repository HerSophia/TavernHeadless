ALTER TABLE `memory_item` ADD COLUMN `fact_key` text;
--> statement-breakpoint
CREATE INDEX `memory_item_fact_lookup_idx` ON `memory_item`(`account_id`, `scope`, `scope_id`, `type`, `status`, `fact_key`);
--> statement-breakpoint
CREATE TABLE `prompt_snapshot` (
  `floor_id` text PRIMARY KEY NOT NULL REFERENCES `floor`(`id`) ON DELETE CASCADE,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `preset_id` text REFERENCES `preset`(`id`) ON DELETE SET NULL,
  `preset_updated_at` integer,
  `worldbook_id` text REFERENCES `worldbook`(`id`) ON DELETE SET NULL,
  `worldbook_updated_at` integer,
  `regex_profile_id` text REFERENCES `regex_profile`(`id`) ON DELETE SET NULL,
  `regex_profile_updated_at` integer,
  `worldbook_activated_entry_uids_json` text NOT NULL DEFAULT '[]',
  `regex_pre_rule_names_json` text NOT NULL DEFAULT '[]',
  `regex_post_rule_names_json` text NOT NULL DEFAULT '[]',
  `prompt_mode` text NOT NULL,
  `prompt_digest` text NOT NULL,
  `token_estimate` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_snapshot_session_created_idx` ON `prompt_snapshot`(`session_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `prompt_snapshot_digest_idx` ON `prompt_snapshot`(`prompt_digest`);
--> statement-breakpoint
CREATE TABLE `tool_execution_record` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `floor_id` text NOT NULL REFERENCES `floor`(`id`) ON DELETE CASCADE,
  `page_id` text REFERENCES `message_page`(`id`) ON DELETE SET NULL,
  `caller_slot` text NOT NULL,
  `provider_id` text NOT NULL,
  `tool_name` text NOT NULL,
  `args_json` text NOT NULL DEFAULT '{}',
  `result_json` text NOT NULL DEFAULT '{}',
  `status` text NOT NULL DEFAULT 'success',
  `error_message` text,
  `duration_ms` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tool_execution_record_floor_created_idx` ON `tool_execution_record`(`floor_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `tool_execution_record_run_idx` ON `tool_execution_record`(`run_id`);
--> statement-breakpoint
CREATE INDEX `tool_execution_record_page_created_idx` ON `tool_execution_record`(`page_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `tool_execution_record_tool_name_idx` ON `tool_execution_record`(`tool_name`);

CREATE TABLE `tool_call_record` (
  `id` text PRIMARY KEY NOT NULL,
  `page_id` text NOT NULL REFERENCES `message_page`(`id`) ON DELETE CASCADE,
  `seq` integer NOT NULL,
  `caller_slot` text NOT NULL,
  `tool_name` text NOT NULL,
  `args_json` text NOT NULL DEFAULT '{}',
  `result_json` text NOT NULL DEFAULT '{}',
  `status` text NOT NULL DEFAULT 'success',
  `duration_ms` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tool_call_record_page_seq_idx` ON `tool_call_record`(`page_id`, `seq`);
--> statement-breakpoint
CREATE INDEX `tool_call_record_tool_name_idx` ON `tool_call_record`(`tool_name`);
--> statement-breakpoint
CREATE TABLE `tool_definition` (
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
  `account_id` text NOT NULL DEFAULT 'default-admin' REFERENCES `account`(`id`) ON DELETE RESTRICT,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_definition_name_source_source_id_uq` ON `tool_definition`(`name`, `source`, `source_id`);
--> statement-breakpoint
CREATE INDEX `tool_definition_account_source_idx` ON `tool_definition`(`account_id`, `source`);

CREATE TABLE `session` (
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
  CHECK(`status` IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE `floor` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `floor_no` integer NOT NULL,
  `branch_id` text DEFAULT 'main' NOT NULL,
  `parent_floor_id` text,
  `state` text DEFAULT 'draft' NOT NULL,
  `token_in` integer DEFAULT 0 NOT NULL,
  `token_out` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK(`state` IN ('draft', 'generating', 'committed', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_session_no_branch_uq` ON `floor` (`session_id`,`floor_no`,`branch_id`);
--> statement-breakpoint
CREATE TABLE `message_page` (
  `id` text PRIMARY KEY NOT NULL,
  `floor_id` text NOT NULL,
  `page_no` integer NOT NULL,
  `page_kind` text NOT NULL,
  `is_active` integer DEFAULT true NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `checksum` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`floor_id`) REFERENCES `floor`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK(`page_kind` IN ('input', 'output', 'mixed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_page_floor_no_version_uq` ON `message_page` (`floor_id`,`page_no`,`version`);
--> statement-breakpoint
CREATE TABLE `message` (
  `id` text PRIMARY KEY NOT NULL,
  `page_id` text NOT NULL,
  `seq` integer NOT NULL,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `content_format` text DEFAULT 'text' NOT NULL,
  `token_count` integer DEFAULT 0 NOT NULL,
  `is_hidden` integer DEFAULT false NOT NULL,
  `source` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`page_id`) REFERENCES `message_page`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK(`role` IN ('user', 'assistant', 'system', 'narrator')),
  CHECK(`content_format` IN ('text', 'markdown', 'json'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_page_seq_uq` ON `message` (`page_id`,`seq`);
--> statement-breakpoint
CREATE TABLE `variable` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `scope_id` text NOT NULL,
  `key` text NOT NULL,
  `value_json` text NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK(`scope` IN ('global', 'chat', 'floor', 'page'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variable_scope_scope_id_key_uq` ON `variable` (`scope`,`scope_id`,`key`);
--> statement-breakpoint
CREATE TABLE `memory_item` (
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
  CHECK(`scope` IN ('global', 'chat', 'floor')),
  CHECK(`type` IN ('fact', 'summary', 'open_loop')),
  CHECK(`status` IN ('active', 'deprecated'))
);
--> statement-breakpoint
CREATE TABLE `memory_edge` (
  `id` text PRIMARY KEY NOT NULL,
  `from_id` text NOT NULL,
  `to_id` text NOT NULL,
  `relation` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`from_id`) REFERENCES `memory_item`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`to_id`) REFERENCES `memory_item`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK(`relation` IN ('supports', 'contradicts', 'updates'))
);

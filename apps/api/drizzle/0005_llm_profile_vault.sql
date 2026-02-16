CREATE TABLE `llm_profile` (
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
  CHECK(`provider` IN ('openai', 'anthropic', 'google', 'deepseek', 'xai', 'openai-compatible')),
  CHECK(`status` IN ('active', 'disabled', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_profile_preset_name_uq` ON `llm_profile` (`preset_name`);
--> statement-breakpoint
CREATE INDEX `llm_profile_status_updated_idx` ON `llm_profile` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `llm_profile_binding` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `scope_id` text NOT NULL,
  `profile_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`profile_id`) REFERENCES `llm_profile`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK(`scope` IN ('global', 'session'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_profile_binding_scope_scope_id_uq` ON `llm_profile_binding` (`scope`,`scope_id`);
--> statement-breakpoint
CREATE INDEX `llm_profile_binding_profile_scope_idx` ON `llm_profile_binding` (`profile_id`,`scope`,`scope_id`);

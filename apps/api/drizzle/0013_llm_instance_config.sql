CREATE TABLE `llm_instance_config` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL DEFAULT 'default-admin' REFERENCES `account`(`id`) ON DELETE RESTRICT,
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
CREATE UNIQUE INDEX `llm_instance_config_account_scope_slot_uq` ON `llm_instance_config`(`account_id`, `scope`, `scope_id`, `instance_slot`);
--> statement-breakpoint
CREATE INDEX `llm_instance_config_account_scope_idx` ON `llm_instance_config`(`account_id`, `scope`, `scope_id`);

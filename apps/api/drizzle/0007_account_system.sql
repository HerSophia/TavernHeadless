CREATE TABLE `account` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `role` text DEFAULT 'user' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `is_default` integer DEFAULT false NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK(`role` IN ('admin', 'user')),
  CHECK(`status` IN ('active', 'disabled'))
);
--> statement-breakpoint
INSERT INTO `account` (`id`, `name`, `role`, `status`, `is_default`, `created_at`, `updated_at`)
VALUES ('default-admin', 'Default Admin', 'admin', 'active', true, unixepoch() * 1000, unixepoch() * 1000);
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `account_id` text NOT NULL DEFAULT 'default-admin';
--> statement-breakpoint
CREATE INDEX `session_account_updated_idx` ON `session` (`account_id`, `updated_at`);
--> statement-breakpoint
ALTER TABLE `llm_profile` ADD COLUMN `account_id` text NOT NULL DEFAULT 'default-admin';
--> statement-breakpoint
DROP INDEX IF EXISTS `llm_profile_preset_name_uq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_profile_account_preset_name_uq` ON `llm_profile` (`account_id`, `preset_name`);
--> statement-breakpoint
ALTER TABLE `llm_profile_binding` ADD COLUMN `account_id` text NOT NULL DEFAULT 'default-admin';
--> statement-breakpoint
DROP INDEX IF EXISTS `llm_profile_binding_scope_scope_id_slot_uq`;
--> statement-breakpoint
DROP INDEX IF EXISTS `llm_profile_binding_scope_scope_id_uq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_profile_binding_account_scope_scope_id_slot_uq` ON `llm_profile_binding` (`account_id`, `scope`, `scope_id`, `instance_slot`);
--> statement-breakpoint
DROP INDEX IF EXISTS `llm_profile_binding_profile_scope_idx`;
--> statement-breakpoint
CREATE INDEX `llm_profile_binding_profile_account_scope_idx` ON `llm_profile_binding` (`profile_id`, `account_id`, `scope`, `scope_id`, `instance_slot`);

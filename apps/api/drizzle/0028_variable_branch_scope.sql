CREATE TABLE `__new_variable` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL DEFAULT 'default-admin' REFERENCES `account`(`id`) ON DELETE RESTRICT,
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

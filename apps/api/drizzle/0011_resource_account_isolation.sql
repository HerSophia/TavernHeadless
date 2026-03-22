-- Add account_id to resource tables for multi-account isolation
ALTER TABLE `character` ADD COLUMN `account_id` text NOT NULL DEFAULT 'default-admin';
--> statement-breakpoint
CREATE INDEX `character_account_updated_idx` ON `character` (`account_id`, `updated_at`);
--> statement-breakpoint
ALTER TABLE `preset` ADD COLUMN `account_id` text NOT NULL DEFAULT 'default-admin';
--> statement-breakpoint
CREATE INDEX `preset_account_updated_idx` ON `preset` (`account_id`, `updated_at`);
--> statement-breakpoint
ALTER TABLE `worldbook` ADD COLUMN `account_id` text NOT NULL DEFAULT 'default-admin';
--> statement-breakpoint
CREATE INDEX `worldbook_account_updated_idx` ON `worldbook` (`account_id`, `updated_at`);
--> statement-breakpoint
ALTER TABLE `regex_profile` ADD COLUMN `account_id` text NOT NULL DEFAULT 'default-admin';
--> statement-breakpoint
CREATE INDEX `regex_profile_account_updated_idx` ON `regex_profile` (`account_id`, `updated_at`);
--> statement-breakpoint
ALTER TABLE `memory_item` ADD COLUMN `account_id` text NOT NULL DEFAULT 'default-admin';
--> statement-breakpoint
CREATE INDEX `memory_item_account_scope_idx` ON `memory_item` (`account_id`, `scope`, `scope_id`);
--> statement-breakpoint
ALTER TABLE `memory_edge` ADD COLUMN `account_id` text NOT NULL DEFAULT 'default-admin';
--> statement-breakpoint
CREATE INDEX `memory_edge_account_idx` ON `memory_edge` (`account_id`);

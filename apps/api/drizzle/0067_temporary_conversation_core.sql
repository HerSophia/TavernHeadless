ALTER TABLE `session` ADD COLUMN `kind` text NOT NULL DEFAULT 'default' CHECK(`kind` IN ('default', 'temporary'));
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `purpose` text;
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `temporary_source_session_id` text;
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `temporary_snapshot_digest` text;
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `retention_policy` text CHECK(`retention_policy` IN ('delete_on_finalize', 'keep_for_debug'));
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `visibility` text CHECK(`visibility` IN ('internal', 'client_visible'));
--> statement-breakpoint
CREATE INDEX `session_account_kind_updated_idx` ON `session` (`account_id`, `kind`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `session_temporary_source_session_idx` ON `session` (`temporary_source_session_id`);

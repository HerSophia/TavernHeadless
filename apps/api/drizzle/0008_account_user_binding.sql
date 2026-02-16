CREATE TABLE `account_user` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL DEFAULT 'default-admin' REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict,
  `name` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK(`status` IN ('active', 'disabled', 'deleted'))
);
--> statement-breakpoint
CREATE INDEX `account_user_account_updated_idx` ON `account_user` (`account_id`, `updated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_user_account_name_uq` ON `account_user` (`account_id`, `name`);
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `user_id` text REFERENCES `account_user`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `user_snapshot_json` text;
--> statement-breakpoint
ALTER TABLE `floor` ADD COLUMN `metadata_json` text;

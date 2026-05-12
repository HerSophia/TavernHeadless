CREATE TABLE `vc_tag` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `name` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `session_id` text,
  `metadata_json` text,
  `created_by_operation_id` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by_operation_id`) REFERENCES `operation_log`(`id`) ON UPDATE no action ON DELETE set null,
  CHECK(`target_type` IN ('floor', 'asset_version'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vc_tag_account_name_uq` ON `vc_tag` (`account_id`,`name`);
--> statement-breakpoint
CREATE INDEX `vc_tag_account_target_idx` ON `vc_tag` (`account_id`,`target_type`,`target_id`);
--> statement-breakpoint
CREATE INDEX `vc_tag_account_session_created_idx` ON `vc_tag` (`account_id`,`session_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `vc_tag_operation_idx` ON `vc_tag` (`created_by_operation_id`);

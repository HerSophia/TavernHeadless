CREATE TABLE `operation_log` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `actor_type` text NOT NULL,
  `actor_id` text,
  `operation_group_id` text,
  `request_id` text,
  `source_type` text NOT NULL,
  `action` text NOT NULL,
  `status` text NOT NULL,
  `session_id` text,
  `branch_id` text,
  `floor_id` text,
  `run_id` text,
  `target_type` text NOT NULL,
  `target_id` text,
  `before_ref_json` text,
  `after_ref_json` text,
  `diff_json` text,
  `metadata_json` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `operation_log_account_created_idx` ON `operation_log` (`account_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `operation_log_session_created_idx` ON `operation_log` (`session_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `operation_log_account_target_created_idx` ON `operation_log` (`account_id`,`target_type`,`target_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `operation_log_group_idx` ON `operation_log` (`operation_group_id`);
--> statement-breakpoint
CREATE INDEX `operation_log_request_idx` ON `operation_log` (`request_id`);
--> statement-breakpoint
CREATE INDEX `operation_log_floor_created_idx` ON `operation_log` (`floor_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `operation_log_run_created_idx` ON `operation_log` (`run_id`,`created_at`);

CREATE TABLE `branch_local_variable_snapshot` (
  `floor_id` text PRIMARY KEY NOT NULL REFERENCES `floor`(`id`) ON DELETE cascade,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `branch_id` text NOT NULL,
  `values_json` text DEFAULT '{}' NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `branch_local_var_snapshot_account_session_created_idx` ON `branch_local_variable_snapshot` (`account_id`,`session_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `branch_local_var_snapshot_account_session_branch_created_idx` ON `branch_local_variable_snapshot` (`account_id`,`session_id`,`branch_id`,`created_at`);

CREATE TABLE `page_staged_variable_write` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `branch_id` text NOT NULL,
  `floor_id` text NOT NULL REFERENCES `floor`(`id`) ON DELETE cascade,
  `page_id` text NOT NULL REFERENCES `message_page`(`id`) ON DELETE cascade,
  `key` text NOT NULL,
  `op` text NOT NULL,
  `value_json` text,
  `intent` text NOT NULL,
  `conflict_policy` text NOT NULL,
  `source_json` text DEFAULT '{}' NOT NULL,
  `evidence_json` text DEFAULT '{}' NOT NULL,
  `reason` text NOT NULL,
  `status` text NOT NULL,
  `decision_reason` text,
  `created_at` integer NOT NULL,
  `resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `page_staged_variable_write_page_status_created_idx` ON `page_staged_variable_write` (`page_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `page_staged_variable_write_floor_created_idx` ON `page_staged_variable_write` (`floor_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `page_staged_variable_write_account_session_branch_created_idx` ON `page_staged_variable_write` (`account_id`,`session_id`,`branch_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `variable_promotion_trace` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `branch_id` text NOT NULL,
  `floor_id` text NOT NULL REFERENCES `floor`(`id`) ON DELETE cascade,
  `page_id` text REFERENCES `message_page`(`id`) ON DELETE cascade,
  `staged_write_id` text REFERENCES `page_staged_variable_write`(`id`) ON DELETE set null,
  `key` text NOT NULL,
  `from_scope` text NOT NULL,
  `from_scope_id` text NOT NULL,
  `to_scope` text NOT NULL,
  `to_scope_id` text NOT NULL,
  `conflict_policy` text NOT NULL,
  `source_variable_id` text,
  `target_variable_id` text,
  `value_json` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `variable_promotion_trace_page_created_idx` ON `variable_promotion_trace` (`page_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `variable_promotion_trace_floor_created_idx` ON `variable_promotion_trace` (`floor_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `variable_promotion_trace_account_session_branch_created_idx` ON `variable_promotion_trace` (`account_id`,`session_id`,`branch_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `variable_promotion_trace_staged_write_idx` ON `variable_promotion_trace` (`staged_write_id`);

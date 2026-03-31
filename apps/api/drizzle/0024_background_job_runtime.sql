CREATE TABLE `runtime_scope_state` (
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `scope_type` text NOT NULL,
  `scope_key` text NOT NULL,
  `revision` integer NOT NULL DEFAULT 0,
  `lease_owner` text,
  `lease_until` integer,
  `last_processed_at` integer,
  `last_success_job_id` text,
  `metadata_json` text NOT NULL DEFAULT '{}',
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_scope_state_account_scope_uq`
  ON `runtime_scope_state` (`account_id`, `scope_type`, `scope_key`);
--> statement-breakpoint
CREATE INDEX `runtime_scope_state_lease_idx` ON `runtime_scope_state` (`lease_until`);
--> statement-breakpoint
CREATE TABLE `runtime_job` (
  `id` text PRIMARY KEY NOT NULL,
  `job_type` text NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `scope_type` text NOT NULL,
  `scope_key` text NOT NULL,
  `session_id` text REFERENCES `session`(`id`) ON DELETE set null,
  `floor_id` text REFERENCES `floor`(`id`) ON DELETE set null,
  `page_id` text REFERENCES `message_page`(`id`) ON DELETE set null,
  `status` text NOT NULL DEFAULT 'pending',
  `phase` text,
  `payload_json` text NOT NULL DEFAULT '{}',
  `state_json` text,
  `result_json` text,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `max_attempts` integer NOT NULL DEFAULT 5,
  `available_at` integer NOT NULL,
  `started_at` integer,
  `finished_at` integer,
  `lease_owner` text,
  `lease_until` integer,
  `based_on_revision` integer,
  `dedupe_key` text,
  `progress_current` integer NOT NULL DEFAULT 0,
  `progress_total` integer,
  `progress_message` text,
  `last_error` text,
  `last_error_code` text,
  `last_error_class` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK(`status` IN ('pending', 'leased', 'running', 'retry_waiting', 'succeeded', 'dead_letter', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `runtime_job_due_idx` ON `runtime_job` (`status`, `available_at`);
--> statement-breakpoint
CREATE INDEX `runtime_job_scope_idx` ON `runtime_job` (`account_id`, `scope_type`, `scope_key`, `created_at`);
--> statement-breakpoint
CREATE INDEX `runtime_job_session_idx` ON `runtime_job` (`account_id`, `session_id`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_job_account_type_dedupe_uq`
  ON `runtime_job` (`account_id`, `job_type`, `dedupe_key`);

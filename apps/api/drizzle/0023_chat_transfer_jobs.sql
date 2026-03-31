CREATE TABLE `chat_transfer_job` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `job_kind` text NOT NULL,
  `format` text,
  `status` text NOT NULL DEFAULT 'pending',
  `phase` text NOT NULL DEFAULT 'queued',
  `requested_session_id` text REFERENCES `session`(`id`) ON DELETE set null,
  `result_session_id` text REFERENCES `session`(`id`) ON DELETE set null,
  `request_json` text NOT NULL DEFAULT '{}',
  `result_json` text,
  `input_artifact_path` text,
  `normalized_artifact_path` text,
  `output_artifact_path` text,
  `output_expires_at` integer,
  `progress_current` integer NOT NULL DEFAULT 0,
  `progress_total` integer,
  `progress_message` text,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `max_attempts` integer NOT NULL DEFAULT 5,
  `available_at` integer NOT NULL,
  `lease_owner` text,
  `lease_until` integer,
  `last_error` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `chat_transfer_job_status_available_idx` ON `chat_transfer_job` (`status`, `available_at`);
--> statement-breakpoint
CREATE INDEX `chat_transfer_job_account_status_available_idx` ON `chat_transfer_job` (`account_id`, `status`, `available_at`);
--> statement-breakpoint
CREATE INDEX `chat_transfer_job_account_kind_created_idx` ON `chat_transfer_job` (`account_id`, `job_kind`, `created_at`);
--> statement-breakpoint
CREATE INDEX `chat_transfer_job_account_requested_session_created_idx` ON `chat_transfer_job` (`account_id`, `requested_session_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `chat_transfer_job_output_expires_idx` ON `chat_transfer_job` (`output_expires_at`);

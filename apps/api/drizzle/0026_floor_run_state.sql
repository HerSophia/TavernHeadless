CREATE TABLE `floor_run_state` (
  `floor_id` text PRIMARY KEY NOT NULL REFERENCES `floor`(`id`) ON DELETE cascade,
  `run_id` text NOT NULL,
  `run_type` text NOT NULL,
  `status` text NOT NULL,
  `phase` text NOT NULL,
  `public_phase` text NOT NULL,
  `phase_seq` integer NOT NULL DEFAULT 0,
  `attempt_no` integer NOT NULL DEFAULT 1,
  `pending_output_json` text,
  `verifier_json` text,
  `error_json` text,
  `started_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer,
  CHECK(`run_type` IN ('respond', 'regenerate_page', 'retry_turn', 'edit_and_regenerate')),
  CHECK(`status` IN ('running', 'completed', 'failed', 'cancelled')),
  CHECK(`phase` IN ('input_recorded', 'semantic_resolved', 'prechecked', 'prompt_assembled', 'page_generating', 'candidate_generated', 'verifier_checked', 'transaction_prepared', 'transaction_committed', 'post_commit_scheduled')),
  CHECK(`public_phase` IN ('preparing', 'generating', 'verifying', 'committing', 'post_processing'))
);
--> statement-breakpoint
CREATE INDEX `floor_run_state_status_updated_idx` ON `floor_run_state` (`status`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `floor_run_state_run_id_idx` ON `floor_run_state` (`run_id`);

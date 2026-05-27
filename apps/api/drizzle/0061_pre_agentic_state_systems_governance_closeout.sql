ALTER TABLE `page_staged_variable_write` ADD COLUMN `source_kind` text NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE `page_staged_variable_write` ADD COLUMN `actor_client_id` text REFERENCES `client`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `page_staged_variable_write` ADD COLUMN `decision_code` text;
--> statement-breakpoint
ALTER TABLE `page_staged_variable_write` ADD COLUMN `linked_session_state_mutation_id` text REFERENCES `session_state_mutation`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `variable_promotion_trace` ADD COLUMN `source_kind` text NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE `variable_promotion_trace` ADD COLUMN `actor_client_id` text REFERENCES `client`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `variable_promotion_trace` ADD COLUMN `source_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `variable_promotion_trace` ADD COLUMN `evidence_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `variable_promotion_trace` ADD COLUMN `decision_code` text;
--> statement-breakpoint
ALTER TABLE `variable_promotion_trace` ADD COLUMN `decision_reason` text;
--> statement-breakpoint
ALTER TABLE `variable_promotion_trace` ADD COLUMN `linked_session_state_mutation_id` text REFERENCES `session_state_mutation`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE TABLE `page_staged_memory_proposal_batch` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `proposal_batch_id` text NOT NULL,
  `page_id` text NOT NULL REFERENCES `message_page`(`id`) ON DELETE cascade,
  `floor_id` text NOT NULL REFERENCES `floor`(`id`) ON DELETE cascade,
  `branch_id` text,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `runtime_mode` text NOT NULL,
  `strategy` text,
  `source_kind` text NOT NULL DEFAULT 'memory_runtime',
  `actor_client_id` text REFERENCES `client`(`id`) ON DELETE set null,
  `source_json` text NOT NULL DEFAULT '{}',
  `evidence_json` text NOT NULL DEFAULT '{}',
  `proposal_status` text NOT NULL,
  `promotion_status` text,
  `decision_reason` text,
  `decision_code` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `decided_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_staged_memory_proposal_batch_batch_uq` ON `page_staged_memory_proposal_batch` (`proposal_batch_id`);
--> statement-breakpoint
CREATE INDEX `page_staged_memory_proposal_batch_page_created_idx` ON `page_staged_memory_proposal_batch` (`page_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `page_staged_memory_proposal_batch_floor_created_idx` ON `page_staged_memory_proposal_batch` (`floor_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `page_staged_memory_proposal_batch_promotion_created_idx` ON `page_staged_memory_proposal_batch` (`promotion_status`, `created_at`);
--> statement-breakpoint
CREATE TABLE `page_staged_memory_proposal_item` (
  `id` text PRIMARY KEY NOT NULL,
  `batch_id` text NOT NULL REFERENCES `page_staged_memory_proposal_batch`(`id`) ON DELETE cascade,
  `memory_kind` text NOT NULL,
  `operation_kind` text NOT NULL,
  `target_scope` text NOT NULL,
  `payload_json` text NOT NULL,
  `importance` real,
  `reason` text,
  `evidence_json` text NOT NULL DEFAULT '{}',
  `status` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `page_staged_memory_proposal_item_batch_created_idx` ON `page_staged_memory_proposal_item` (`batch_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `page_staged_memory_proposal_item_batch_status_created_idx` ON `page_staged_memory_proposal_item` (`batch_id`, `status`, `created_at`);
--> statement-breakpoint
ALTER TABLE `session_state_mutation` ADD COLUMN `source_kind` text;
--> statement-breakpoint
ALTER TABLE `session_state_mutation` ADD COLUMN `source_branch_id` text;
--> statement-breakpoint
ALTER TABLE `session_state_mutation` ADD COLUMN `source_page_id` text REFERENCES `message_page`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `session_state_mutation` ADD COLUMN `actor_client_id` text REFERENCES `client`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `session_state_mutation` ADD COLUMN `commit_mode` text NOT NULL DEFAULT 'turn_bound';
--> statement-breakpoint
ALTER TABLE `session_state_mutation` ADD COLUMN `decision_status` text NOT NULL DEFAULT 'accepted';
--> statement-breakpoint
ALTER TABLE `session_state_mutation` ADD COLUMN `decision_reason` text;
--> statement-breakpoint
ALTER TABLE `session_state_mutation` ADD COLUMN `decision_code` text;
--> statement-breakpoint
ALTER TABLE `session_state_mutation` ADD COLUMN `linked_variable_stage_id` text REFERENCES `page_staged_variable_write`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `session_state_mutation_source_page_idx` ON `session_state_mutation` (`source_page_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `session_state_mutation_linked_variable_stage_idx` ON `session_state_mutation` (`linked_variable_stage_id`);

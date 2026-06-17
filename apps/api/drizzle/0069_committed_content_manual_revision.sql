CREATE TABLE `committed_content_manual_revision` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `branch_id` text NOT NULL,
  `floor_id` text NOT NULL REFERENCES `floor`(`id`) ON DELETE cascade,
  `page_id` text NOT NULL REFERENCES `message_page`(`id`) ON DELETE cascade,
  `message_id` text NOT NULL REFERENCES `message`(`id`) ON DELETE cascade,
  `requested_target_kind` text NOT NULL CHECK(`requested_target_kind` IN ('message', 'page')),
  `requested_target_id` text NOT NULL,
  `revision_no` integer NOT NULL,
  `original_content` text NOT NULL,
  `previous_content` text NOT NULL,
  `edited_content` text NOT NULL,
  `reason` text,
  `actor_type` text NOT NULL CHECK(`actor_type` IN ('account', 'client')),
  `actor_id` text NOT NULL,
  `actor_account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `actor_client_id` text REFERENCES `client`(`id`) ON DELETE set null,
  `operation_log_id` text REFERENCES `operation_log`(`id`) ON DELETE cascade,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `committed_content_manual_revision_message_no_uq` ON `committed_content_manual_revision` (`message_id`, `revision_no`);
--> statement-breakpoint
CREATE UNIQUE INDEX `committed_content_manual_revision_operation_log_uq` ON `committed_content_manual_revision` (`operation_log_id`);
--> statement-breakpoint
CREATE INDEX `committed_content_manual_revision_floor_created_idx` ON `committed_content_manual_revision` (`floor_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `committed_content_manual_revision_page_created_idx` ON `committed_content_manual_revision` (`page_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `committed_content_manual_revision_session_branch_created_idx` ON `committed_content_manual_revision` (`session_id`, `branch_id`, `created_at`);

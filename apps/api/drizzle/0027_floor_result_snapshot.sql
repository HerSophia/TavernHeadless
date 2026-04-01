CREATE TABLE `floor_result_snapshot` (
  `floor_id` text PRIMARY KEY NOT NULL REFERENCES `floor`(`id`) ON DELETE cascade,
  `output_page_id` text NOT NULL REFERENCES `message_page`(`id`) ON DELETE cascade,
  `assistant_message_id` text NOT NULL REFERENCES `message`(`id`) ON DELETE cascade,
  `generated_text` text NOT NULL,
  `summaries_json` text NOT NULL DEFAULT '[]',
  `usage_json` text NOT NULL DEFAULT '{}',
  `verifier_json` text,
  `committed_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `floor_result_snapshot_committed_at_idx` ON `floor_result_snapshot` (`committed_at`);
--> statement-breakpoint
CREATE INDEX `floor_result_snapshot_output_page_idx` ON `floor_result_snapshot` (`output_page_id`);

CREATE TABLE `derived_output` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `account_id` text NOT NULL,
  `owner_account_id` text NOT NULL,
  `source_session_id` text,
  `source_floor_id` text,
  `source_page_id` text,
  `domain` text NOT NULL,
  `value_json` text NOT NULL DEFAULT '{}',
  `status` text NOT NULL DEFAULT 'draft',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE restrict,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE restrict,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE restrict,
  FOREIGN KEY (`owner_account_id`) REFERENCES `account`(`id`) ON DELETE restrict,
  FOREIGN KEY (`source_session_id`) REFERENCES `session`(`id`) ON DELETE set null,
  FOREIGN KEY (`source_floor_id`) REFERENCES `floor`(`id`) ON DELETE set null,
  FOREIGN KEY (`source_page_id`) REFERENCES `message_page`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `project_inbox_item` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `account_id` text NOT NULL,
  `sender_account_id` text NOT NULL,
  `type` text NOT NULL,
  `title` text,
  `payload_json` text NOT NULL DEFAULT '{}',
  `source_event_id` text,
  `source_session_id` text,
  `source_floor_id` text,
  `source_page_id` text,
  `status` text NOT NULL DEFAULT 'pending',
  `decided_by_account_id` text,
  `decided_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE restrict,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE restrict,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE restrict,
  FOREIGN KEY (`sender_account_id`) REFERENCES `account`(`id`) ON DELETE restrict,
  FOREIGN KEY (`source_event_id`) REFERENCES `project_event`(`id`) ON DELETE set null,
  FOREIGN KEY (`source_session_id`) REFERENCES `session`(`id`) ON DELETE set null,
  FOREIGN KEY (`source_floor_id`) REFERENCES `floor`(`id`) ON DELETE set null,
  FOREIGN KEY (`source_page_id`) REFERENCES `message_page`(`id`) ON DELETE set null,
  FOREIGN KEY (`decided_by_account_id`) REFERENCES `account`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `derived_output_project_created_idx` ON `derived_output` (`project_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `derived_output_project_domain_idx` ON `derived_output` (`project_id`, `domain`, `created_at`);
--> statement-breakpoint
CREATE INDEX `derived_output_owner_project_idx` ON `derived_output` (`owner_account_id`, `project_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `derived_output_source_session_idx` ON `derived_output` (`source_session_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `derived_output_workspace_created_idx` ON `derived_output` (`workspace_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_inbox_project_status_created_idx` ON `project_inbox_item` (`project_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_inbox_project_created_idx` ON `project_inbox_item` (`project_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_inbox_sender_project_idx` ON `project_inbox_item` (`sender_account_id`, `project_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_inbox_workspace_created_idx` ON `project_inbox_item` (`workspace_id`, `created_at`);

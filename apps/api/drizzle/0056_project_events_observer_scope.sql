ALTER TABLE `operation_log` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `operation_log` ADD COLUMN `project_id` text REFERENCES `project`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `operation_log` ADD COLUMN `actor_account_id` text REFERENCES `account`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE TABLE `project_event_sequence` (
  `project_id` text PRIMARY KEY NOT NULL,
  `current_sequence` integer NOT NULL DEFAULT 0,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `project_event` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `type` text NOT NULL,
  `visibility` text NOT NULL DEFAULT 'project',
  `source` text NOT NULL DEFAULT 'api',
  `actor_account_id` text,
  `session_id` text,
  `branch_id` text,
  `floor_id` text,
  `page_id` text,
  `message_id` text,
  `operation_log_id` text,
  `correlation_id` text,
  `causation_event_id` text,
  `payload_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE restrict,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE restrict,
  FOREIGN KEY (`actor_account_id`) REFERENCES `account`(`id`) ON DELETE set null,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE set null,
  FOREIGN KEY (`floor_id`) REFERENCES `floor`(`id`) ON DELETE set null,
  FOREIGN KEY (`page_id`) REFERENCES `message_page`(`id`) ON DELETE set null,
  FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE set null,
  FOREIGN KEY (`operation_log_id`) REFERENCES `operation_log`(`id`) ON DELETE set null,
  FOREIGN KEY (`causation_event_id`) REFERENCES `project_event`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `project_membership` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `account_id` text NOT NULL,
  `role` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `created_by_account_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE restrict,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE restrict,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE restrict,
  FOREIGN KEY (`created_by_account_id`) REFERENCES `account`(`id`) ON DELETE set null
);
--> statement-breakpoint
UPDATE `operation_log`
SET `actor_account_id` = `account_id`
WHERE `actor_account_id` IS NULL;
--> statement-breakpoint
UPDATE `operation_log`
SET `workspace_id` = COALESCE(
  CASE
    WHEN `metadata_json` IS NOT NULL AND json_valid(`metadata_json`) THEN NULLIF(TRIM(CAST(json_extract(`metadata_json`, '$.workspace_id') AS TEXT)), '')
  END,
  (
    SELECT `session`.`workspace_id`
    FROM `session`
    WHERE `session`.`id` = `operation_log`.`session_id`
  )
)
WHERE `workspace_id` IS NULL;
--> statement-breakpoint
UPDATE `operation_log`
SET `project_id` = COALESCE(
  CASE
    WHEN `metadata_json` IS NOT NULL AND json_valid(`metadata_json`) THEN NULLIF(TRIM(CAST(json_extract(`metadata_json`, '$.project_id') AS TEXT)), '')
  END,
  (
    SELECT `session`.`project_id`
    FROM `session`
    WHERE `session`.`id` = `operation_log`.`session_id`
  )
)
WHERE `project_id` IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `project_membership` (
  `id`,
  `workspace_id`,
  `project_id`,
  `account_id`,
  `role`,
  `status`,
  `created_by_account_id`,
  `created_at`,
  `updated_at`
)
SELECT
  'pmem_owner_' || `project`.`id`,
  `project`.`workspace_id`,
  `project`.`id`,
  `project`.`account_id`,
  'owner',
  'active',
  NULL,
  `project`.`created_at`,
  `project`.`updated_at`
FROM `project`;
--> statement-breakpoint
INSERT OR IGNORE INTO `project_event_sequence` (
  `project_id`,
  `current_sequence`,
  `updated_at`
)
SELECT
  `project`.`id`,
  0,
  `project`.`updated_at`
FROM `project`;
--> statement-breakpoint
CREATE INDEX `operation_log_workspace_created_idx` ON `operation_log` (`workspace_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `operation_log_project_created_idx` ON `operation_log` (`project_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `operation_log_actor_account_created_idx` ON `operation_log` (`actor_account_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_event_project_sequence_idx` ON `project_event` (`project_id`, `sequence`);
--> statement-breakpoint
CREATE INDEX `project_event_workspace_created_idx` ON `project_event` (`workspace_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_event_project_created_idx` ON `project_event` (`project_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_event_session_sequence_idx` ON `project_event` (`session_id`, `sequence`);
--> statement-breakpoint
CREATE INDEX `project_event_project_type_sequence_idx` ON `project_event` (`project_id`, `type`, `sequence`);
--> statement-breakpoint
CREATE INDEX `project_event_operation_log_idx` ON `project_event` (`operation_log_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_event_project_sequence_uq` ON `project_event` (`project_id`, `sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_membership_project_account_uq` ON `project_membership` (`project_id`, `account_id`);
--> statement-breakpoint
CREATE INDEX `project_membership_account_status_idx` ON `project_membership` (`account_id`, `status`);
--> statement-breakpoint
CREATE INDEX `project_membership_project_role_status_idx` ON `project_membership` (`project_id`, `role`, `status`);
--> statement-breakpoint
CREATE INDEX `project_membership_workspace_account_idx` ON `project_membership` (`workspace_id`, `account_id`);

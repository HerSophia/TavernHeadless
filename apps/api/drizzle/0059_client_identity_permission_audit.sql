CREATE TABLE `client` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `name` text NOT NULL,
  `kind` text NOT NULL DEFAULT 'custom',
  `status` text NOT NULL DEFAULT 'active',
  `is_default` integer NOT NULL DEFAULT 0,
  `metadata_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `client_api_key` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `client_id` text NOT NULL,
  `name` text,
  `key_prefix` text NOT NULL,
  `key_hash` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `last_used_at` integer,
  `expires_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE restrict,
  FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `project_membership` ADD COLUMN `subject_type` text;
--> statement-breakpoint
ALTER TABLE `project_membership` ADD COLUMN `subject_id` text;
--> statement-breakpoint
ALTER TABLE `project_membership` ADD COLUMN `client_id` text REFERENCES `client`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `project_membership` ADD COLUMN `created_by_client_id` text REFERENCES `client`(`id`) ON DELETE set null;
--> statement-breakpoint
UPDATE `project_membership`
SET `subject_type` = 'account', `subject_id` = `account_id`
WHERE `subject_type` IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS `project_membership_project_account_uq`;
--> statement-breakpoint
ALTER TABLE `operation_log` ADD COLUMN `actor_client_id` text REFERENCES `client`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `operation_log` ADD COLUMN `permission_action` text;
--> statement-breakpoint
ALTER TABLE `operation_log` ADD COLUMN `result` text;
--> statement-breakpoint
ALTER TABLE `operation_log` ADD COLUMN `reason` text;
--> statement-breakpoint
ALTER TABLE `project_event` ADD COLUMN `actor_client_id` text REFERENCES `client`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `derived_output` ADD COLUMN `owner_client_id` text REFERENCES `client`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `project_inbox_item` ADD COLUMN `sender_client_id` text REFERENCES `client`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `project_inbox_item` ADD COLUMN `decided_by_client_id` text REFERENCES `client`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `client_account_status_idx` ON `client` (`account_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `client_account_kind_idx` ON `client`(`account_id`, `kind`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_account_default_uq` ON `client` (`account_id`) WHERE `is_default` = 1;
--> statement-breakpoint
CREATE UNIQUE INDEX `client_api_key_hash_uq` ON `client_api_key` (`key_hash`);
--> statement-breakpoint
CREATE INDEX `client_api_key_client_status_idx` ON `client_api_key` (`client_id`,`status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `client_api_key_account_status_idx` ON `client_api_key` (`account_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_membership_project_subject_uq` ON `project_membership` (`project_id`, `subject_type`, `subject_id`);
--> statement-breakpoint
CREATE INDEX `project_membership_project_subject_status_idx` ON `project_membership` (`project_id`, `subject_type`, `subject_id`, `status`);
--> statement-breakpoint
CREATE INDEX `project_membership_client_project_status_idx` ON `project_membership` (`client_id`, `project_id`, `status`);
--> statement-breakpoint
CREATE INDEX `operation_log_actor_client_created_idx` ON `operation_log` (`actor_client_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `operation_log_permission_action_created_idx` ON `operation_log` (`permission_action`, `created_at`);
--> statement-breakpoint
CREATE INDEX `operation_log_result_created_idx` ON `operation_log` (`result`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_event_actor_client_idx` ON `project_event` (`actor_client_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `derived_output_owner_client_project_idx` ON `derived_output` (`owner_client_id`, `project_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_inbox_sender_client_project_idx` ON `project_inbox_item` (`sender_client_id`, `project_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_inbox_decided_client_idx` ON `project_inbox_item` (`decided_by_client_id`, `decided_at`);

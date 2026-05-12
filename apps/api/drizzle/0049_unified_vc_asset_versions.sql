CREATE TABLE `preset_version` (
  `id` text PRIMARY KEY NOT NULL,
  `preset_id` text NOT NULL,
  `parent_version_id` text,
  `version_no` integer NOT NULL,
  `data_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_by_operation_id` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`preset_id`) REFERENCES `preset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preset_version_preset_no_uq` ON `preset_version` (`preset_id`,`version_no`);
--> statement-breakpoint
CREATE INDEX `preset_version_preset_created_idx` ON `preset_version` (`preset_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `worldbook_version` (
  `id` text PRIMARY KEY NOT NULL,
  `worldbook_id` text NOT NULL,
  `parent_version_id` text,
  `version_no` integer NOT NULL,
  `data_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_by_operation_id` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`worldbook_id`) REFERENCES `worldbook`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worldbook_version_worldbook_no_uq` ON `worldbook_version` (`worldbook_id`,`version_no`);
--> statement-breakpoint
CREATE INDEX `worldbook_version_worldbook_created_idx` ON `worldbook_version` (`worldbook_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `regex_profile_version` (
  `id` text PRIMARY KEY NOT NULL,
  `regex_profile_id` text NOT NULL,
  `parent_version_id` text,
  `version_no` integer NOT NULL,
  `data_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_by_operation_id` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`regex_profile_id`) REFERENCES `regex_profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regex_profile_version_profile_no_uq` ON `regex_profile_version` (`regex_profile_id`,`version_no`);
--> statement-breakpoint
CREATE INDEX `regex_profile_version_profile_created_idx` ON `regex_profile_version` (`regex_profile_id`,`created_at`);
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `deep_binding` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `preset_version_id` text;
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `worldbook_version_id` text;
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `regex_profile_version_id` text;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD COLUMN `preset_version_id` text REFERENCES `preset_version`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD COLUMN `preset_content_hash` text;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD COLUMN `worldbook_version_id` text REFERENCES `worldbook_version`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD COLUMN `worldbook_content_hash` text;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD COLUMN `regex_profile_version_id` text REFERENCES `regex_profile_version`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD COLUMN `regex_profile_content_hash` text;

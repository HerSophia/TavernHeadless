PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_preset_version` (
  `id` text PRIMARY KEY NOT NULL,
  `preset_id` text NOT NULL,
  `parent_version_id` text,
  `version_no` integer NOT NULL,
  `data_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_by_operation_id` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`preset_id`) REFERENCES `preset`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`parent_version_id`) REFERENCES `__new_preset_version`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_preset_version` (
  `id`,
  `preset_id`,
  `parent_version_id`,
  `version_no`,
  `data_json`,
  `content_hash`,
  `created_by_operation_id`,
  `created_at`
)
SELECT
  `id`,
  `preset_id`,
  CASE
    WHEN `parent_version_id` IN (SELECT `id` FROM `preset_version`) THEN `parent_version_id`
    ELSE NULL
  END,
  `version_no`,
  `data_json`,
  `content_hash`,
  `created_by_operation_id`,
  `created_at`
FROM `preset_version`;
--> statement-breakpoint
DROP TABLE `preset_version`;
--> statement-breakpoint
ALTER TABLE `__new_preset_version` RENAME TO `preset_version`;
--> statement-breakpoint
CREATE UNIQUE INDEX `preset_version_preset_no_uq` ON `preset_version` (`preset_id`,`version_no`);
--> statement-breakpoint
CREATE INDEX `preset_version_preset_created_idx` ON `preset_version` (`preset_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `preset_version_content_hash_idx` ON `preset_version` (`content_hash`);
--> statement-breakpoint
CREATE TABLE `__new_worldbook_version` (
  `id` text PRIMARY KEY NOT NULL,
  `worldbook_id` text NOT NULL,
  `parent_version_id` text,
  `version_no` integer NOT NULL,
  `data_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_by_operation_id` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`worldbook_id`) REFERENCES `worldbook`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`parent_version_id`) REFERENCES `__new_worldbook_version`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_worldbook_version` (
  `id`,
  `worldbook_id`,
  `parent_version_id`,
  `version_no`,
  `data_json`,
  `content_hash`,
  `created_by_operation_id`,
  `created_at`
)
SELECT
  `id`,
  `worldbook_id`,
  CASE
    WHEN `parent_version_id` IN (SELECT `id` FROM `worldbook_version`) THEN `parent_version_id`
    ELSE NULL
  END,
  `version_no`,
  `data_json`,
  `content_hash`,
  `created_by_operation_id`,
  `created_at`
FROM `worldbook_version`;
--> statement-breakpoint
DROP TABLE `worldbook_version`;
--> statement-breakpoint
ALTER TABLE `__new_worldbook_version` RENAME TO `worldbook_version`;
--> statement-breakpoint
CREATE UNIQUE INDEX `worldbook_version_worldbook_no_uq` ON `worldbook_version` (`worldbook_id`,`version_no`);
--> statement-breakpoint
CREATE INDEX `worldbook_version_worldbook_created_idx` ON `worldbook_version` (`worldbook_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `worldbook_version_content_hash_idx` ON `worldbook_version` (`content_hash`);
--> statement-breakpoint
CREATE TABLE `__new_regex_profile_version` (
  `id` text PRIMARY KEY NOT NULL,
  `regex_profile_id` text NOT NULL,
  `parent_version_id` text,
  `version_no` integer NOT NULL,
  `data_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_by_operation_id` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`regex_profile_id`) REFERENCES `regex_profile`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`parent_version_id`) REFERENCES `__new_regex_profile_version`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_regex_profile_version` (
  `id`,
  `regex_profile_id`,
  `parent_version_id`,
  `version_no`,
  `data_json`,
  `content_hash`,
  `created_by_operation_id`,
  `created_at`
)
SELECT
  `id`,
  `regex_profile_id`,
  CASE
    WHEN `parent_version_id` IN (SELECT `id` FROM `regex_profile_version`) THEN `parent_version_id`
    ELSE NULL
  END,
  `version_no`,
  `data_json`,
  `content_hash`,
  `created_by_operation_id`,
  `created_at`
FROM `regex_profile_version`;
--> statement-breakpoint
DROP TABLE `regex_profile_version`;
--> statement-breakpoint
ALTER TABLE `__new_regex_profile_version` RENAME TO `regex_profile_version`;
--> statement-breakpoint
CREATE UNIQUE INDEX `regex_profile_version_profile_no_uq` ON `regex_profile_version` (`regex_profile_id`,`version_no`);
--> statement-breakpoint
CREATE INDEX `regex_profile_version_profile_created_idx` ON `regex_profile_version` (`regex_profile_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `regex_profile_version_content_hash_idx` ON `regex_profile_version` (`content_hash`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;

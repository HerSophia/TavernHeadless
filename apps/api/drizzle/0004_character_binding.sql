CREATE TABLE `character` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `source` text DEFAULT 'sillytavern' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `deleted_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK(`status` IN ('active', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE `character_version` (
  `id` text PRIMARY KEY NOT NULL,
  `character_id` text NOT NULL,
  `version_no` integer NOT NULL,
  `data_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_version_character_no_uq` ON `character_version` (`character_id`,`version_no`);
--> statement-breakpoint
CREATE INDEX `character_version_character_created_idx` ON `character_version` (`character_id`,`created_at`);
--> statement-breakpoint
ALTER TABLE `session` ADD `character_id` text REFERENCES `character`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `session` ADD `character_version_id` text REFERENCES `character_version`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `session` ADD `character_snapshot_json` text;
--> statement-breakpoint
ALTER TABLE `session` ADD `character_sync_policy` text DEFAULT 'pin' NOT NULL CHECK(`character_sync_policy` IN ('pin', 'manual', 'force'));

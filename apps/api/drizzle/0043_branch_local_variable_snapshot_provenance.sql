ALTER TABLE `branch_local_variable_snapshot` ADD COLUMN `snapshot_version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `branch_local_variable_snapshot` ADD COLUMN `provenance_json` text;

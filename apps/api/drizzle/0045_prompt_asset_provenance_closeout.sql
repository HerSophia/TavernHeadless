ALTER TABLE `character_version` ADD `source_artifact_json` text;
--> statement-breakpoint
ALTER TABLE `character_version` ADD `source_artifact_format` text;
--> statement-breakpoint
ALTER TABLE `character_version` ADD `source_artifact_digest` text;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD `character_id` text REFERENCES `character`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD `character_version_id` text REFERENCES `character_version`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD `character_imported_format` text;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD `character_content_hash` text;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD `worldbook_activated_entries_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD `asset_manifest_digest` text;

ALTER TABLE `session_branch` ADD COLUMN `asset_binding_deep_binding` integer;
--> statement-breakpoint
ALTER TABLE `session_branch` ADD COLUMN `asset_binding_preset_id` text REFERENCES `preset`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `session_branch` ADD COLUMN `asset_binding_preset_version_id` text REFERENCES `preset_version`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `session_branch` ADD COLUMN `asset_binding_worldbook_profile_id` text REFERENCES `worldbook`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `session_branch` ADD COLUMN `asset_binding_worldbook_version_id` text REFERENCES `worldbook_version`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `session_branch` ADD COLUMN `asset_binding_regex_profile_id` text REFERENCES `regex_profile`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `session_branch` ADD COLUMN `asset_binding_regex_profile_version_id` text REFERENCES `regex_profile_version`(`id`) ON DELETE set null;

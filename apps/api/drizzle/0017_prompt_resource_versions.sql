ALTER TABLE `preset` ADD COLUMN `version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `worldbook` ADD COLUMN `version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `regex_profile` ADD COLUMN `version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD COLUMN `preset_version` integer;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD COLUMN `worldbook_version` integer;
--> statement-breakpoint
ALTER TABLE `prompt_snapshot` ADD COLUMN `regex_profile_version` integer;

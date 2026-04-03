ALTER TABLE `worldbook_entry` ADD COLUMN `exclude_recursion` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `worldbook_entry` ADD COLUMN `prevent_recursion` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `worldbook_entry` ADD COLUMN `delay_until_recursion` integer;
--> statement-breakpoint
ALTER TABLE `worldbook_entry` ADD COLUMN `outlet_name` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `worldbook_entry` ADD COLUMN `extra_json` text NOT NULL DEFAULT '{}';

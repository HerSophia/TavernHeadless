ALTER TABLE `client` ADD COLUMN `capabilities_json` text;
--> statement-breakpoint
ALTER TABLE `client_api_key` ADD COLUMN `scopes_json` text;
--> statement-breakpoint
ALTER TABLE `client_api_key` ADD COLUMN `rotated_from_id` text;
--> statement-breakpoint
ALTER TABLE `client_api_key` ADD COLUMN `rotated_at` integer;

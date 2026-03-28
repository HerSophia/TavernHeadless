ALTER TABLE `tool_execution_record` ADD COLUMN `provider_type` text NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE `tool_execution_record` ADD COLUMN `lifecycle_state` text NOT NULL DEFAULT 'finished';
--> statement-breakpoint
ALTER TABLE `tool_execution_record` ADD COLUMN `commit_outcome` text NOT NULL DEFAULT 'committed';
--> statement-breakpoint
ALTER TABLE `tool_execution_record` ADD COLUMN `side_effect_level` text;
--> statement-breakpoint
ALTER TABLE `tool_execution_record` ADD COLUMN `started_at` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `tool_execution_record` ADD COLUMN `finished_at` integer;
--> statement-breakpoint
ALTER TABLE `tool_execution_record` ADD COLUMN `attempt_no` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `tool_execution_record` ADD COLUMN `replay_parent_execution_id` text;
--> statement-breakpoint
UPDATE `tool_execution_record`
SET
  `started_at` = CASE
    WHEN `started_at` = 0 THEN `created_at`
    ELSE `started_at`
  END,
  `finished_at` = COALESCE(`finished_at`, `created_at`),
  `commit_outcome` = COALESCE(`commit_outcome`, 'committed');
--> statement-breakpoint
DROP INDEX IF EXISTS `tool_execution_record_floor_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `tool_execution_record_run_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `tool_execution_record_page_created_idx`;
--> statement-breakpoint
CREATE INDEX `tool_execution_record_floor_created_idx` ON `tool_execution_record`(`floor_id`, `started_at`);
--> statement-breakpoint
CREATE INDEX `tool_execution_record_run_idx` ON `tool_execution_record`(`run_id`, `started_at`);
--> statement-breakpoint
CREATE INDEX `tool_execution_record_page_created_idx` ON `tool_execution_record`(`page_id`, `started_at`);

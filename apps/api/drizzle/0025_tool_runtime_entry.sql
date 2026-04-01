ALTER TABLE `tool_execution_record` ADD COLUMN `delivery_mode` text NOT NULL DEFAULT 'inline';
--> statement-breakpoint
ALTER TABLE `tool_execution_record` ADD COLUMN `runtime_job_id` text;
--> statement-breakpoint
CREATE INDEX `tool_execution_record_runtime_job_idx` ON `tool_execution_record`(`runtime_job_id`);

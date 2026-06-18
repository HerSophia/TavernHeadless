ALTER TABLE `node_graph_run` ADD COLUMN `cleaned_at` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `node_graph_run_status_cleaned_created_idx` ON `node_graph_run` (`status`,`cleaned_at`,`created_at`);

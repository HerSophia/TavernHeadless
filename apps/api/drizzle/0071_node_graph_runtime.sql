CREATE TABLE `node_graph_definition` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `name` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `current_version_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint

CREATE INDEX `node_graph_definition_project_status_updated_idx`
  ON `node_graph_definition` (`project_id`, `status`, `updated_at`);
--> statement-breakpoint

CREATE INDEX `node_graph_definition_workspace_updated_idx`
  ON `node_graph_definition` (`workspace_id`, `updated_at`);
--> statement-breakpoint

CREATE TABLE `node_graph_version` (
  `id` text PRIMARY KEY NOT NULL,
  `graph_id` text NOT NULL,
  `version_no` integer NOT NULL,
  `document_json` text NOT NULL,
  `document_hash` text NOT NULL,
  `parent_version_id` text,
  `operation_log_id` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`graph_id`) REFERENCES `node_graph_definition`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`parent_version_id`) REFERENCES `node_graph_version`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`operation_log_id`) REFERENCES `operation_log`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

CREATE UNIQUE INDEX `node_graph_version_graph_no_uq`
  ON `node_graph_version` (`graph_id`, `version_no`);
--> statement-breakpoint

CREATE INDEX `node_graph_version_graph_created_idx`
  ON `node_graph_version` (`graph_id`, `created_at`);
--> statement-breakpoint

CREATE TABLE `node_graph_run` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `workspace_id` text,
  `project_id` text,
  `session_id` text,
  `floor_id` text,
  `page_id` text,
  `graph_id` text NOT NULL,
  `graph_version_id` text NOT NULL,
  `intent` text NOT NULL,
  `status` text NOT NULL,
  `trace_json` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`floor_id`) REFERENCES `floor`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`page_id`) REFERENCES `message_page`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`graph_id`) REFERENCES `node_graph_definition`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`graph_version_id`) REFERENCES `node_graph_version`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint

CREATE INDEX `node_graph_run_project_status_created_idx`
  ON `node_graph_run` (`project_id`, `status`, `created_at`);
--> statement-breakpoint

CREATE INDEX `node_graph_run_graph_created_idx`
  ON `node_graph_run` (`graph_id`, `created_at`);
--> statement-breakpoint

CREATE TABLE `node_graph_node_run` (
  `id` text PRIMARY KEY NOT NULL,
  `graph_run_id` text NOT NULL,
  `node_id` text NOT NULL,
  `phase` text NOT NULL,
  `status` text NOT NULL,
  `input_hash` text,
  `output_hash` text,
  `preview_json` text,
  `diagnostics_json` text,
  `started_at` integer,
  `finished_at` integer,
  FOREIGN KEY (`graph_run_id`) REFERENCES `node_graph_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE INDEX `node_graph_node_run_graph_node_idx`
  ON `node_graph_node_run` (`graph_run_id`, `node_id`);

CREATE TABLE `node_graph_checkpoint` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `workspace_id` text,
  `project_id` text,
  `session_id` text,
  `floor_id` text NOT NULL,
  `graph_id` text NOT NULL,
  `graph_version_id` text NOT NULL,
  `node_id` text NOT NULL,
  `phase` text NOT NULL,
  `scope` text,
  `input_hash` text NOT NULL,
  `config_hash` text NOT NULL,
  `output_json` text,
  `cleaned_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`floor_id`) REFERENCES `floor`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`graph_id`) REFERENCES `node_graph_definition`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`graph_version_id`) REFERENCES `node_graph_version`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE UNIQUE INDEX `node_graph_checkpoint_floor_version_node_uq`
  ON `node_graph_checkpoint` (`floor_id`, `graph_version_id`, `node_id`);
--> statement-breakpoint

CREATE INDEX `node_graph_checkpoint_floor_version_idx`
  ON `node_graph_checkpoint` (`floor_id`, `graph_version_id`);
--> statement-breakpoint

CREATE INDEX `node_graph_checkpoint_cleaned_created_idx`
  ON `node_graph_checkpoint` (`cleaned_at`, `created_at`);

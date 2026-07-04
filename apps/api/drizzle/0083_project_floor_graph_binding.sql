CREATE TABLE `project_floor_graph_binding` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `kind` text NOT NULL,
  `graph_id` text NOT NULL,
  `graph_version_id` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`graph_id`) REFERENCES `node_graph_definition`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`graph_version_id`) REFERENCES `node_graph_version`(`id`) ON UPDATE no action ON DELETE restrict,
  CHECK(`kind` IN ('native', 'compat')),
  CHECK(`status` IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_floor_graph_binding_active_kind_uq` ON `project_floor_graph_binding` (`account_id`, `project_id`, `kind`) WHERE `status` = 'active';
--> statement-breakpoint
CREATE INDEX `project_floor_graph_binding_project_kind_status_idx` ON `project_floor_graph_binding` (`project_id`, `kind`, `status`);
--> statement-breakpoint
CREATE INDEX `project_floor_graph_binding_graph_idx` ON `project_floor_graph_binding` (`graph_id`, `graph_version_id`);

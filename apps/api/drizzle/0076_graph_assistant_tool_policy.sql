CREATE TABLE `graph_assistant_tool_policy` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `account_id` text NOT NULL,
  `tool_name` text NOT NULL,
  `decision` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint

CREATE UNIQUE INDEX `graph_assistant_tool_policy_project_tool_uq`
  ON `graph_assistant_tool_policy` (`project_id`, `tool_name`);
--> statement-breakpoint

CREATE INDEX `graph_assistant_tool_policy_workspace_idx`
  ON `graph_assistant_tool_policy` (`workspace_id`, `created_at`);

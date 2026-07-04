CREATE TABLE `graph_assistant_prompt_config` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `account_id` text NOT NULL,
  `static_mode` text DEFAULT 'append' NOT NULL,
  `static_text` text DEFAULT '' NOT NULL,
  `dynamic_template` text DEFAULT '' NOT NULL,
  `context_config` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint

CREATE UNIQUE INDEX `graph_assistant_prompt_config_project_uq`
  ON `graph_assistant_prompt_config` (`project_id`);
--> statement-breakpoint

CREATE INDEX `graph_assistant_prompt_config_workspace_idx`
  ON `graph_assistant_prompt_config` (`workspace_id`, `created_at`);

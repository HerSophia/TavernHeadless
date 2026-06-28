CREATE TABLE `graph_assistant_pending_tool_call` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `account_id` text NOT NULL,
  `conversation_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `floor_id` text NOT NULL,
  `call_id` text NOT NULL,
  `tool_name` text NOT NULL,
  `args_json` text NOT NULL,
  `side_effect_level` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `conversation_messages_json` text NOT NULL,
  `agent_steps` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `expires_at` integer,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`conversation_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE INDEX `graph_assistant_pending_tool_call_conversation_status_idx`
  ON `graph_assistant_pending_tool_call` (`conversation_id`, `status`);
--> statement-breakpoint

CREATE INDEX `graph_assistant_pending_tool_call_floor_idx`
  ON `graph_assistant_pending_tool_call` (`floor_id`);

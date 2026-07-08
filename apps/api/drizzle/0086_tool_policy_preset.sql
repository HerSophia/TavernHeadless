-- SC2-10 (批次四): 工具策略预设表。
-- 内置预设默认值在代码中定义；本表仅持久化「内置预设的用户覆盖」与「自定义预设」。
-- 项目级作用域（决策 A），(project_id, preset_key) 唯一。
CREATE TABLE `tool_policy_preset` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `account_id` text NOT NULL,
  `preset_key` text NOT NULL,
  `kind` text NOT NULL DEFAULT 'custom',
  `display_name` text NOT NULL DEFAULT '',
  `config_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint

CREATE UNIQUE INDEX `tool_policy_preset_project_key_uq`
  ON `tool_policy_preset` (`project_id`, `preset_key`);
--> statement-breakpoint

CREATE INDEX `tool_policy_preset_workspace_idx`
  ON `tool_policy_preset` (`workspace_id`, `created_at`);

-- SC2-12 (批次四): 会话级待办事项清单表。
-- 每个会话最多一行（session_id 唯一）。TODO 由待办事项工具读写，直接持久化，
-- 不进入变量 page/floor 沙盒生命周期；随会话删除级联清理。
CREATE TABLE `session_todo_list` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `account_id` text NOT NULL,
  `items_json` text NOT NULL DEFAULT '[]',
  `revision` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint

CREATE UNIQUE INDEX `session_todo_list_session_uq`
  ON `session_todo_list` (`session_id`);
--> statement-breakpoint

CREATE INDEX `session_todo_list_account_updated_idx`
  ON `session_todo_list` (`account_id`, `updated_at`);

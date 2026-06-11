CREATE TABLE `prompt_runtime_injection` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `branch_id` text,
  `source_kind` text NOT NULL DEFAULT 'client_injection',
  `title` text NOT NULL,
  `content` text NOT NULL,
  `placement` text NOT NULL,
  `order` integer NOT NULL DEFAULT 100,
  `enabled` integer NOT NULL DEFAULT 1,
  `mode_scope` text,
  `ttl_ms` integer,
  `created_by` text REFERENCES `account`(`id`) ON DELETE set null,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

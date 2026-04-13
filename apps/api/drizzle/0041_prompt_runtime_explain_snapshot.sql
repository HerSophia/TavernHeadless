CREATE TABLE `prompt_runtime_explain_snapshot` (
  `id` text PRIMARY KEY NOT NULL,
  `floor_id` text NOT NULL REFERENCES `floor`(`id`) ON DELETE cascade,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `target_branch_id` text,
  `source_floor_id` text REFERENCES `floor`(`id`) ON DELETE set null,
  `history_source_branch_id` text,
  `history_source_mode` text NOT NULL DEFAULT 'existing_branch',
  `snapshot_version` integer NOT NULL DEFAULT 1,
  `assets_json` text NOT NULL DEFAULT '{}',
  `resolved_policy_json` text NOT NULL DEFAULT '{}',
  `source_map_json` text NOT NULL DEFAULT '{}',
  `diagnostics_json` text NOT NULL DEFAULT '[]',
  `trim_reasons_json` text NOT NULL DEFAULT '[]',
  `excluded_sources_json` text NOT NULL DEFAULT '[]',
  `section_stats_json` text NOT NULL DEFAULT '[]',
  `created_at` integer NOT NULL,
  CHECK(`history_source_mode` IN ('existing_branch', 'source_floor_branch', 'main_fallback'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_runtime_explain_snapshot_floor_id_uq`
  ON `prompt_runtime_explain_snapshot` (`floor_id`);
--> statement-breakpoint
CREATE INDEX `prompt_runtime_explain_snapshot_session_created_idx`
  ON `prompt_runtime_explain_snapshot` (`session_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `prompt_runtime_explain_snapshot_session_branch_created_idx`
  ON `prompt_runtime_explain_snapshot` (`session_id`, `target_branch_id`, `created_at`);

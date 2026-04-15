CREATE TABLE `client_data_managed_domain` (
  `domain_id` text PRIMARY KEY NOT NULL REFERENCES `client_data_domain`(`id`) ON DELETE cascade,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `manager_kind` text NOT NULL,
  `host_type` text NOT NULL,
  `host_id` text NOT NULL,
  `state_namespace` text NOT NULL,
  `require_caller_owner` integer NOT NULL DEFAULT 1,
  `allow_auto_create_collection` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK(`manager_kind` IN ('session_state')),
  CHECK(`host_type` IN ('session'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_data_managed_domain_account_manager_host_namespace_uq`
  ON `client_data_managed_domain` (`account_id`, `manager_kind`, `host_type`, `host_id`, `state_namespace`);
--> statement-breakpoint
CREATE INDEX `client_data_managed_domain_account_host_idx`
  ON `client_data_managed_domain` (`account_id`, `host_type`, `host_id`, `state_namespace`);
--> statement-breakpoint
CREATE TABLE `session_state_mutation` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `domain_id` text NOT NULL REFERENCES `client_data_domain`(`id`) ON DELETE cascade,
  `state_namespace` text NOT NULL,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `branch_id` text NOT NULL,
  `source_floor_id` text REFERENCES `floor`(`id`) ON DELETE set null,
  `target_slot` text NOT NULL,
  `visibility_mode` text NOT NULL,
  `write_mode` text NOT NULL,
  `replay_safety` text NOT NULL,
  `status` text NOT NULL DEFAULT 'staged',
  `request_id` text,
  `run_id` text,
  `payload_json` text NOT NULL DEFAULT '{}',
  `source_snapshot_floor_id` text REFERENCES `floor`(`id`) ON DELETE set null,
  `live_head_key` text,
  `discard_reason` text,
  `blocked_reason` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `applied_at` integer,
  CHECK(`visibility_mode` IN ('session_shared', 'branch_local', 'fork_on_branch')),
  CHECK(`write_mode` IN ('direct', 'commit_bound')),
  CHECK(`replay_safety` IN ('safe', 'confirm_on_replay', 'never_auto_replay', 'uncertain')),
  CHECK(`status` IN ('staged', 'applied', 'discarded', 'blocked', 'uncertain'))
);
--> statement-breakpoint
CREATE INDEX `session_state_mutation_session_branch_status_created_idx`
  ON `session_state_mutation` (`session_id`, `branch_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `session_state_mutation_source_floor_idx`
  ON `session_state_mutation` (`source_floor_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `session_state_mutation_run_idx`
  ON `session_state_mutation` (`run_id`, `created_at`);

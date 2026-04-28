CREATE TABLE `session_state_namespace_registration` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `domain_id` text NOT NULL REFERENCES `client_data_domain`(`id`) ON DELETE cascade,
  `namespace` text NOT NULL,
  `logical_owner_type` text NOT NULL,
  `logical_owner_id` text NOT NULL,
  `default_visibility_mode` text NOT NULL,
  `default_write_mode` text NOT NULL,
  `default_replay_safety` text NOT NULL,
  `client_writable` integer NOT NULL DEFAULT 1,
  `allowed_write_modes_json` text NOT NULL DEFAULT '[]',
  `supports_snapshot` integer NOT NULL DEFAULT 1,
  `supports_diff` integer NOT NULL DEFAULT 1,
  `replay_policy_source` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK(`default_visibility_mode` IN ('session_shared', 'branch_local', 'fork_on_branch')),
  CHECK(`default_write_mode` IN ('direct', 'commit_bound')),
  CHECK(`default_replay_safety` IN ('safe', 'confirm_on_replay', 'never_auto_replay', 'uncertain'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_state_namespace_registration_account_session_namespace_uq`
  ON `session_state_namespace_registration` (`account_id`, `session_id`, `namespace`);
--> statement-breakpoint
CREATE INDEX `session_state_namespace_registration_account_session_created_idx`
  ON `session_state_namespace_registration` (`account_id`, `session_id`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_state_namespace_registration_domain_id_uq`
  ON `session_state_namespace_registration` (`domain_id`);

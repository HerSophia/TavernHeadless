CREATE TABLE `__new_session` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text,
  `character_id` text REFERENCES `character`(`id`) ON DELETE set null,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict,
  `project_id` text REFERENCES `project`(`id`) ON DELETE restrict,
  `character_version_id` text REFERENCES `character_version`(`id`) ON DELETE set null,
  `character_snapshot_json` text,
  `character_sync_policy` text NOT NULL DEFAULT 'pin' CHECK(`character_sync_policy` IN ('pin', 'manual', 'force')),
  `user_id` text REFERENCES `account_user`(`id`) ON DELETE set null,
  `user_snapshot_json` text,
  `status` text NOT NULL DEFAULT 'active' CHECK(`status` IN ('active', 'archived', 'finalized', 'discarded', 'expired', 'cancelled')),
  `kind` text NOT NULL DEFAULT 'default' CHECK(`kind` IN ('default', 'temporary')),
  `purpose` text,
  `temporary_source_session_id` text,
  `temporary_snapshot_digest` text,
  `retention_policy` text CHECK(`retention_policy` IN ('delete_on_finalize', 'ttl', 'keep_for_debug')),
  `visibility` text CHECK(`visibility` IN ('internal', 'client_visible')),
  `expires_at` integer,
  `finalized_at` integer,
  `discarded_at` integer,
  `cancelled_at` integer,
  `last_activity_at` integer NOT NULL DEFAULT 0,
  `preset_id` text,
  `regex_profile_id` text,
  `worldbook_profile_id` text,
  `deep_binding` integer NOT NULL DEFAULT false,
  `preset_version_id` text,
  `worldbook_version_id` text,
  `regex_profile_version_id` text,
  `model_provider` text,
  `model_name` text,
  `model_params_json` text,
  `prompt_mode` text CHECK(`prompt_mode` IN ('compat_strict', 'compat_plus', 'native')),
  `metadata_json` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_session` (
  `id`,
  `title`,
  `character_id`,
  `account_id`,
  `workspace_id`,
  `project_id`,
  `character_version_id`,
  `character_snapshot_json`,
  `character_sync_policy`,
  `user_id`,
  `user_snapshot_json`,
  `status`,
  `kind`,
  `purpose`,
  `temporary_source_session_id`,
  `temporary_snapshot_digest`,
  `retention_policy`,
  `visibility`,
  `expires_at`,
  `finalized_at`,
  `discarded_at`,
  `cancelled_at`,
  `last_activity_at`,
  `preset_id`,
  `regex_profile_id`,
  `worldbook_profile_id`,
  `deep_binding`,
  `preset_version_id`,
  `worldbook_version_id`,
  `regex_profile_version_id`,
  `model_provider`,
  `model_name`,
  `model_params_json`,
  `prompt_mode`,
  `metadata_json`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `title`,
  `character_id`,
  `account_id`,
  `workspace_id`,
  `project_id`,
  `character_version_id`,
  `character_snapshot_json`,
  `character_sync_policy`,
  `user_id`,
  `user_snapshot_json`,
  CASE WHEN `status` IN ('active', 'archived', 'finalized', 'discarded', 'expired', 'cancelled') THEN `status` ELSE 'active' END,
  COALESCE(`kind`, 'default'),
  `purpose`,
  `temporary_source_session_id`,
  `temporary_snapshot_digest`,
  `retention_policy`,
  `visibility`,
  NULL,
  NULL,
  NULL,
  NULL,
  `updated_at`,
  `preset_id`,
  `regex_profile_id`,
  `worldbook_profile_id`,
  `deep_binding`,
  `preset_version_id`,
  `worldbook_version_id`,
  `regex_profile_version_id`,
  `model_provider`,
  `model_name`,
  `model_params_json`,
  `prompt_mode`,
  `metadata_json`,
  `created_at`,
  `updated_at`
FROM `session`;
--> statement-breakpoint
DROP TABLE `session`;
--> statement-breakpoint
ALTER TABLE `__new_session` RENAME TO `session`;
--> statement-breakpoint
CREATE INDEX `session_account_workspace_updated_idx` ON `session` (`account_id`, `workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `session_account_project_updated_idx` ON `session` (`account_id`, `project_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `session_project_updated_idx` ON `session` (`project_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `session_account_kind_updated_idx` ON `session` (`account_id`, `kind`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `session_temporary_source_session_idx` ON `session` (`temporary_source_session_id`);
--> statement-breakpoint
CREATE TABLE `page_staged_write` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `branch_id` text NOT NULL,
  `floor_id` text NOT NULL REFERENCES `floor`(`id`) ON DELETE cascade,
  `page_id` text NOT NULL REFERENCES `message_page`(`id`) ON DELETE cascade,
  `source_kind` text NOT NULL DEFAULT 'temporary_conversation',
  `source_session_id` text REFERENCES `session`(`id`) ON DELETE set null,
  `source_page_id` text REFERENCES `message_page`(`id`) ON DELETE set null,
  `actor_client_id` text REFERENCES `client`(`id`) ON DELETE set null,
  `content` text NOT NULL,
  `content_format` text NOT NULL DEFAULT 'text',
  `reason` text NOT NULL,
  `status` text NOT NULL DEFAULT 'staged',
  `metadata_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `applied_at` integer,
  `discarded_at` integer
);
--> statement-breakpoint
CREATE INDEX `page_staged_write_page_status_created_idx` ON `page_staged_write` (`page_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `page_staged_write_floor_created_idx` ON `page_staged_write` (`floor_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `page_staged_write_source_session_created_idx` ON `page_staged_write` (`source_session_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `page_staged_write_account_session_branch_created_idx` ON `page_staged_write` (`account_id`, `session_id`, `branch_id`, `created_at`);

ALTER TABLE `memory_item` ADD COLUMN `summary_tier` text CHECK(`summary_tier` IN ('micro', 'macro'));
--> statement-breakpoint
ALTER TABLE `memory_item` ADD COLUMN `lifecycle_status` text NOT NULL DEFAULT 'active' CHECK(`lifecycle_status` IN ('active', 'compacted', 'deprecated'));
--> statement-breakpoint
ALTER TABLE `memory_item` ADD COLUMN `source_job_id` text;
--> statement-breakpoint
ALTER TABLE `memory_item` ADD COLUMN `token_count_estimate` integer;
--> statement-breakpoint
ALTER TABLE `memory_item` ADD COLUMN `last_used_at` integer;
--> statement-breakpoint
ALTER TABLE `memory_item` ADD COLUMN `coverage_start_floor_no` integer;
--> statement-breakpoint
ALTER TABLE `memory_item` ADD COLUMN `coverage_end_floor_no` integer;
--> statement-breakpoint
ALTER TABLE `memory_item` ADD COLUMN `derived_from_count` integer;
--> statement-breakpoint
UPDATE `memory_item`
SET `lifecycle_status` = CASE
  WHEN `status` = 'deprecated' THEN 'deprecated'
  ELSE 'active'
END;
--> statement-breakpoint
CREATE INDEX `memory_item_account_scope_lifecycle_type_updated_idx`
  ON `memory_item` (`account_id`, `scope`, `scope_id`, `lifecycle_status`, `type`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `memory_item_account_scope_summary_tier_lifecycle_idx`
  ON `memory_item` (`account_id`, `scope`, `scope_id`, `summary_tier`, `lifecycle_status`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `__new_memory_edge` (
  `id` text PRIMARY KEY NOT NULL,
  `from_id` text NOT NULL REFERENCES `memory_item`(`id`) ON DELETE cascade,
  `to_id` text NOT NULL REFERENCES `memory_item`(`id`) ON DELETE cascade,
  `relation` text NOT NULL,
  `account_id` text NOT NULL DEFAULT 'default-admin',
  `created_at` integer NOT NULL,
  CHECK(`relation` IN ('supports', 'contradicts', 'updates', 'derived_from', 'compacts', 'resolves'))
);
--> statement-breakpoint
INSERT INTO `__new_memory_edge` (`id`, `from_id`, `to_id`, `relation`, `account_id`, `created_at`)
SELECT `id`, `from_id`, `to_id`, `relation`, `account_id`, `created_at`
FROM `memory_edge`;
--> statement-breakpoint
DROP TABLE `memory_edge`;
--> statement-breakpoint
ALTER TABLE `__new_memory_edge` RENAME TO `memory_edge`;
--> statement-breakpoint
CREATE INDEX `memory_edge_account_idx` ON `memory_edge` (`account_id`);
--> statement-breakpoint
CREATE TABLE `memory_scope_state` (
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `scope` text NOT NULL,
  `scope_id` text NOT NULL,
  `revision` integer NOT NULL DEFAULT 0,
  `lease_owner` text,
  `lease_until` integer,
  `last_processed_floor_no` integer,
  `last_compaction_at` integer,
  `updated_at` integer NOT NULL,
  CHECK(`scope` IN ('global', 'chat', 'floor'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_scope_state_account_scope_scope_id_uq`
  ON `memory_scope_state` (`account_id`, `scope`, `scope_id`);
--> statement-breakpoint
CREATE INDEX `memory_scope_state_lease_idx` ON `memory_scope_state` (`lease_until`);
--> statement-breakpoint
CREATE TABLE `memory_job` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `scope` text NOT NULL,
  `scope_id` text NOT NULL,
  `job_type` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `floor_id` text REFERENCES `floor`(`id`) ON DELETE set null,
  `based_on_revision` integer,
  `payload_json` text NOT NULL DEFAULT '{}',
  `attempt_count` integer NOT NULL DEFAULT 0,
  `max_attempts` integer NOT NULL DEFAULT 5,
  `available_at` integer NOT NULL,
  `lease_owner` text,
  `lease_until` integer,
  `last_error` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `finished_at` integer,
  CHECK(`scope` IN ('global', 'chat', 'floor')),
  CHECK(`job_type` IN ('ingest_turn', 'compact_macro', 'maintenance', 'rebuild_scope')),
  CHECK(`status` IN ('pending', 'leased', 'running', 'retry_waiting', 'succeeded', 'dead_letter', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `memory_job_status_available_idx` ON `memory_job` (`status`, `available_at`);
--> statement-breakpoint
CREATE INDEX `memory_job_account_scope_status_available_idx`
  ON `memory_job` (`account_id`, `scope`, `scope_id`, `status`, `available_at`);
--> statement-breakpoint
CREATE INDEX `memory_job_account_scope_created_idx`
  ON `memory_job` (`account_id`, `scope`, `scope_id`, `created_at`);

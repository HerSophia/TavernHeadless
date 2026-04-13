CREATE TABLE `__new_memory_item` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `scope_id` text NOT NULL,
  `type` text NOT NULL,
  `summary_tier` text,
  `content_json` text NOT NULL,
  `fact_key` text,
  `importance` real NOT NULL DEFAULT 0.5,
  `confidence` real NOT NULL DEFAULT 1,
  `source_floor_id` text,
  `source_message_id` text,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `status` text NOT NULL DEFAULT 'active',
  `lifecycle_status` text NOT NULL DEFAULT 'active',
  `source_job_id` text,
  `token_count_estimate` integer,
  `last_used_at` integer,
  `coverage_start_floor_no` integer,
  `coverage_end_floor_no` integer,
  `derived_from_count` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK(`scope` IN ('global', 'chat', 'branch', 'floor')),
  CHECK(`type` IN ('fact', 'summary', 'open_loop')),
  CHECK(`summary_tier` IN ('micro', 'macro') OR `summary_tier` IS NULL),
  CHECK(`status` IN ('active', 'deprecated')),
  CHECK(`lifecycle_status` IN ('active', 'compacted', 'deprecated'))
);
--> statement-breakpoint
INSERT INTO `__new_memory_item` (
  `id`,
  `scope`,
  `scope_id`,
  `type`,
  `summary_tier`,
  `content_json`,
  `fact_key`,
  `importance`,
  `confidence`,
  `source_floor_id`,
  `source_message_id`,
  `account_id`,
  `status`,
  `lifecycle_status`,
  `source_job_id`,
  `token_count_estimate`,
  `last_used_at`,
  `coverage_start_floor_no`,
  `coverage_end_floor_no`,
  `derived_from_count`,
  `created_at`,
  `updated_at`
)
SELECT
  `mi`.`id`,
  CASE
    WHEN `mi`.`scope` = 'chat' THEN 'branch'
    ELSE `mi`.`scope`
  END,
  CASE
    WHEN `mi`.`scope` = 'chat' THEN COALESCE(
      (
        SELECT json_array(`f`.`session_id`, `f`.`branch_id`)
        FROM `floor` AS `f`
        WHERE `f`.`id` = `mi`.`source_floor_id`
        LIMIT 1
      ),
      json_array(`mi`.`scope_id`, 'main')
    )
    ELSE `mi`.`scope_id`
  END,
  `mi`.`type`,
  `mi`.`summary_tier`,
  `mi`.`content_json`,
  `mi`.`fact_key`,
  `mi`.`importance`,
  `mi`.`confidence`,
  `mi`.`source_floor_id`,
  `mi`.`source_message_id`,
  `mi`.`account_id`,
  `mi`.`status`,
  `mi`.`lifecycle_status`,
  `mi`.`source_job_id`,
  `mi`.`token_count_estimate`,
  `mi`.`last_used_at`,
  `mi`.`coverage_start_floor_no`,
  `mi`.`coverage_end_floor_no`,
  `mi`.`derived_from_count`,
  `mi`.`created_at`,
  `mi`.`updated_at`
FROM `memory_item` AS `mi`;
--> statement-breakpoint
DROP TABLE `memory_item`;
--> statement-breakpoint
ALTER TABLE `__new_memory_item` RENAME TO `memory_item`;
--> statement-breakpoint
CREATE INDEX `memory_item_account_scope_idx` ON `memory_item` (`account_id`, `scope`, `scope_id`);
--> statement-breakpoint
CREATE INDEX `memory_item_fact_lookup_idx` ON `memory_item` (`account_id`, `scope`, `scope_id`, `type`, `status`, `fact_key`);
--> statement-breakpoint
CREATE INDEX `memory_item_account_scope_lifecycle_type_updated_idx`
  ON `memory_item` (`account_id`, `scope`, `scope_id`, `lifecycle_status`, `type`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `memory_item_account_scope_summary_tier_lifecycle_idx`
  ON `memory_item` (`account_id`, `scope`, `scope_id`, `summary_tier`, `lifecycle_status`, `updated_at`);
--> statement-breakpoint
DELETE FROM `runtime_scope_state`
WHERE `scope_type` = 'memory';
--> statement-breakpoint
DELETE FROM `runtime_job`
WHERE `scope_type` = 'memory'
  AND `job_type` IN ('memory.compact_macro', 'memory.maintenance', 'memory.rebuild_scope');
--> statement-breakpoint
UPDATE `runtime_job`
SET
  `session_id` = COALESCE(
    `session_id`,
    (
      SELECT `f`.`session_id`
      FROM `floor` AS `f`
      WHERE `f`.`id` = `runtime_job`.`floor_id`
      LIMIT 1
    )
  ),
  `scope_key` = 'branch:' || COALESCE(
    (
      SELECT json_array(`f`.`session_id`, `f`.`branch_id`)
      FROM `floor` AS `f`
      WHERE `f`.`id` = `runtime_job`.`floor_id`
      LIMIT 1
    ),
    CASE
      WHEN `runtime_job`.`session_id` IS NOT NULL THEN json_array(`runtime_job`.`session_id`, 'main')
      WHEN `runtime_job`.`scope_key` LIKE 'chat:%' THEN json_array(substr(`runtime_job`.`scope_key`, 6), 'main')
      ELSE json_array(`runtime_job`.`scope_key`, 'main')
    END
  )
WHERE `scope_type` = 'memory'
  AND `job_type` = 'memory.ingest_turn';

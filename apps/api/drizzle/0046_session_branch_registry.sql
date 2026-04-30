CREATE TABLE `session_branch` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `account`(`id`) ON DELETE restrict,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `branch_id` text NOT NULL,
  `source_floor_id` text REFERENCES `floor`(`id`) ON DELETE set null,
  `source_branch_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_branch_account_session_branch_uq` ON `session_branch` (`account_id`,`session_id`,`branch_id`);
--> statement-breakpoint
CREATE INDEX `session_branch_account_session_created_idx` ON `session_branch` (`account_id`,`session_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `session_branch_account_session_branch_created_idx` ON `session_branch` (`account_id`,`session_id`,`branch_id`,`created_at`);
--> statement-breakpoint
INSERT INTO `session_branch` (`id`, `account_id`, `session_id`, `branch_id`, `source_floor_id`, `source_branch_id`, `created_at`, `updated_at`)
SELECT
  lower(hex(randomblob(16))),
  `s`.`account_id`,
  `f`.`session_id`,
  `f`.`branch_id`,
  NULL,
  NULL,
  min(`f`.`created_at`),
  max(`f`.`updated_at`)
FROM `floor` AS `f`
INNER JOIN `session` AS `s` ON `s`.`id` = `f`.`session_id`
GROUP BY `s`.`account_id`, `f`.`session_id`, `f`.`branch_id`;
--> statement-breakpoint
INSERT INTO `session_branch` (`id`, `account_id`, `session_id`, `branch_id`, `source_floor_id`, `source_branch_id`, `created_at`, `updated_at`)
SELECT
  lower(hex(randomblob(16))),
  `s`.`account_id`,
  `s`.`id`,
  'main',
  NULL,
  NULL,
  `s`.`created_at`,
  `s`.`updated_at`
FROM `session` AS `s`
WHERE NOT EXISTS (
  SELECT 1
  FROM `session_branch` AS `sb`
  WHERE `sb`.`account_id` = `s`.`account_id`
    AND `sb`.`session_id` = `s`.`id`
    AND `sb`.`branch_id` = 'main'
);

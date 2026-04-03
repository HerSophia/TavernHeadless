ALTER TABLE `floor` ADD COLUMN `superseded_at` integer;
--> statement-breakpoint
ALTER TABLE `floor` ADD COLUMN `superseded_by_floor_id` text;
--> statement-breakpoint
DROP INDEX IF EXISTS `floor_session_no_branch_uq`;
--> statement-breakpoint
UPDATE `floor`
SET
  `superseded_at` = COALESCE(
    (
      SELECT `replacement`.`created_at`
      FROM `floor` AS `replacement`
      WHERE `replacement`.`parent_floor_id` = `floor`.`id`
      ORDER BY `replacement`.`created_at` DESC, `replacement`.`id` DESC
      LIMIT 1
    ),
    `updated_at`
  ),
  `superseded_by_floor_id` = (
    SELECT `replacement`.`id`
    FROM `floor` AS `replacement`
    WHERE `replacement`.`parent_floor_id` = `floor`.`id`
    ORDER BY `replacement`.`created_at` DESC, `replacement`.`id` DESC
    LIMIT 1
  ),
  `branch_id` = 'main'
WHERE `branch_id` LIKE 'superseded-%';
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_session_no_branch_live_uq`
ON `floor` (`session_id`, `floor_no`, `branch_id`)
WHERE `superseded_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `floor_session_branch_live_state_no_idx`
ON `floor` (`session_id`, `branch_id`, `state`, `floor_no`)
WHERE `superseded_at` IS NULL;

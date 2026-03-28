ALTER TABLE `variable` ADD COLUMN `account_id` text NOT NULL DEFAULT 'default-admin' REFERENCES `account`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
UPDATE `variable`
SET `account_id` = COALESCE(
  CASE
    WHEN `scope` = 'chat' THEN (
      SELECT `session`.`account_id`
      FROM `session`
      WHERE `session`.`id` = `variable`.`scope_id`
    )
    WHEN `scope` = 'floor' THEN (
      SELECT `session`.`account_id`
      FROM `floor`
      INNER JOIN `session` ON `session`.`id` = `floor`.`session_id`
      WHERE `floor`.`id` = `variable`.`scope_id`
    )
    WHEN `scope` = 'page' THEN (
      SELECT `session`.`account_id`
      FROM `message_page`
      INNER JOIN `floor` ON `floor`.`id` = `message_page`.`floor_id`
      INNER JOIN `session` ON `session`.`id` = `floor`.`session_id`
      WHERE `message_page`.`id` = `variable`.`scope_id`
    )
    ELSE `account_id`
  END,
  'default-admin'
);
--> statement-breakpoint
DROP INDEX IF EXISTS `variable_scope_scope_id_key_uq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `variable_account_scope_scope_id_key_uq` ON `variable` (`account_id`, `scope`, `scope_id`, `key`);
--> statement-breakpoint
CREATE INDEX `variable_account_scope_scope_id_updated_idx` ON `variable` (`account_id`, `scope`, `scope_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `variable_account_scope_updated_idx` ON `variable` (`account_id`, `scope`, `updated_at`);

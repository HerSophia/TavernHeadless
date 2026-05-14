UPDATE `operation_log`
SET `actor_account_id` = `actor_id`
WHERE `actor_type` = 'account'
  AND `actor_id` IS NOT NULL
  AND trim(`actor_id`) <> ''
  AND (`actor_account_id` IS NULL OR `actor_account_id` <> `actor_id`)
  AND EXISTS (
    SELECT 1
    FROM `account`
    WHERE `account`.`id` = `operation_log`.`actor_id`
  );
--> statement-breakpoint

UPDATE `operation_log`
SET `actor_account_id` = `account_id`
WHERE (`actor_account_id` IS NULL OR trim(`actor_account_id`) = '')
  AND `account_id` IS NOT NULL
  AND trim(`account_id`) <> '';

ALTER TABLE `character` ADD `revision` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `character` ADD `latest_version_no` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `character`
SET `latest_version_no` = COALESCE((
  SELECT MAX(`version_no`)
  FROM `character_version`
  WHERE `character_version`.`character_id` = `character`.`id`
), 0);
--> statement-breakpoint
ALTER TABLE `account_user` ADD `revision` integer NOT NULL DEFAULT 0;

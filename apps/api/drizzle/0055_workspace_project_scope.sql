CREATE TABLE `workspace` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `name` text NOT NULL,
  `kind` text NOT NULL DEFAULT 'default',
  `is_default` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'active',
  `settings_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `workspace_account_updated_idx` ON `workspace` (`account_id`, `updated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_account_default_uq` ON `workspace` (`account_id`) WHERE `is_default` = 1;
--> statement-breakpoint
CREATE TABLE `project` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `workspace_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `kind` text NOT NULL DEFAULT 'session_default',
  `status` text NOT NULL DEFAULT 'active',
  `settings_override_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE restrict,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `project_account_workspace_updated_idx` ON `project` (`account_id`, `workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `project_workspace_updated_idx` ON `project` (`workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `project_account_status_updated_idx` ON `project` (`account_id`, `status`, `updated_at`);
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `project_id` text REFERENCES `project`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `character` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `account_user` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `preset` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `worldbook` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `regex_profile` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `llm_profile` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `llm_profile_binding` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `llm_instance_config` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `tool_definition` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `mcp_server_config` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE restrict;
--> statement-breakpoint
INSERT INTO `workspace` (
  `id`,
  `account_id`,
  `name`,
  `kind`,
  `is_default`,
  `status`,
  `settings_json`,
  `created_at`,
  `updated_at`
)
SELECT
  'ws_default_' || `account`.`id`,
  `account`.`id`,
  '默认 Workspace',
  'default',
  1,
  'active',
  '{}',
  `account`.`created_at`,
  `account`.`updated_at`
FROM `account`
WHERE NOT EXISTS (
  SELECT 1
  FROM `workspace`
  WHERE `workspace`.`account_id` = `account`.`id`
    AND `workspace`.`is_default` = 1
);
--> statement-breakpoint
UPDATE `character`
SET `workspace_id` = (
  SELECT `workspace`.`id`
  FROM `workspace`
  WHERE `workspace`.`account_id` = `character`.`account_id`
    AND `workspace`.`is_default` = 1
)
WHERE `workspace_id` IS NULL;
--> statement-breakpoint
UPDATE `account_user`
SET `workspace_id` = (
  SELECT `workspace`.`id`
  FROM `workspace`
  WHERE `workspace`.`account_id` = `account_user`.`account_id`
    AND `workspace`.`is_default` = 1
)
WHERE `workspace_id` IS NULL;
--> statement-breakpoint
UPDATE `preset`
SET `workspace_id` = (
  SELECT `workspace`.`id`
  FROM `workspace`
  WHERE `workspace`.`account_id` = `preset`.`account_id`
    AND `workspace`.`is_default` = 1
)
WHERE `workspace_id` IS NULL;
--> statement-breakpoint
UPDATE `worldbook`
SET `workspace_id` = (
  SELECT `workspace`.`id`
  FROM `workspace`
  WHERE `workspace`.`account_id` = `worldbook`.`account_id`
    AND `workspace`.`is_default` = 1
)
WHERE `workspace_id` IS NULL;
--> statement-breakpoint
UPDATE `regex_profile`
SET `workspace_id` = (
  SELECT `workspace`.`id`
  FROM `workspace`
  WHERE `workspace`.`account_id` = `regex_profile`.`account_id`
    AND `workspace`.`is_default` = 1
)
WHERE `workspace_id` IS NULL;
--> statement-breakpoint
UPDATE `llm_profile`
SET `workspace_id` = (
  SELECT `workspace`.`id`
  FROM `workspace`
  WHERE `workspace`.`account_id` = `llm_profile`.`account_id`
    AND `workspace`.`is_default` = 1
)
WHERE `workspace_id` IS NULL;
--> statement-breakpoint
UPDATE `tool_definition`
SET `workspace_id` = (
  SELECT `workspace`.`id`
  FROM `workspace`
  WHERE `workspace`.`account_id` = `tool_definition`.`account_id`
    AND `workspace`.`is_default` = 1
)
WHERE `workspace_id` IS NULL;
--> statement-breakpoint
UPDATE `mcp_server_config`
SET `workspace_id` = (
  SELECT `workspace`.`id`
  FROM `workspace`
  WHERE `workspace`.`account_id` = `mcp_server_config`.`account_id`
    AND `workspace`.`is_default` = 1
)
WHERE `workspace_id` IS NULL;
--> statement-breakpoint
INSERT INTO `project` (
  `id`,
  `account_id`,
  `workspace_id`,
  `name`,
  `description`,
  `kind`,
  `status`,
  `settings_override_json`,
  `created_at`,
  `updated_at`
)
SELECT
  'proj_session_' || `session`.`id`,
  `session`.`account_id`,
  `workspace`.`id`,
  COALESCE(NULLIF(TRIM(`session`.`title`), ''), '默认项目 - ' || `session`.`id`),
  NULL,
  'session_default',
  'active',
  '{}',
  `session`.`created_at`,
  `session`.`updated_at`
FROM `session`
JOIN `workspace`
  ON `workspace`.`account_id` = `session`.`account_id`
  AND `workspace`.`is_default` = 1
WHERE `session`.`project_id` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `project`
    WHERE `project`.`id` = 'proj_session_' || `session`.`id`
  );
--> statement-breakpoint
UPDATE `session`
SET
  `workspace_id` = (
    SELECT `project`.`workspace_id`
    FROM `project`
    WHERE `project`.`id` = 'proj_session_' || `session`.`id`
  ),
  `project_id` = 'proj_session_' || `id`
WHERE `project_id` IS NULL
  AND EXISTS (
    SELECT 1
    FROM `project`
    WHERE `project`.`id` = 'proj_session_' || `session`.`id`
  );
--> statement-breakpoint
UPDATE `llm_profile_binding`
SET `workspace_id` = COALESCE(
  CASE
    WHEN `scope` = 'session' THEN (
      SELECT `session`.`workspace_id`
      FROM `session`
      WHERE `session`.`id` = `llm_profile_binding`.`scope_id`
        AND `session`.`account_id` = `llm_profile_binding`.`account_id`
    )
  END,
  (
    SELECT `workspace`.`id`
    FROM `workspace`
    WHERE `workspace`.`account_id` = `llm_profile_binding`.`account_id`
      AND `workspace`.`is_default` = 1
  )
)
WHERE `workspace_id` IS NULL;
--> statement-breakpoint
UPDATE `llm_instance_config`
SET `workspace_id` = COALESCE(
  CASE
    WHEN `scope` = 'session' THEN (
      SELECT `session`.`workspace_id`
      FROM `session`
      WHERE `session`.`id` = `llm_instance_config`.`scope_id`
        AND `session`.`account_id` = `llm_instance_config`.`account_id`
    )
  END,
  (
    SELECT `workspace`.`id`
    FROM `workspace`
    WHERE `workspace`.`account_id` = `llm_instance_config`.`account_id`
      AND `workspace`.`is_default` = 1
  )
)
WHERE `workspace_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `session_account_workspace_updated_idx` ON `session` (`account_id`, `workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `session_account_project_updated_idx` ON `session` (`account_id`, `project_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `session_project_updated_idx` ON `session` (`project_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `character_account_workspace_updated_idx` ON `character` (`account_id`, `workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `account_user_account_workspace_updated_idx` ON `account_user` (`account_id`, `workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `preset_account_workspace_updated_idx` ON `preset` (`account_id`, `workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `worldbook_account_workspace_updated_idx` ON `worldbook` (`account_id`, `workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `regex_profile_account_workspace_updated_idx` ON `regex_profile` (`account_id`, `workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `llm_profile_account_workspace_updated_idx` ON `llm_profile` (`account_id`, `workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `llm_profile_binding_account_workspace_scope_idx` ON `llm_profile_binding` (`account_id`, `workspace_id`, `scope`, `scope_id`);
--> statement-breakpoint
CREATE INDEX `llm_instance_config_account_workspace_scope_idx` ON `llm_instance_config` (`account_id`, `workspace_id`, `scope`, `scope_id`);
--> statement-breakpoint
CREATE INDEX `tool_definition_account_workspace_source_idx` ON `tool_definition` (`account_id`, `workspace_id`, `source`);
--> statement-breakpoint
CREATE INDEX `mcp_server_config_account_workspace_updated_idx` ON `mcp_server_config` (`account_id`, `workspace_id`, `updated_at`);

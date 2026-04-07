DROP INDEX IF EXISTS `tool_definition_name_source_source_id_uq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_definition_account_name_source_source_id_uq`
ON `tool_definition`(`account_id`, `name`, `source`, `source_id`);

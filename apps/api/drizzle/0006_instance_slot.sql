-- Add instance_slot column to llm_profile_binding
-- Default '*' means "all slots" (wildcard), preserving backward compatibility
ALTER TABLE `llm_profile_binding` ADD COLUMN `instance_slot` text NOT NULL DEFAULT '*';
--> statement-breakpoint
-- Drop old unique index (scope, scope_id)
DROP INDEX IF EXISTS `llm_profile_binding_scope_scope_id_uq`;
--> statement-breakpoint
-- Create new unique index (scope, scope_id, instance_slot)
CREATE UNIQUE INDEX `llm_profile_binding_scope_scope_id_slot_uq` ON `llm_profile_binding` (`scope`, `scope_id`, `instance_slot`);

CREATE INDEX `memory_item_status_updated_at_idx` ON `memory_item` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `memory_item_scope_id_status_type_importance_idx` ON `memory_item` (`scope_id`,`status`,`type`,`importance`);

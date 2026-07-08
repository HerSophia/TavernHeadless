-- WP-A1: Workspace lifecycle management.
-- `workspace.kind` gains the `manual` value (enforced at the ORM/service layer;
-- the SQLite column has no CHECK constraint, so no column rebuild is required).
-- `workspace.archived_at` records when a manual Workspace was archived.
ALTER TABLE `workspace` ADD COLUMN `archived_at` integer;

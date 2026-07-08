-- WP-A2: Project lifecycle management.
-- `project.archived_at` records when a Project was archived so lifecycle
-- transitions (archive / restore) can be audited and reported.
ALTER TABLE `project` ADD COLUMN `archived_at` integer;

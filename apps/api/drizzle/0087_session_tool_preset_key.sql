-- SC2-10 (batch 4): sessions gain an optional tool policy preset binding.
-- `session.tool_preset_key` references a project-scoped tool policy preset key
-- (nullable; NULL keeps the pre-existing tool policy resolution unchanged so
-- existing sessions stay fully lazy).
ALTER TABLE `session` ADD COLUMN `tool_preset_key` text;

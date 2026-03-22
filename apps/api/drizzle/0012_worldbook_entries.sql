-- Create worldbook_entry table
CREATE TABLE `worldbook_entry` (
  `id` text PRIMARY KEY NOT NULL,
  `worldbook_id` text NOT NULL REFERENCES `worldbook`(`id`) ON DELETE CASCADE,
  `uid` integer NOT NULL,
  `comment` text NOT NULL DEFAULT '',
  `content` text NOT NULL DEFAULT '',
  `keys_json` text NOT NULL DEFAULT '[]',
  `keys_secondary_json` text NOT NULL DEFAULT '[]',
  `selective` integer NOT NULL DEFAULT 1,
  `selective_logic` integer NOT NULL DEFAULT 0,
  `constant` integer NOT NULL DEFAULT 0,
  `position` integer NOT NULL DEFAULT 0,
  `order` integer NOT NULL DEFAULT 100,
  `depth` integer NOT NULL DEFAULT 4,
  `role` integer NOT NULL DEFAULT 0,
  `disable` integer NOT NULL DEFAULT 0,
  `scan_depth` integer,
  `case_sensitive` integer,
  `match_whole_words` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wb_entry_worldbook_order_idx` ON `worldbook_entry` (`worldbook_id`, `order`);
--> statement-breakpoint
CREATE INDEX `wb_entry_worldbook_updated_idx` ON `worldbook_entry` (`worldbook_id`, `updated_at`);
--> statement-breakpoint
-- Migrate existing entries from worldbook.data_json into the new table
INSERT INTO `worldbook_entry` (
  `id`, `worldbook_id`, `uid`, `comment`, `content`,
  `keys_json`, `keys_secondary_json`,
  `selective`, `selective_logic`, `constant`,
  `position`, `order`, `depth`, `role`, `disable`,
  `scan_depth`, `case_sensitive`, `match_whole_words`,
  `created_at`, `updated_at`
)
SELECT
  lower(hex(randomblob(10))),
  w.id,
  COALESCE(json_extract(je.value, '$.uid'), je.key),
  COALESCE(json_extract(je.value, '$.comment'), ''),
  COALESCE(json_extract(je.value, '$.content'), ''),
  COALESCE(json_extract(je.value, '$.key'), '[]'),
  COALESCE(json_extract(je.value, '$.keysecondary'), '[]'),
  COALESCE(json_extract(je.value, '$.selective'), 1),
  COALESCE(json_extract(je.value, '$.selectiveLogic'), 0),
  COALESCE(json_extract(je.value, '$.constant'), 0),
  COALESCE(json_extract(je.value, '$.position'), 0),
  COALESCE(json_extract(je.value, '$.order'), 100),
  COALESCE(json_extract(je.value, '$.depth'), 4),
  COALESCE(json_extract(je.value, '$.role'), 0),
  COALESCE(json_extract(je.value, '$.disable'), 0),
  json_extract(je.value, '$.scanDepth'),
  json_extract(je.value, '$.caseSensitive'),
  json_extract(je.value, '$.matchWholeWords'),
  w.created_at,
  w.updated_at
FROM `worldbook` w, json_each(json_extract(w.data_json, '$.entries')) je;
--> statement-breakpoint
-- Strip entries and name from data_json, keeping only global settings
UPDATE `worldbook` SET data_json = json_remove(data_json, '$.entries', '$.name');

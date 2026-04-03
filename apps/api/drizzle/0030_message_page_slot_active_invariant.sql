WITH ranked_pages AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY floor_id, page_no
      ORDER BY
        CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
        updated_at DESC,
        version DESC,
        created_at DESC,
        id DESC
    ) AS row_rank
  FROM message_page
)
UPDATE message_page
SET is_active = CASE
  WHEN id IN (SELECT id FROM ranked_pages WHERE row_rank = 1) THEN 1
  ELSE 0
END
WHERE id IN (SELECT id FROM ranked_pages);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_page_floor_no_active_uq`
ON `message_page` (`floor_id`, `page_no`)
WHERE `is_active` = 1;

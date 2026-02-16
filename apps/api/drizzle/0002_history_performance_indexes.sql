CREATE INDEX `floor_session_branch_state_no_idx` ON `floor` (`session_id`,`branch_id`,`state`,`floor_no`);
--> statement-breakpoint
CREATE INDEX `message_page_floor_active_no_idx` ON `message_page` (`floor_id`,`is_active`,`page_no`);
--> statement-breakpoint
CREATE INDEX `message_page_hidden_seq_idx` ON `message` (`page_id`,`is_hidden`,`seq`);

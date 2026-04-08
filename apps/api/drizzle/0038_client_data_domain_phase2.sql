ALTER TABLE `client_data_domain` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `client_data_collection` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE `client_data_domain_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`grantee_owner_type` text NOT NULL,
	`grantee_owner_id` text NOT NULL,
	`can_read` integer DEFAULT false NOT NULL,
	`can_write` integer DEFAULT false NOT NULL,
	`can_delete` integer DEFAULT false NOT NULL,
	`can_list` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`domain_id`) REFERENCES `client_data_domain`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_data_domain_grant_unique_uq` ON `client_data_domain_grant` (`domain_id`,`grantee_owner_type`,`grantee_owner_id`);
--> statement-breakpoint
CREATE INDEX `client_data_domain_grant_account_grantee_idx` ON `client_data_domain_grant` (`account_id`,`grantee_owner_type`,`grantee_owner_id`);
--> statement-breakpoint
CREATE TABLE `client_data_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`domain_id` text,
	`owner_type` text,
	`owner_id` text,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`request_id` text,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`domain_id`) REFERENCES `client_data_domain`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `client_data_audit_log_account_created_idx` ON `client_data_audit_log` (`account_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `client_data_audit_log_domain_created_idx` ON `client_data_audit_log` (`domain_id`,`created_at`);
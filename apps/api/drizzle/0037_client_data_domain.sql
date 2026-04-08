CREATE TABLE `client_data_domain` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `owner_type` text DEFAULT 'application' NOT NULL,
  `owner_id` text NOT NULL,
  `domain_name` text NOT NULL,
  `display_name` text,
  `description` text,
  `status` text DEFAULT 'active' NOT NULL,
  `quota_max_entries` integer DEFAULT 10000 NOT NULL,
  `quota_max_bytes` integer DEFAULT 10485760 NOT NULL,
  `current_entry_count` integer DEFAULT 0 NOT NULL,
  `current_byte_count` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_data_domain_owner_name_uq`
  ON `client_data_domain` (`account_id`, `owner_type`, `owner_id`, `domain_name`)
  WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `client_data_domain_account_owner_status_idx`
  ON `client_data_domain` (`account_id`, `owner_type`, `owner_id`, `status`);
--> statement-breakpoint
CREATE TABLE `client_data_collection` (
  `id` text PRIMARY KEY NOT NULL,
  `domain_id` text NOT NULL,
  `collection_name` text NOT NULL,
  `description` text,
  `default_expires_ttl_ms` integer,
  `max_item_size_bytes` integer,
  `metadata_json` text,
  `item_count` integer DEFAULT 0 NOT NULL,
  `byte_count` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`domain_id`) REFERENCES `client_data_domain`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_data_collection_domain_name_uq`
  ON `client_data_collection` (`domain_id`, `collection_name`);
--> statement-breakpoint
CREATE INDEX `client_data_collection_domain_updated_idx`
  ON `client_data_collection` (`domain_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `client_data_item` (
  `id` text PRIMARY KEY NOT NULL,
  `domain_id` text NOT NULL,
  `collection_id` text NOT NULL,
  `item_key` text NOT NULL,
  `value_json` text NOT NULL,
  `byte_size` integer NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `expires_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`domain_id`) REFERENCES `client_data_domain`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`collection_id`) REFERENCES `client_data_collection`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_data_item_collection_key_uq`
  ON `client_data_item` (`collection_id`, `item_key`);
--> statement-breakpoint
CREATE INDEX `client_data_item_domain_collection_updated_idx`
  ON `client_data_item` (`domain_id`, `collection_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `client_data_item_expires_idx`
  ON `client_data_item` (`expires_at`)
  WHERE `expires_at` IS NOT NULL;

CREATE TABLE `preset` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `source` text DEFAULT 'sillytavern' NOT NULL,
  `data_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worldbook` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `source` text DEFAULT 'sillytavern' NOT NULL,
  `data_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `regex_profile` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `source` text DEFAULT 'sillytavern' NOT NULL,
  `data_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

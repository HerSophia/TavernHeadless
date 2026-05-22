CREATE TABLE `agent_type` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `account_id` text NOT NULL,
  `key` text NOT NULL,
  `name` text NOT NULL,
  `scope_kind` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `default_llm_profile_id` text,
  `default_tool_policy_id` text,
  `default_mcp_binding_json` text NOT NULL DEFAULT '{}',
  `default_event_subscriptions_json` text NOT NULL DEFAULT '[]',
  `default_grants_json` text NOT NULL DEFAULT '{}',
  `metadata_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `project_agent_binding` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `account_id` text NOT NULL,
  `agent_type_id` text NOT NULL,
  `status` text NOT NULL DEFAULT 'enabled',
  `scope_kind` text NOT NULL,
  `llm_profile_id` text,
  `tool_policy_id` text,
  `mcp_binding_json` text NOT NULL DEFAULT '{}',
  `event_subscriptions_json` text NOT NULL DEFAULT '[]',
  `grants_json` text NOT NULL DEFAULT '{}',
  `metadata_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE restrict,
  FOREIGN KEY (`agent_type_id`) REFERENCES `agent_type`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `project_llm_profile_override` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `account_id` text NOT NULL,
  `base_profile_id` text NOT NULL,
  `override_json` text NOT NULL DEFAULT '{}',
  `status` text NOT NULL DEFAULT 'active',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `project_mcp_binding` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `account_id` text NOT NULL,
  `mcp_server_id` text NOT NULL,
  `status` text NOT NULL DEFAULT 'enabled',
  `allowed_tools_json` text NOT NULL DEFAULT '[]',
  `config_override_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `project_tool_policy_override` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `account_id` text NOT NULL,
  `base_policy_id` text NOT NULL,
  `override_json` text NOT NULL DEFAULT '{}',
  `status` text NOT NULL DEFAULT 'active',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE restrict
);
--> statement-breakpoint
ALTER TABLE `runtime_job` ADD COLUMN `workspace_id` text REFERENCES `workspace`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `runtime_job` ADD COLUMN `project_id` text REFERENCES `project`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `runtime_job` ADD COLUMN `actor_client_id` text REFERENCES `client`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `runtime_job` ADD COLUMN `source_event_id` text REFERENCES `project_event`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `runtime_job` ADD COLUMN `agent_type_id` text REFERENCES `agent_type`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `runtime_job` ADD COLUMN `agent_binding_id` text REFERENCES `project_agent_binding`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_type_workspace_key_uq` ON `agent_type` (`workspace_id`, `key`);
--> statement-breakpoint
CREATE INDEX `agent_type_workspace_status_idx` ON `agent_type` (`workspace_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `agent_type_account_status_idx` ON `agent_type` (`account_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_agent_binding_project_agent_uq` ON `project_agent_binding` (`project_id`, `agent_type_id`);
--> statement-breakpoint
CREATE INDEX `project_agent_binding_project_status_idx` ON `project_agent_binding` (`project_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_agent_binding_workspace_idx` ON `project_agent_binding` (`workspace_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_agent_binding_agent_type_idx` ON `project_agent_binding` (`agent_type_id`, `status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_llm_profile_override_project_uq` ON `project_llm_profile_override` (`project_id`) WHERE `status` = 'active';
--> statement-breakpoint
CREATE INDEX `project_llm_profile_override_workspace_idx` ON `project_llm_profile_override` (`workspace_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_mcp_binding_project_server_uq` ON `project_mcp_binding` (`project_id`, `mcp_server_id`);
--> statement-breakpoint
CREATE INDEX `project_mcp_binding_workspace_idx` ON `project_mcp_binding` (`workspace_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_tool_policy_override_project_base_uq` ON `project_tool_policy_override` (`project_id`, `base_policy_id`);
--> statement-breakpoint
CREATE INDEX `project_tool_policy_override_workspace_idx` ON `project_tool_policy_override` (`workspace_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `runtime_job_agent_type_status_idx` ON `runtime_job` (`agent_type_id`, `status`, `available_at`);
--> statement-breakpoint
CREATE INDEX `runtime_job_agent_binding_status_idx` ON `runtime_job` (`agent_binding_id`, `status`, `available_at`);
--> statement-breakpoint
CREATE INDEX `runtime_job_project_status_idx` ON `runtime_job` (`project_id`, `status`, `available_at`);
--> statement-breakpoint
CREATE INDEX `runtime_job_source_event_idx` ON `runtime_job` (`source_event_id`);

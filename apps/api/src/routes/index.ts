import type { CoreEventBus } from "@tavern/core";
import type { FastifyInstance } from "fastify";

import type { DatabaseConnection } from "../db/client";
import type { ClientDataConfig } from "../client-data/client-data-service.js";
import type { SessionToolRegistryService } from "../services/tooling/session-tool-registry-service.js";
import type { FloorRunServiceOptions } from "../services/floor-run-service.js";
import type { McpConnectionManager } from "../services/tooling/mcp/mcp-connection-manager.js";
import type { MutationRuntime } from "../services/runtime-mutation-types.js";
import type { ProjectEventLiveHub } from "../services/project-event-live-hub.js";
import { registerCharacterRoutes } from "./characters";
import { registerFloorRoutes } from "./floors";
import { registerImportRoutes } from "./imports";
import { registerMemoryRoutes } from "./memories";
import { registerMemoryJobRoutes, type MemoryJobRoutesOptions } from "./memory-jobs";
import { registerMessageRoutes } from "./messages";
import { registerWorldbookEntryRoutes } from "./worldbook-entries";
import { registerPresetEntryRoutes } from "./preset-entries";
import { registerMessagePageRoutes } from "./pages";
import { registerChatTransferJobRoutes, type ChatTransferJobRoutesOptions } from "./chat-transfer-jobs";
import { registerLlmProfileRoutes } from "./llm-profiles";
import { registerLlmInstanceRoutes } from "./llm-instances";
import { registerBackupRoutes, type BackupRoutesOptions } from "./backup";
import { registerBackupJobRoutes, type BackupJobRoutesOptions } from "./backup-jobs";
import { registerSessionRoutes } from "./sessions";
import { registerMcpConfigRoutes, registerSessionRuntimeToolRoutes, registerToolRoutes } from "./tooling";
import { registerVariableRoutes } from "./variables";
import { registerAccountRoutes } from "./accounts";
import { registerUserRoutes } from "./users";
import { registerExportRoutes } from "./exports";
import { registerClientDataRoutes } from "../client-data/client-data-routes.js";
import { registerClientRoutes } from "./clients.js";
import { registerAssetVersionRoutes } from "./asset-versions.js";
import { registerBranchVcRoutes } from "./branch-vc.js";
import { registerOperationLogRoutes } from "./operation-logs.js";
import { registerProjectRoutes } from "./projects.js";
import { registerWorkspaceRoutes } from "./workspaces.js";
import { registerProjectAgentBindingRoutes } from "./project-agent-bindings.js";
import { registerVcTagRoutes } from "./vc-tags.js";
import type { AccountMode } from "../accounts/constants.js";

export interface CrudRoutesOptions {
  variableEventBus?: CoreEventBus;
  memoryEventBus?: CoreEventBus;
  sessionToolRegistryService?: SessionToolRegistryService;
  memoryJobs?: MemoryJobRoutesOptions;
  chatTransferJobs?: ChatTransferJobRoutesOptions & { importMaxBytes?: number; exportSyncMaxMessages?: number; exportArtifactTtlMs?: number };
  backupJobs?: BackupRoutesOptions & BackupJobRoutesOptions & { importMaxBytes?: number; exportArtifactTtlMs?: number };
  mutationRuntime?: MutationRuntime;
  mcpManager?: McpConnectionManager;
  enableUnsafeScriptHandler?: boolean;
  accountMode?: AccountMode;
  enableClientData?: boolean;
  clientData?: ClientDataConfig;
  floorRun?: FloorRunServiceOptions;
  projectEventLiveHub?: ProjectEventLiveHub;
}

export async function registerCrudRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: CrudRoutesOptions = {}
): Promise<void> {
  await registerAccountRoutes(app, connection, {
    accountMode: options.accountMode,
  });
  await registerClientRoutes(app, connection);
  await registerSessionRoutes(app, connection, {
    clientData: options.enableClientData ? options.clientData : undefined,
    floorRun: options.floorRun,
    projectEventLiveHub: options.projectEventLiveHub,
  });
  await registerSessionRuntimeToolRoutes(app, {
    sessionToolRegistryService: options.sessionToolRegistryService,
  });
  await registerProjectRoutes(app, connection, {
    projectEventLiveHub: options.projectEventLiveHub,
  });
  await registerWorkspaceRoutes(app, connection);
  await registerProjectAgentBindingRoutes(app, connection);
  await registerCharacterRoutes(app, connection);
  await registerFloorRoutes(app, connection, {
    floorRun: options.floorRun,
  });
  await registerUserRoutes(app, connection);
  await registerMessagePageRoutes(app, connection);
  await registerMessageRoutes(app, connection);
  await registerVariableRoutes(app, connection, {
    eventBus: options.variableEventBus,
    mutationRuntime: options.mutationRuntime,
  });
  await registerMemoryRoutes(app, connection, {
    eventBus: options.memoryEventBus,
  });
  await registerMemoryJobRoutes(app, connection, options.memoryJobs);
  await registerImportRoutes(app, connection, options.chatTransferJobs);
  await registerLlmProfileRoutes(app, connection, {
    mutationRuntime: options.mutationRuntime,
    accountMode: options.accountMode,
  });
  await registerBackupRoutes(app, connection, options.backupJobs);
  await registerLlmInstanceRoutes(app, connection, { mutationRuntime: options.mutationRuntime });
  await registerChatTransferJobRoutes(app, connection, options.chatTransferJobs);
  await registerWorldbookEntryRoutes(app, connection);
  await registerPresetEntryRoutes(app, connection);
  await registerAssetVersionRoutes(app, connection);
  await registerBranchVcRoutes(app, connection, {
    floorRun: options.floorRun,
  });
  await registerOperationLogRoutes(app, connection);
  await registerVcTagRoutes(app, connection);
  await registerToolRoutes(app, connection, {
    enableUnsafeScriptHandler: options.enableUnsafeScriptHandler,
  });
  await registerBackupJobRoutes(app, connection, options.backupJobs);
  await registerMcpConfigRoutes(app, connection, {
    mcpManager: options.mcpManager,
  });
  await registerExportRoutes(app, connection, options.chatTransferJobs);

  if (options.enableClientData && options.clientData) {
    await registerClientDataRoutes(app, connection, {
      clientData: options.clientData,
    });
  }
}

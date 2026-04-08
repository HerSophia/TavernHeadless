import type { CoreEventBus } from "@tavern/core";
import type { FastifyInstance } from "fastify";

import type { DatabaseConnection } from "../db/client";
import type { ClientDataConfig } from "../client-data/client-data-service.js";
import type { SessionToolRegistryService } from "../services/session-tool-registry-service.js";
import type { McpConnectionManager } from "../mcp/mcp-connection-manager.js";
import type { MutationRuntime } from "../services/runtime-mutation-types.js";
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
import { registerSessionRoutes } from "./sessions";
import { registerSessionRuntimeToolRoutes } from "./session-runtime-tools";
import { registerVariableRoutes } from "./variables";
import { registerAccountRoutes } from "./accounts";
import { registerUserRoutes } from "./users";
import { registerToolRoutes } from "./tools";
import { registerMcpConfigRoutes } from "./mcp";
import { registerExportRoutes } from "./exports";
import { registerClientDataRoutes } from "../client-data/client-data-routes.js";
import type { AccountMode } from "../accounts/constants.js";

export interface CrudRoutesOptions {
  variableEventBus?: CoreEventBus;
  sessionToolRegistryService?: SessionToolRegistryService;
  memoryJobs?: MemoryJobRoutesOptions;
  chatTransferJobs?: ChatTransferJobRoutesOptions & { importMaxBytes?: number; exportSyncMaxMessages?: number; exportArtifactTtlMs?: number };
  mutationRuntime?: MutationRuntime;
  mcpManager?: McpConnectionManager;
  enableUnsafeScriptHandler?: boolean;
  accountMode?: AccountMode;
  enableClientData?: boolean;
  clientData?: ClientDataConfig;
}

export async function registerCrudRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: CrudRoutesOptions = {}
): Promise<void> {
  await registerAccountRoutes(app, connection, {
    accountMode: options.accountMode,
  });
  await registerSessionRoutes(app, connection);
  await registerSessionRuntimeToolRoutes(app, {
    sessionToolRegistryService: options.sessionToolRegistryService,
  });
  await registerCharacterRoutes(app, connection);
  await registerFloorRoutes(app, connection);
  await registerUserRoutes(app, connection);
  await registerMessagePageRoutes(app, connection);
  await registerMessageRoutes(app, connection);
  await registerVariableRoutes(app, connection, {
    eventBus: options.variableEventBus,
    mutationRuntime: options.mutationRuntime,
  });
  await registerMemoryRoutes(app, connection);
  await registerMemoryJobRoutes(app, connection, options.memoryJobs);
  await registerImportRoutes(app, connection, options.chatTransferJobs);
  await registerLlmProfileRoutes(app, connection, {
    mutationRuntime: options.mutationRuntime,
    accountMode: options.accountMode,
  });
  await registerLlmInstanceRoutes(app, connection, { mutationRuntime: options.mutationRuntime });
  await registerChatTransferJobRoutes(app, connection, options.chatTransferJobs);
  await registerWorldbookEntryRoutes(app, connection);
  await registerPresetEntryRoutes(app, connection);
  await registerToolRoutes(app, connection, {
    enableUnsafeScriptHandler: options.enableUnsafeScriptHandler,
  });
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

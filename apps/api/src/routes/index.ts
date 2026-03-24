import type { FastifyInstance } from "fastify";

import type { DatabaseConnection } from "../db/client";
import { registerCharacterRoutes } from "./characters";
import { registerFloorRoutes } from "./floors";
import { registerImportRoutes } from "./imports";
import { registerMemoryRoutes } from "./memories";
import { registerMessageRoutes } from "./messages";
import { registerWorldbookEntryRoutes } from "./worldbook-entries";
import { registerPresetEntryRoutes } from "./preset-entries";
import { registerMessagePageRoutes } from "./pages";
import { registerLlmProfileRoutes } from "./llm-profiles";
import { registerLlmInstanceRoutes } from "./llm-instances";
import { registerSessionRoutes } from "./sessions";
import { registerVariableRoutes } from "./variables";
import { registerAccountRoutes } from "./accounts";
import { registerUserRoutes } from "./users";
import { registerToolRoutes } from "./tools";
import { registerMcpConfigRoutes } from "./mcp";
import { registerExportRoutes } from "./exports";

export async function registerCrudRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection
): Promise<void> {
  await registerAccountRoutes(app, connection);
  await registerSessionRoutes(app, connection);
  await registerCharacterRoutes(app, connection);
  await registerFloorRoutes(app, connection);
  await registerUserRoutes(app, connection);
  await registerMessagePageRoutes(app, connection);
  await registerMessageRoutes(app, connection);
  await registerVariableRoutes(app, connection);
  await registerMemoryRoutes(app, connection);
  await registerImportRoutes(app, connection);
  await registerLlmProfileRoutes(app, connection);
  await registerLlmInstanceRoutes(app, connection);
  await registerWorldbookEntryRoutes(app, connection);
  await registerPresetEntryRoutes(app, connection);
  await registerToolRoutes(app, connection);
  await registerMcpConfigRoutes(app, connection);
  await registerExportRoutes(app, connection);
}

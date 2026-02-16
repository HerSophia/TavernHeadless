import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// 从 monorepo 根目录加载 .env
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, "../../../.env") });

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const { app } = await buildApp({
  databasePath: config.databasePath,
  orchestration: config.orchestration,
  enableWebSocket: config.enableWebSocket,
  chatHistoryMaxFloors: config.chatHistoryMaxFloors,
  enableMemory: config.enableMemory,
  enableMemoryConsolidation: config.enableMemoryConsolidation,
  enableSseChat: config.enableSseChat,
  enablePromptDryRun: config.enablePromptDryRun,
  accountMode: config.accountMode,
  auth: config.auth,
  cors: config.cors,
});

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`API listening on :${config.port}`);
    if (config.orchestration) {
      app.log.info(
        `Chat routes enabled (model: ${config.orchestration.defaultModel.modelId})`
      );
    } else {
      app.log.info(
        "Chat routes disabled (set LLM_API_KEY to enable)"
      );
    }
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down API server`);

    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error(error);
      process.exit(1);
    }
  });
}

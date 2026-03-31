import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase } from "./db/client.js";
import { loadConfig } from "./config.js";
import { ChatTransferWorker } from "./services/chat-transfer-worker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, "../../../.env") });

const config = loadConfig();

if (!config.enableChatTransferWorker) {
  console.info("Chat transfer worker is disabled (set ENABLE_CHAT_TRANSFER_WORKER=true to enable)");
  process.exit(0);
}

const database = createDatabase(config.databasePath);
const worker = new ChatTransferWorker(database.db, {
  artifactDir: config.chatTransferArtifactDir,
  pollIntervalMs: config.chatTransferWorker?.pollIntervalMs,
  leaseTtlMs: config.chatTransferWorker?.leaseTtlMs,
  maxConcurrentJobs: config.chatTransferWorker?.maxConcurrentJobs ?? 1,
  retryBaseDelayMs: config.chatTransferWorker?.retryBaseDelayMs,
  maxRetryDelayMs: config.chatTransferWorker?.maxRetryDelayMs,
  candidateScanLimit: config.chatTransferWorker?.candidateScanLimit,
  exportArtifactTtlMs: config.chatExportArtifactTtlMs,
  logger: {
    info(meta, message) {
      console.info(message, meta);
    },
    warn(meta, message) {
      console.warn(message, meta);
    },
    error(meta, message) {
      console.error(message, meta);
    },
  },
});

worker.start();
console.info("Chat transfer worker started");

const shutdown = async (signal: string) => {
  console.info(`Received ${signal}, shutting down chat transfer worker`);
  try {
    await worker.stop();
    database.close();
    process.exit(0);
  } catch (error) {
    console.error("Failed to stop chat transfer worker", error);
    process.exit(1);
  }
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

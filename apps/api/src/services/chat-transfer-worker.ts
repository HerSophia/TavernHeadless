import { nanoid } from "nanoid";
import type { CoreEventBus } from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { RuntimeWorker } from "./runtime-worker.js";
import { createChatTransferRuntimeJobCatalog } from "./chat-transfer-runtime-job-definitions.js";
import {
  createChatTransferRuntimeJobProcessorRegistry,
} from "./chat-transfer-runtime-job-processor.js";

export interface ChatTransferWorkerLogger {
  info?(obj: unknown, message?: string): void;
  warn?(obj: unknown, message?: string): void;
  error?(obj: unknown, message?: string): void;
}

export interface ChatTransferWorkerOptions {
  artifactDir: string;
  exportArtifactTtlMs?: number;
  workerId?: string;
  pollIntervalMs?: number;
  leaseTtlMs?: number;
  maxConcurrentJobs?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
  candidateScanLimit?: number;
  logger?: ChatTransferWorkerLogger;
  eventBus?: CoreEventBus;
}

export class ChatTransferWorker {
  private readonly runtimeWorker: RuntimeWorker;

  constructor(
    db: AppDb,
    options: ChatTransferWorkerOptions,
  ) {
    const catalog = createChatTransferRuntimeJobCatalog();
    const processors = createChatTransferRuntimeJobProcessorRegistry({
      artifactDir: options.artifactDir,
      exportArtifactTtlMs: options.exportArtifactTtlMs,
    });

    this.runtimeWorker = new RuntimeWorker(db, catalog, processors, {
      workerId: options.workerId ?? `chat-transfer-worker-${nanoid(8)}`,
      pollIntervalMs: options.pollIntervalMs,
      leaseTtlMs: options.leaseTtlMs,
      maxConcurrentJobs: options.maxConcurrentJobs,
      retryBaseDelayMs: options.retryBaseDelayMs,
      maxRetryDelayMs: options.maxRetryDelayMs,
      candidateScanLimit: options.candidateScanLimit,
      jobTypes: catalog.list().map((definition) => definition.jobType),
      eventBus: options.eventBus,
      logger: options.logger,
    });
  }

  start(): void {
    this.runtimeWorker.start();
  }

  async stop(): Promise<void> {
    await this.runtimeWorker.stop();
  }

  async processOneDueJob(): Promise<boolean> {
    return await this.runtimeWorker.processOneDueJob();
  }

  get activeJobCount(): number {
    return this.runtimeWorker.activeJobCount;
  }
}

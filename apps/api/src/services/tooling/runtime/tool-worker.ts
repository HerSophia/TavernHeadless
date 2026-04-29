import { nanoid } from "nanoid";
import type { CoreEventBus } from "@tavern/core";

import type { AppDb } from "../../../db/client.js";
import { RuntimeWorker } from "../../runtime-worker.js";
import { createToolRuntimeJobCatalog } from "./tool-runtime-job-definitions.js";
import { createToolRuntimeJobProcessorRegistry } from "./tool-runtime-job-processor.js";
import type { ToolAsyncHandlerRegistry } from "./tool-async-handler-registry.js";

export interface ToolWorkerLogger {
  info?(obj: unknown, message?: string): void;
  warn?(obj: unknown, message?: string): void;
  error?(obj: unknown, message?: string): void;
}

export interface ToolWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  leaseTtlMs?: number;
  maxConcurrentJobs?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
  candidateScanLimit?: number;
  logger?: ToolWorkerLogger;
  eventBus?: CoreEventBus;
  now?: () => number;
}

export class ToolWorker {
  private readonly runtimeWorker: RuntimeWorker;

  constructor(
    db: AppDb,
    handlers: ToolAsyncHandlerRegistry,
    options: ToolWorkerOptions = {},
  ) {
    const catalog = createToolRuntimeJobCatalog();
    const processors = createToolRuntimeJobProcessorRegistry({
      db,
      handlers,
      now: options.now,
    });

    this.runtimeWorker = new RuntimeWorker(db, catalog, processors, {
      workerId: options.workerId ?? `tool-worker-${nanoid(8)}`,
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

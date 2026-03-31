import { nanoid } from "nanoid";
import type {
  CoreEventBus,
  MemoryCompactionProcessor,
  MemoryIngestProcessor,
  MemoryStore,
} from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { createMemoryRuntimeJobProcessorRegistry } from "./memory-runtime-job-processor.js";
import { createMemoryRuntimeJobCatalog } from "./memory-runtime-job-definitions.js";
import { RuntimeWorker } from "./runtime-worker.js";

interface MemoryWorkerLogger {
  info?(obj: unknown, message?: string): void;
  warn?(obj: unknown, message?: string): void;
  error?(obj: unknown, message?: string): void;
}

export interface MemoryWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  leaseTtlMs?: number;
  maxConcurrentJobs?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
  candidateScanLimit?: number;
  enableMacroCompaction?: boolean;
  logger?: MemoryWorkerLogger;
}

export class MemoryWorker {
  private readonly runtimeWorker: RuntimeWorker;

  constructor(
    db: AppDb,
    memoryStore: MemoryStore,
    memoryIngestProcessor: MemoryIngestProcessor,
    memoryCompactionProcessor: MemoryCompactionProcessor,
    eventBus: CoreEventBus,
    options: MemoryWorkerOptions = {},
  ) {
    const catalog = createMemoryRuntimeJobCatalog();
    const processors = createMemoryRuntimeJobProcessorRegistry({
      db,
      memoryStore,
      memoryIngestProcessor,
      memoryCompactionProcessor,
      eventBus,
      enableMacroCompaction: options.enableMacroCompaction === true,
    });

    this.runtimeWorker = new RuntimeWorker(db, catalog, processors, {
      workerId: options.workerId ?? `memory-worker-${nanoid(8)}`,
      pollIntervalMs: options.pollIntervalMs,
      leaseTtlMs: options.leaseTtlMs,
      maxConcurrentJobs: options.maxConcurrentJobs,
      retryBaseDelayMs: options.retryBaseDelayMs,
      maxRetryDelayMs: options.maxRetryDelayMs,
      candidateScanLimit: options.candidateScanLimit,
      jobTypes: catalog.list().map((definition) => definition.jobType),
      eventBus,
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

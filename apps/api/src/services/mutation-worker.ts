import { nanoid } from "nanoid"
import type { CoreEventBus } from "@tavern/core"

import type { AppDb } from "../db/client.js"
import { MutationApplierRegistry } from "./mutation-applier-registry.js"
import { createMutationRuntimeJobCatalog } from "./mutation-runtime-job-definitions.js"
import { createMutationRuntimeJobProcessorRegistry } from "./mutation-runtime-job-processor.js"
import { RuntimeWorker } from "./runtime-worker.js"

interface MutationWorkerLogger {
  info?(obj: unknown, message?: string): void
  warn?(obj: unknown, message?: string): void
  error?(obj: unknown, message?: string): void
}

export interface MutationWorkerOptions {
  workerId?: string
  pollIntervalMs?: number
  leaseTtlMs?: number
  maxConcurrentJobs?: number
  retryBaseDelayMs?: number
  maxRetryDelayMs?: number
  candidateScanLimit?: number
  logger?: MutationWorkerLogger
  eventBus?: CoreEventBus
  now?: () => number
}

export class MutationWorker {
  private readonly runtimeWorker: RuntimeWorker

  constructor(
    db: AppDb,
    mutationRegistry: MutationApplierRegistry,
    options: MutationWorkerOptions = {},
  ) {
    const catalog = createMutationRuntimeJobCatalog()
    const processors = createMutationRuntimeJobProcessorRegistry({
      db,
      registry: mutationRegistry,
      eventBus: options.eventBus,
      now: options.now,
    })

    this.runtimeWorker = new RuntimeWorker(db, catalog, processors, {
      workerId: options.workerId ?? `mutation-worker-${nanoid(8)}`,
      pollIntervalMs: options.pollIntervalMs,
      leaseTtlMs: options.leaseTtlMs,
      maxConcurrentJobs: options.maxConcurrentJobs,
      retryBaseDelayMs: options.retryBaseDelayMs,
      maxRetryDelayMs: options.maxRetryDelayMs,
      candidateScanLimit: options.candidateScanLimit,
      jobTypes: catalog.list().map((definition) => definition.jobType),
      eventBus: options.eventBus,
      logger: options.logger,
    })
  }

  start(): void {
    this.runtimeWorker.start()
  }

  async stop(): Promise<void> {
    await this.runtimeWorker.stop()
  }

  async processOneDueJob(): Promise<boolean> {
    return await this.runtimeWorker.processOneDueJob()
  }

  get activeJobCount(): number {
    return this.runtimeWorker.activeJobCount
  }
}

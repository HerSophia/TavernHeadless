import { nanoid } from "nanoid";
import type { CoreEventBus } from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { RuntimeWorker } from "./runtime-worker.js";
import { createNodeGraphRuntimeJobCatalog } from "./node-graph-runtime-job-definitions.js";
import { createNodeGraphRuntimeJobProcessorRegistry } from "./node-graph-runtime-job-processor.js";
import type { AgentExecutorRouter } from "./agent-runtime/agent-executor-router.js";

interface NodeGraphWorkerLogger {
  info?(obj: unknown, message?: string): void;
  warn?(obj: unknown, message?: string): void;
  error?(obj: unknown, message?: string): void;
}

export interface NodeGraphWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  leaseTtlMs?: number;
  maxConcurrentJobs?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
  candidateScanLimit?: number;
  eventBus?: CoreEventBus;
  logger?: NodeGraphWorkerLogger;
  agentRouter?: AgentExecutorRouter;
}

export class NodeGraphWorker {
  private readonly runtimeWorker: RuntimeWorker;

  constructor(db: AppDb, options: NodeGraphWorkerOptions = {}) {
    const catalog = createNodeGraphRuntimeJobCatalog();
    const processors = createNodeGraphRuntimeJobProcessorRegistry({
      ...(options.agentRouter ? { agentRouter: options.agentRouter } : {}),
    });
    this.runtimeWorker = new RuntimeWorker(db, catalog, processors, {
      workerId: options.workerId ?? `node-graph-worker-${nanoid(8)}`,
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

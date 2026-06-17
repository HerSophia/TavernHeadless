/**
 * AgentRuntimeWorker：后台 Agent 的 worker 装配（R4 阶段四）。
 *
 * 参照MemoryWorker / ToolWorker 的封装，内部复用 RuntimeWorker。
 * 它把真实化后的 agent.run Processor、BackgroundAgentExecutor 与
 * AgentOutputDispatcher 串起来，并把 jobTypes 限定为 agent.run，
 * 与其他 worker 的 job type 不重叠。
 *
 * 默认是否启用由调用方（app.ts）按配置决定，保证可回退。
 */
import { nanoid } from "nanoid";
import type { CoreEventBus } from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { RuntimeWorker } from "./runtime-worker.js";
import { createAgentRuntimeJobCatalog } from "./agent-runtime-job-definitions.js";
import { createAgentRuntimeJobProcessorRegistry } from "./agent-runtime-job-processor.js";
import {
  BackgroundAgentExecutor,
} from "./agent-runtime/background-agent-executor.js";
import type { BackgroundAgentHandler } from "./agent-runtime/background-agent-types.js";
import { ProjectDigestAgent } from "./agent-runtime/builtin/project-digest-agent.js";
import {
  AgentOutputDispatcher,
  type DerivedOutputSink,
type ProjectInboxSink,
  type SessionStateProposalSink,
} from "./agent-runtime/agent-output-dispatcher.js";
import { DerivedOutputService } from "./derived-output-service.js";
import { ProjectInboxService } from "./project-inbox-service.js";

interface AgentRuntimeWorkerLogger {
  info?(obj: unknown, message?: string): void;
  warn?(obj: unknown, message?: string): void;
  error?(obj: unknown, message?: string): void;
}

export interface AgentRuntimeWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  leaseTtlMs?: number;
  maxConcurrentJobs?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
  candidateScanLimit?: number;
  eventBus?: CoreEventBus;
  logger?: AgentRuntimeWorkerLogger;
  /** 可注入的后台 Agent handler 集合，默认装配 ProjectDigestAgent。 */
  handlers?: BackgroundAgentHandler[];
  /** 可注入的 session_state_proposal sink；第一批默认不配置。 */
  sessionStateProposalSink?: SessionStateProposalSink;
}

export class AgentRuntimeWorker {
  private readonly runtimeWorker: RuntimeWorker;

  constructor(db: AppDb, options: AgentRuntimeWorkerOptions = {}) {
    const catalog = createAgentRuntimeJobCatalog();
    const executor = new BackgroundAgentExecutor(
      options.handlers ?? [new ProjectDigestAgent()],
    );

    const processors = createAgentRuntimeJobProcessorRegistry({
      executor,
      createDispatcher: (tx: DbExecutor) => {
        // commit 在 better-sqlite3 同步事务回调内执行；DerivedOutputService /
        // ProjectInboxService 内部的 create 会在同一连接上以 savepoint 嵌套，
        // 与外层 commit 事务保持原子。这里把 sink 绑定到事务执行器tx。
       const derivedOutput: DerivedOutputSink = new DerivedOutputService(tx as unknown as AppDb);
        const projectInbox: ProjectInboxSink = new ProjectInboxService(tx as unknown as AppDb);
        return new AgentOutputDispatcher({
          derivedOutput,
          projectInbox,
          ...(options.sessionStateProposalSink
            ? { sessionStateProposal: options.sessionStateProposalSink }
            : {}),
        });
      },
    });

    this.runtimeWorker = new RuntimeWorker(db, catalog, processors, {
      workerId: options.workerId ?? `agent-runtime-worker-${nanoid(8)}`,
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

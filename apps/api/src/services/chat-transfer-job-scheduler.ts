import type { CoreEventBus } from "@tavern/core";
import { z } from "zod";

import type { DbExecutor } from "../db/client.js";
import { RuntimeJobScheduler } from "./runtime-job-scheduler.js";
import {
  CHAT_TRANSFER_FORMATS,
  CHAT_TRANSFER_JOB_KINDS,
  CHAT_TRANSFER_JOB_PHASES,
  CHAT_TRANSFER_JOB_STATUSES,
  CHAT_TRANSFER_RUNTIME_SCOPE_TYPE,
  CHAT_TRANSFER_RUNTIME_JOB_TYPES,
  type ChatTransferFormat,
  type ChatTransferJobKind,
  type ChatTransferJobPhase,
  type ChatTransferJobStatus,
  type ExportChatJobRequest,
  type ExportChatJobResult,
  type ImportChatJobRequest,
  type ImportChatJobResult,
  buildChatTransferScopeKey,
  createChatTransferJobId,
  createChatTransferRuntimeJobCatalog,
  exportChatRequestSchema,
  exportChatResultSchema,
  importChatRequestSchema,
  importChatResultSchema,
} from "./chat-transfer-runtime-job-definitions.js";

export {
  CHAT_TRANSFER_FORMATS,
  CHAT_TRANSFER_JOB_KINDS,
  CHAT_TRANSFER_JOB_PHASES,
  CHAT_TRANSFER_JOB_STATUSES,
} from "./chat-transfer-runtime-job-definitions.js";
export type {
  ChatTransferFormat,
  ChatTransferJobKind,
  ChatTransferJobPhase,
  ChatTransferJobStatus,
  ExportChatJobRequest,
  ExportChatJobResult,
  ImportChatJobRequest,
  ImportChatJobResult,
};
export type ChatTransferJobResult = ImportChatJobResult | ExportChatJobResult;

export interface EnqueueImportChatJobInput extends ImportChatJobRequest {
  accountId: string;
  createdAt: number;
  maxAttempts?: number;
  jobId?: string;
}

export interface EnqueueExportChatJobInput extends ExportChatJobRequest {
  accountId: string;
  createdAt: number;
  maxAttempts?: number;
  jobId?: string;
}

export interface EnqueueChatTransferJobResult {
  jobId: string;
  created: boolean;
}

export class ChatTransferJobPayloadParseError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly jobKind: ChatTransferJobKind,
    public readonly issues: string[],
  ) {
    super(`Invalid payload for chat transfer job '${jobId}' (${jobKind}): ${issues.join("; ")}`);
    this.name = "ChatTransferJobPayloadParseError";
  }
}

function parsePayload<T>(
  job: { id: string; requestJson: string },
  jobKind: ChatTransferJobKind,
  schema: z.ZodTypeAny,
): T {
  let payload: unknown;
  try {
    payload = JSON.parse(job.requestJson);
  } catch (error) {
    throw new ChatTransferJobPayloadParseError(
      job.id,
      jobKind,
      [error instanceof Error ? error.message : String(error)],
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ChatTransferJobPayloadParseError(
      job.id,
      jobKind,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`),
    );
  }

  return parsed.data as T;
}

export interface ChatTransferJobSchedulerOptions {
  catalog?: ReturnType<typeof createChatTransferRuntimeJobCatalog>;
  eventBus?: CoreEventBus;
}

export class ChatTransferJobScheduler {
  private readonly runtimeScheduler: RuntimeJobScheduler;

  constructor(options: ChatTransferJobSchedulerOptions = {}) {
    this.runtimeScheduler = new RuntimeJobScheduler(
      options.catalog ?? createChatTransferRuntimeJobCatalog(),
      { eventBus: options.eventBus },
    );
  }

  createJobId(jobKind: ChatTransferJobKind): string {
    return createChatTransferJobId(jobKind);
  }

  enqueueImportChat(
    tx: DbExecutor,
    input: EnqueueImportChatJobInput,
  ): EnqueueChatTransferJobResult {
    const payload = importChatRequestSchema.parse(input);
    const jobId = input.jobId ?? this.createJobId("import_chat");
    const result = this.runtimeScheduler.enqueue(tx, {
      jobId,
      jobType: CHAT_TRANSFER_RUNTIME_JOB_TYPES.import_chat,
      accountId: input.accountId,
      scopeType: CHAT_TRANSFER_RUNTIME_SCOPE_TYPE,
      scopeKey: buildChatTransferScopeKey({
        jobKind: "import_chat",
        jobId,
      }),
      payload,
      availableAt: input.createdAt,
      maxAttempts: input.maxAttempts,
      phase: "queued",
      progressCurrent: 0,
      progressTotal: 4,
      progressMessage: "queued",
      state: {
        format: payload.detectedFormat ?? null,
      },
    });

    return {
      jobId: result.jobId,
      created: result.created,
    };
  }

  enqueueExportChat(
    tx: DbExecutor,
    input: EnqueueExportChatJobInput,
  ): EnqueueChatTransferJobResult {
    const payload = exportChatRequestSchema.parse(input);
    const jobId = input.jobId ?? this.createJobId("export_chat");
    const result = this.runtimeScheduler.enqueue(tx, {
      jobId,
      jobType: CHAT_TRANSFER_RUNTIME_JOB_TYPES.export_chat,
      accountId: input.accountId,
      scopeType: CHAT_TRANSFER_RUNTIME_SCOPE_TYPE,
      scopeKey: buildChatTransferScopeKey({
        jobKind: "export_chat",
        jobId,
        sessionId: payload.sessionId,
      }),
      sessionId: payload.sessionId,
      payload,
      availableAt: input.createdAt,
      maxAttempts: input.maxAttempts,
      phase: "queued",
      progressCurrent: 0,
      progressTotal: 4,
      progressMessage: "queued",
      state: {
        format: payload.format,
      },
    });

    return {
      jobId: result.jobId,
      created: result.created,
    };
  }

  parseImportChatRequest(job: { id: string; requestJson: string }): ImportChatJobRequest {
    return parsePayload<ImportChatJobRequest>(job, "import_chat", importChatRequestSchema);
  }

  parseExportChatRequest(job: { id: string; requestJson: string }): ExportChatJobRequest {
    return parsePayload<ExportChatJobRequest>(job, "export_chat", exportChatRequestSchema);
  }

  parseImportChatResult(resultJson: string): ImportChatJobResult {
    return importChatResultSchema.parse(JSON.parse(resultJson));
  }

  parseExportChatResult(resultJson: string): ExportChatJobResult {
    return exportChatResultSchema.parse(JSON.parse(resultJson));
  }

  parseResult(resultJson: string, format: ChatTransferFormat | null | undefined): ChatTransferJobResult {
    const parsed = JSON.parse(resultJson) as Record<string, unknown>;

    if (format === "st_jsonl" || typeof parsed.fileName === "string" || typeof parsed.byteLength === "number") {
      return exportChatResultSchema.parse(parsed);
    }

    return importChatResultSchema.parse(parsed);
  }
}

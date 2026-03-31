import { nanoid } from "nanoid";
import { z } from "zod";

import type { RuntimeJobDefinition } from "./runtime-job-types.js";
import { RuntimeJobCatalog } from "./runtime-job-catalog.js";

export const CHAT_TRANSFER_RUNTIME_SCOPE_TYPE = "chat_transfer";

export const CHAT_TRANSFER_JOB_KINDS = ["import_chat", "export_chat"] as const;
export const CHAT_TRANSFER_JOB_STATUSES = [
  "pending",
  "leased",
  "running",
  "retry_waiting",
  "succeeded",
  "dead_letter",
  "cancelled",
] as const;
export const CHAT_TRANSFER_JOB_PHASES = [
  "queued",
  "parsing",
  "normalizing",
  "publishing",
  "snapshotting",
  "rendering",
  "writing_artifact",
  "finalizing",
  "completed",
] as const;
export const CHAT_TRANSFER_FORMATS = ["thchat", "sillytavern_jsonl", "st_jsonl"] as const;

export const CHAT_TRANSFER_RUNTIME_JOB_TYPES = {
  import_chat: "chat_transfer.import_chat",
  export_chat: "chat_transfer.export_chat",
} as const;

export type ChatTransferJobKind = (typeof CHAT_TRANSFER_JOB_KINDS)[number];
export type ChatTransferJobStatus = (typeof CHAT_TRANSFER_JOB_STATUSES)[number];
export type ChatTransferJobPhase = (typeof CHAT_TRANSFER_JOB_PHASES)[number];
export type ChatTransferFormat = (typeof CHAT_TRANSFER_FORMATS)[number];
export type ChatTransferRuntimeJobType = (typeof CHAT_TRANSFER_RUNTIME_JOB_TYPES)[ChatTransferJobKind];

const chatTransferFormatSchema = z.enum(CHAT_TRANSFER_FORMATS);
const importChatDetectedFormatSchema = z.enum(["thchat", "sillytavern_jsonl"]);
const exportChatFormatSchema = z.enum(["thchat", "st_jsonl"]);

export const importChatRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  characterId: z.string().min(1).nullable().optional(),
  characterVersionId: z.string().min(1).nullable().optional(),
  characterSnapshotJson: z.string().min(1).nullable().optional(),
  inputArtifactPath: z.string().min(1),
  inputBytes: z.number().int().nonnegative(),
  detectedFormat: importChatDetectedFormatSchema.optional(),
});

export const exportChatRequestSchema = z.object({
  sessionId: z.string().min(1),
  format: exportChatFormatSchema,
  includeVariables: z.boolean().default(true),
  includeMemories: z.boolean().default(true),
});

export const importChatResultSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string(),
  floorCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  swipeCount: z.number().int().nonnegative().optional(),
  skippedLines: z.number().int().nonnegative(),
  importSource: z.enum(["thchat", "sillytavern_jsonl"]),
  format: z.enum(["thchat", "sillytavern_jsonl"]),
  pageCount: z.number().int().nonnegative().optional(),
  variableCount: z.number().int().nonnegative().optional(),
  memoryItemCount: z.number().int().nonnegative().optional(),
  memoryEdgeCount: z.number().int().nonnegative().optional(),
});

export const exportChatResultSchema = z.object({
  sessionId: z.string().min(1),
  format: exportChatFormatSchema,
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  messageCount: z.number().int().nonnegative(),
  byteLength: z.number().int().nonnegative(),
});

export type ImportChatJobRequest = z.infer<typeof importChatRequestSchema>;
export type ExportChatJobRequest = z.infer<typeof exportChatRequestSchema>;
export type ImportChatJobResult = z.infer<typeof importChatResultSchema>;
export type ExportChatJobResult = z.infer<typeof exportChatResultSchema>;
export type ChatTransferJobResult = ImportChatJobResult | ExportChatJobResult;

export interface ChatTransferRuntimeJobState {
  format?: ChatTransferFormat | null;
  normalizedArtifactPath?: string | null;
  outputArtifactPath?: string | null;
  outputExpiresAt?: number | null;
  resultSessionId?: string | null;
}

export function toChatTransferRuntimeJobType(jobKind: ChatTransferJobKind): ChatTransferRuntimeJobType {
  return CHAT_TRANSFER_RUNTIME_JOB_TYPES[jobKind];
}

export function fromChatTransferRuntimeJobType(jobType: string): ChatTransferJobKind {
  switch (jobType) {
    case CHAT_TRANSFER_RUNTIME_JOB_TYPES.import_chat:
      return "import_chat";
    case CHAT_TRANSFER_RUNTIME_JOB_TYPES.export_chat:
      return "export_chat";
    default:
      throw new Error(`Unknown chat transfer runtime job type: ${jobType}`);
  }
}

export function createChatTransferJobId(jobKind: ChatTransferJobKind): string {
  return `chat-transfer-job:${jobKind}:${nanoid(12)}`;
}

export function buildChatTransferScopeKey(input: {
  jobKind: ChatTransferJobKind;
  jobId: string;
  sessionId?: string | null;
}): string {
  if (input.jobKind === "export_chat") {
    return `session:${input.sessionId ?? input.jobId}`;
  }

  return `job:${input.jobId}`;
}

export function readChatTransferJobState(value: string | null | undefined): ChatTransferRuntimeJobState {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      format: typeof parsed.format === "string"
        && (CHAT_TRANSFER_FORMATS as readonly string[]).includes(parsed.format)
        ? parsed.format as ChatTransferFormat
        : null,
      normalizedArtifactPath: typeof parsed.normalizedArtifactPath === "string" ? parsed.normalizedArtifactPath : null,
      outputArtifactPath: typeof parsed.outputArtifactPath === "string" ? parsed.outputArtifactPath : null,
      outputExpiresAt: typeof parsed.outputExpiresAt === "number" ? parsed.outputExpiresAt : null,
      resultSessionId: typeof parsed.resultSessionId === "string" ? parsed.resultSessionId : null,
    };
  } catch {
    return {};
  }
}

function createDefinition<TPayload>(definition: RuntimeJobDefinition<TPayload>): RuntimeJobDefinition<TPayload> {
  return definition;
}

export function createChatTransferRuntimeJobCatalog(): RuntimeJobCatalog {
  const catalog = new RuntimeJobCatalog();

  catalog.register(createDefinition<ImportChatJobRequest>({
    jobType: CHAT_TRANSFER_RUNTIME_JOB_TYPES.import_chat,
    payloadSchema: importChatRequestSchema,
    defaultMaxAttempts: 5,
    initialPhase: "queued",
    createJobId({ requestedId }) {
      return requestedId && requestedId.trim().length > 0
        ? requestedId
        : createChatTransferJobId("import_chat");
    },
  }));

  catalog.register(createDefinition<ExportChatJobRequest>({
    jobType: CHAT_TRANSFER_RUNTIME_JOB_TYPES.export_chat,
    payloadSchema: exportChatRequestSchema,
    defaultMaxAttempts: 5,
    initialPhase: "queued",
    createJobId({ requestedId }) {
      return requestedId && requestedId.trim().length > 0
        ? requestedId
        : createChatTransferJobId("export_chat");
    },
  }));

  return catalog;
}

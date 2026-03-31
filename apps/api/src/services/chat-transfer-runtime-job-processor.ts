import { Buffer } from "node:buffer";

import { VariableServiceError } from "./variable-service-errors.js";
import { RuntimeJobFatalError } from "./runtime-job-errors.js";
import { RuntimeJobProcessorRegistry } from "./runtime-job-processor-registry.js";
import type { RuntimeJobProcessor } from "./runtime-job-types.js";
import { LocalChatTransferArtifactStore } from "./chat-transfer-artifacts.js";
import {
  ChatImportManifestError,
  buildChatImportManifest,
} from "./chat-import-manifest.js";
import {
  publishChatImportManifestInTransaction,
} from "./chat-import-publisher.js";
import {
  captureSessionExportSnapshot,
  type SessionExportSnapshot,
} from "./chat-export-snapshot.js";
import {
  iterExportSnapshotToStJsonlLines,
  renderExportSnapshotToThChat,
  suggestChatExportBasename,
} from "./chat-export-renderer.js";
import {
  CHAT_TRANSFER_RUNTIME_JOB_TYPES,
  type ExportChatJobRequest,
  type ExportChatJobResult,
  type ImportChatJobRequest,
  type ImportChatJobResult,
} from "./chat-transfer-runtime-job-definitions.js";

export interface ChatTransferRuntimeProcessorDependencies {
  artifactDir: string;
  exportArtifactTtlMs?: number;
}

function sanitizeDownloadFilename(name: string, maxLen = 100): string {
  const cleaned = name
    .replace(/[/\\?*<>|":]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLen) || "export";
}

export function createChatTransferRuntimeJobProcessorRegistry(
  deps: ChatTransferRuntimeProcessorDependencies,
): RuntimeJobProcessorRegistry {
  const registry = new RuntimeJobProcessorRegistry();
  const artifactStore = new LocalChatTransferArtifactStore(deps.artifactDir);

  const importProcessor: RuntimeJobProcessor<
    ImportChatJobRequest,
    {
      manifest: ReturnType<typeof buildChatImportManifest>;
      normalizedArtifactPath: string;
    },
    ImportChatJobResult
  > = {
    async prepare({ job, payload, updateProgress }) {
      try {
        await updateProgress({
          phase: "parsing",
          progressCurrent: 1,
          progressTotal: 4,
          progressMessage: "parsing input",
          state: {
            format: payload.detectedFormat ?? null,
          },
          stateMode: "merge",
        });

        const rawData = await artifactStore.readText(payload.inputArtifactPath);
        const manifest = buildChatImportManifest(rawData, {
          accountId: job.accountId,
          title: payload.title,
          characterBinding: {
            characterId: payload.characterId ?? null,
            characterVersionId: payload.characterVersionId ?? null,
            characterSnapshotJson: payload.characterSnapshotJson ?? null,
          },
          importedAt: job.createdAt,
        });

        const normalizedArtifactPath = artifactStore.buildJobArtifactPath(job.id, "normalized-manifest.json");
        await updateProgress({
          phase: "normalizing",
          progressCurrent: 2,
          progressTotal: 4,
          progressMessage: "writing normalized manifest",
          state: {
            format: manifest.format,
            normalizedArtifactPath,
          },
          stateMode: "merge",
        });
        await artifactStore.writeJson(normalizedArtifactPath, manifest);

        await updateProgress({
          phase: "publishing",
          progressCurrent: 3,
          progressTotal: 4,
          progressMessage: "publishing imported session",
          state: {
            format: manifest.format,
            normalizedArtifactPath,
          },
          stateMode: "merge",
        });

        return {
          manifest,
          normalizedArtifactPath,
        };
      } catch (error) {
        if (error instanceof ChatImportManifestError) {
          throw new RuntimeJobFatalError(error.message, { cause: error });
        }

        throw error;
      }
    },
    commit({ tx, prepared }) {
      try {
        const result = publishChatImportManifestInTransaction(tx, prepared.manifest);
        return {
          phase: "completed",
          result,
          progressCurrent: 4,
          progressTotal: 4,
          progressMessage: "completed",
          state: {
            format: prepared.manifest.format,
            normalizedArtifactPath: prepared.normalizedArtifactPath,
            resultSessionId: result.sessionId,
          },
          stateMode: "merge",
          scopeMutation: "none",
        };
      } catch (error) {
        if (error instanceof VariableServiceError) {
          throw new RuntimeJobFatalError(error.message, { cause: error });
        }
        throw error;
      }
    },
  };

  const exportProcessor: RuntimeJobProcessor<
    ExportChatJobRequest,
    {
      normalizedArtifactPath: string;
      outputArtifactPath: string;
      outputExpiresAt: number | null;
      result: ExportChatJobResult;
    },
    ExportChatJobResult
  > = {
    async prepare({ db, job, payload, updateProgress }) {
      let snapshot: SessionExportSnapshot;
      try {
        await updateProgress({
          phase: "snapshotting",
          progressCurrent: 1,
          progressTotal: 4,
          progressMessage: "capturing export snapshot",
          state: {
            format: payload.format,
          },
          stateMode: "merge",
        });

        snapshot = captureSessionExportSnapshot(db, payload.sessionId, {
          accountId: job.accountId,
          includeVariables: payload.includeVariables,
          includeMemories: payload.includeMemories,
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Session not found:")) {
          throw new RuntimeJobFatalError(error.message, { cause: error });
        }
        throw error;
      }

      const normalizedArtifactPath = artifactStore.buildJobArtifactPath(job.id, "snapshot.json");
      await artifactStore.writeJson(normalizedArtifactPath, snapshot);

      await updateProgress({
        phase: "rendering",
        progressCurrent: 2,
        progressTotal: 4,
        progressMessage: "rendering export artifact",
        state: {
          format: payload.format,
          normalizedArtifactPath,
        },
        stateMode: "merge",
      });

      const ext = payload.format === "thchat" ? "thchat" : "jsonl";
      const fileName = `${sanitizeDownloadFilename(suggestChatExportBasename(snapshot, payload.format))}.${ext}`;
      const outputArtifactPath = artifactStore.buildJobArtifactPath(job.id, `output.${ext}`);

      let byteLength = 0;
      let contentType = "application/json; charset=utf-8";

      await updateProgress({
        phase: "writing_artifact",
        progressCurrent: 3,
        progressTotal: 4,
        progressMessage: "writing export artifact",
        state: {
          format: payload.format,
          normalizedArtifactPath,
          outputArtifactPath,
        },
        stateMode: "merge",
      });

      if (payload.format === "thchat") {
        const document = renderExportSnapshotToThChat(snapshot);
        const serialized = JSON.stringify(document, null, 2);
        byteLength = Buffer.byteLength(serialized, "utf-8");
        contentType = "application/json; charset=utf-8";
        await artifactStore.writeText(outputArtifactPath, serialized);
      } else {
        contentType = "application/x-ndjson; charset=utf-8";
        const lines = iterExportSnapshotToStJsonlLines(snapshot);
        let lineIndex = 0;
        async function* countBytes(): AsyncIterable<string> {
          for (const line of lines) {
            byteLength += Buffer.byteLength(lineIndex === 0 ? line : `\n${line}`, "utf-8");
            lineIndex += 1;
            yield line;
          }
        }
        await artifactStore.writeLines(outputArtifactPath, countBytes());
      }

      const outputExpiresAt = deps.exportArtifactTtlMs !== undefined
        ? Date.now() + deps.exportArtifactTtlMs
        : null;
      const result: ExportChatJobResult = {
        sessionId: payload.sessionId,
        format: payload.format,
        fileName,
        contentType,
        messageCount: snapshot.messageCount,
        byteLength,
      };

      return {
        normalizedArtifactPath,
        outputArtifactPath,
        outputExpiresAt,
        result,
      };
    },
    commit({ prepared }) {
      return {
        phase: "completed",
        result: prepared.result,
        progressCurrent: 4,
        progressTotal: 4,
        progressMessage: "completed",
        state: {
          format: prepared.result.format,
          normalizedArtifactPath: prepared.normalizedArtifactPath,
          outputArtifactPath: prepared.outputArtifactPath,
          outputExpiresAt: prepared.outputExpiresAt,
          resultSessionId: prepared.result.sessionId,
        },
        stateMode: "merge",
        scopeMutation: "none",
      };
    },
  };

  registry.register(CHAT_TRANSFER_RUNTIME_JOB_TYPES.import_chat, importProcessor);
  registry.register(CHAT_TRANSFER_RUNTIME_JOB_TYPES.export_chat, exportProcessor);

  return registry;
}

import { Buffer } from "node:buffer";

import { RuntimeJobProcessorRegistry } from "./runtime-job-processor-registry.js";
import type { RuntimeJobProcessor } from "./runtime-job-types.js";
import { LocalBackupArtifactStore } from "./backup-artifacts.js";
import {
  BACKUP_RUNTIME_JOB_TYPES,
  type ExportCoreAssetsJobRequest,
  type ExportCoreAssetsJobResult,
  type RestoreCoreAssetsJobRequest,
  type RestoreCoreAssetsJobResult,
} from "./backup-runtime-job-definitions.js";
import { CoreAssetBackupError, toCoreAssetBackupRuntimeFatalError } from "./core-asset-backup-parser.js";
import { renderCoreAssetBackup, suggestCoreAssetBackupFileName } from "./core-asset-backup-renderer.js";
import { prepareCoreAssetBackupRestore, restoreCoreAssetBackupInTransaction } from "./core-asset-backup-restore.js";
import { captureCoreAssetBackupSnapshot } from "./core-asset-backup-snapshot.js";

export interface BackupRuntimeProcessorDependencies {
  artifactDir: string;
  exportArtifactTtlMs?: number;
  appVersion?: string;
}

export function createBackupRuntimeJobProcessorRegistry(
  deps: BackupRuntimeProcessorDependencies,
): RuntimeJobProcessorRegistry {
  const registry = new RuntimeJobProcessorRegistry();
  const artifactStore = new LocalBackupArtifactStore(deps.artifactDir);

  const exportProcessor: RuntimeJobProcessor<
    ExportCoreAssetsJobRequest,
    {
      normalizedArtifactPath: string;
      outputArtifactPath: string;
      outputExpiresAt: number | null;
      fileName: string;
      result: ExportCoreAssetsJobResult;
    },
    ExportCoreAssetsJobResult
  > = {
    async prepare({ db, job, payload, updateProgress }) {
      try {
        await updateProgress({
          phase: "collecting",
          progressCurrent: 1,
          progressTotal: 4,
          progressMessage: "collecting backup snapshot",
        });

        const snapshot = captureCoreAssetBackupSnapshot(db, {
          accountId: job.accountId,
          domains: payload.domains,
          sessionIds: payload.sessionIds,
          characterIds: payload.characterIds,
          worldbookIds: payload.worldbookIds,
          includeLinkedAssets: payload.includeLinkedAssets,
          includeSecrets: payload.includeSecrets,
        });
        const normalizedArtifactPath = artifactStore.buildJobArtifactPath(job.id, "snapshot.json");
        await artifactStore.writeJson(normalizedArtifactPath, snapshot);

        await updateProgress({
          phase: "serializing",
          progressCurrent: 2,
          progressTotal: 4,
          progressMessage: "serializing backup document",
          state: {
            includedDomains: snapshot.includedDomains,
          },
          stateMode: "merge",
        });

        const file = renderCoreAssetBackup(snapshot, { appVersion: deps.appVersion });
        const serialized = JSON.stringify(file, null, 2);
        const byteLength = Buffer.byteLength(serialized, "utf-8");
        const outputArtifactPath = artifactStore.buildJobArtifactPath(job.id, "output.thbackup");
        const fileName = suggestCoreAssetBackupFileName({
          createdAt: snapshot.createdAt,
          isFullExport: snapshot.isFullExport,
        });

        await updateProgress({
          phase: "writing_artifact",
          progressCurrent: 3,
          progressTotal: 4,
          progressMessage: "writing backup artifact",
          state: {
            fileName,
            includedDomains: snapshot.includedDomains,
            outputArtifactPath,
          },
          stateMode: "merge",
        });

        await artifactStore.writeText(outputArtifactPath, serialized);
        const outputExpiresAt = deps.exportArtifactTtlMs !== undefined
          ? Date.now() + deps.exportArtifactTtlMs
          : null;
        const result: ExportCoreAssetsJobResult = {
          fileName,
          contentType: "application/json; charset=utf-8",
          byteLength,
          includedDomains: snapshot.includedDomains,
          counts: snapshot.counts,
        };

        return {
          normalizedArtifactPath,
          outputArtifactPath,
          outputExpiresAt,
          fileName,
          result,
        };
      } catch (error) {
        if (error instanceof CoreAssetBackupError) {
          throw toCoreAssetBackupRuntimeFatalError(error);
        }
        throw error;
      }
    },
    commit({ prepared }) {
      return {
        phase: "completed",
        result: prepared.result,
        progressCurrent: 4,
        progressTotal: 4,
        progressMessage: "completed",
        state: {
          outputArtifactPath: prepared.outputArtifactPath,
          outputExpiresAt: prepared.outputExpiresAt,
          fileName: prepared.fileName,
          includedDomains: prepared.result.includedDomains,
        },
        stateMode: "merge",
        scopeMutation: "none",
      };
    },
  };

  const restoreProcessor: RuntimeJobProcessor<
    RestoreCoreAssetsJobRequest,
    ReturnType<typeof prepareCoreAssetBackupRestore>,
    RestoreCoreAssetsJobResult
  > = {
    async prepare({ db, job, payload, updateProgress }) {
      try {
        await updateProgress({
          phase: "validating",
          progressCurrent: 1,
          progressTotal: 6,
          progressMessage: "validating backup document",
          state: {
            restoreMode: payload.mode,
          },
          stateMode: "merge",
        });

        const prepared = prepareCoreAssetBackupRestore(db, {
          accountId: job.accountId,
          data: payload.data,
          mode: payload.mode,
        });

        await updateProgress({
          phase: "remapping",
          progressCurrent: 2,
          progressTotal: 6,
          progressMessage: "building restore plan",
          state: {
            restoreMode: prepared.restoreMode,
            includedDomains: prepared.analysis.file.included_domains,
          },
          stateMode: "merge",
        });

        await updateProgress({
          phase: "publishing",
          progressCurrent: 3,
          progressTotal: 6,
          progressMessage: "publishing restored resources",
          state: {
            restoreMode: prepared.restoreMode,
          },
          stateMode: "merge",
        });

        return prepared;
      } catch (error) {
        if (error instanceof CoreAssetBackupError) {
          throw toCoreAssetBackupRuntimeFatalError(error);
        }
        throw error;
      }
    },
    commit({ tx, prepared }) {
      try {
        const result = restoreCoreAssetBackupInTransaction(tx, prepared);
        return {
          phase: "completed",
          result,
          progressCurrent: 6,
          progressTotal: 6,
          progressMessage: "completed",
          state: {
            restoreMode: prepared.restoreMode,
          },
          stateMode: "merge",
          scopeMutation: "none",
        };
      } catch (error) {
        if (error instanceof CoreAssetBackupError) {
          throw toCoreAssetBackupRuntimeFatalError(error);
        }
        throw error;
      }
    },
  };

  registry.register(BACKUP_RUNTIME_JOB_TYPES.export_core_assets, exportProcessor);
  registry.register(BACKUP_RUNTIME_JOB_TYPES.restore_core_assets, restoreProcessor);

  return registry;
}

import { nanoid } from "nanoid";
import { buildBranchMemoryScopeId, buildBranchVariableScopeId } from "@tavern/shared";
import {
  type ThBackupBranchLocalVariableProvenance,
} from "@tavern/shared/types/backup-file";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  characterVersions,
  characters,
  floors,
  memoryEdges,
  memoryItems,
  messagePages,
  messages,
  operationLogs,
  presetVersions,
  presets,
  regexProfileVersions,
  regexProfiles,
  runtimeScopeStates,
  sessions,
  vcTags,
  worldbookVersions,
  worldbookEntries,
  worldbooks,
} from "../db/schema.js";
import { stringifyJsonField } from "../lib/http.js";
import {
  backupRestoreCreatedSummarySchema,
  type RestoreCoreAssetsJobResult,
  emptyBackupRestoreCreatedSummary,
} from "./backup-runtime-job-definitions.js";
import { CoreAssetBackupError } from "./core-asset-backup-parser.js";
import {
  analyzeCoreAssetBackup,
  type CoreAssetBackupAnalysis,
} from "./core-asset-backup-preview.js";
import { BranchLocalVariableSnapshotService, type BranchLocalVariableProvenanceMap } from "./branch-local-variable-snapshot-service.js";
import { buildImportedMemoryScopeStateRowsFromResolvedData } from "./imported-memory-scope-state-builder.js";
import { SessionBranchRegistryService, type SessionBranchAssetBindingState } from "./variables/host/session-branch-registry-service.js";
import { VariableService } from "./variables/variable-service.js";

export interface CoreAssetBackupRestorePrepared {
  analysis: CoreAssetBackupAnalysis;
  restoreMode: "create_copy";
  idMap: CoreAssetBackupRestoreIdMap;
}

export interface CoreAssetBackupRestoreIdMap {
  characters: Map<string, string>;
  characterVersions: Map<string, string>;
  presets: Map<string, string>;
  presetVersions: Map<string, string>;
  worldbooks: Map<string, string>;
  worldbookVersions: Map<string, string>;
  worldbookEntries: Map<string, string>;
  regexProfiles: Map<string, string>;
  regexProfileVersions: Map<string, string>;
  sessions: Map<string, string>;
  floors: Map<string, string>;
  pages: Map<string, string>;
  messages: Map<string, string>;
  memoryItems: Map<string, string>;
  vcTags: Map<string, string>;
  operationLogs: Map<string, string>;
  operationGroups: Map<string, string>;
}

export function prepareCoreAssetBackupRestore(
  db: AppDb,
  input: { accountId: string; data: unknown; mode?: string | null },
): CoreAssetBackupRestorePrepared {
  const analysis = analyzeCoreAssetBackup(db, input);
  return {
    analysis,
    restoreMode: analysis.restoreMode,
    idMap: createRestoreIdMap(analysis.file),
  };
}

export function restoreCoreAssetBackupInTransaction(
  tx: DbExecutor,
  prepared: CoreAssetBackupRestorePrepared,
): RestoreCoreAssetsJobResult {
  const { analysis, idMap } = prepared;
  const { file, namePlan, preview } = analysis;
  const created = emptyBackupRestoreCreatedSummary();


  for (const character of file.resources.characters) {
    const newCharacterId = requireMappedId(idMap.characters, character.id, `character:${character.id}`);
    const restoredName = namePlan.characters.get(character.id) ?? character.name;
    const latestVersionNo = character.versions.reduce(
      (maxVersionNo, version) => Math.max(maxVersionNo, version.version_no),
      character.latest_version_no,
    );

    tx.insert(characters).values({
      id: newCharacterId,
      name: restoredName,
      accountId: file.source.account_id,
      source: character.source,
      status: "active",
      deletedAt: null,
      revision: 0,
      latestVersionNo,
      createdAt: character.created_at,
      updatedAt: character.updated_at,
    }).run();
    created.characters += 1;

    for (const version of character.versions) {
      const newVersionId = requireMappedId(
        idMap.characterVersions,
        version.id,
        `character_version:${version.id}`,
      );
      tx.insert(characterVersions).values({
        id: newVersionId,
        characterId: newCharacterId,
        versionNo: version.version_no,
        dataJson: JSON.stringify(version.data),
        contentHash: version.content_hash,
        sourceArtifactJson: version.source_artifact?.data === undefined
          ? null
          : JSON.stringify(version.source_artifact.data),
        sourceArtifactFormat: version.source_artifact?.format ?? null,
        sourceArtifactDigest: version.source_artifact?.digest ?? null,
        createdAt: version.created_at,
      }).run();
      created.character_versions += 1;
    }
  }

  for (const preset of file.resources.presets) {
    const newPresetId = requireMappedId(idMap.presets, preset.id, `preset:${preset.id}`);
    const restoredName = namePlan.presets.get(preset.id) ?? preset.name;
    tx.insert(presets).values({
      id: newPresetId,
      name: restoredName,
      source: preset.source,
      accountId: file.source.account_id,
      dataJson: JSON.stringify(preset.data ?? {}),
      version: preset.version,
      createdAt: preset.created_at,
      updatedAt: preset.updated_at,
    }).run();
    created.presets += 1;

    for (const version of preset.versions) {
      const newVersionId = requireMappedId(
        idMap.presetVersions,
        version.id,
        `preset_version:${version.id}`,
      );
      tx.insert(presetVersions).values({
        id: newVersionId,
        presetId: newPresetId,
        parentVersionId: version.parent_version_id_ref
          ? requireMappedId(
              idMap.presetVersions,
              version.parent_version_id_ref,
              `preset_version:${version.parent_version_id_ref}`,
            )
          : null,
        versionNo: version.version_no,
        dataJson: JSON.stringify(version.data),
        contentHash: version.content_hash,
        createdByOperationId: resolvePromptAssetCreatedByOperationId(file, idMap, version.created_by_operation_id ?? null),
        createdAt: version.created_at,
      }).run();
      created.preset_versions += 1;
    }
  }

  for (const worldbook of file.resources.worldbooks) {
    const newWorldbookId = requireMappedId(idMap.worldbooks, worldbook.id, `worldbook:${worldbook.id}`);
    const restoredName = namePlan.worldbooks.get(worldbook.id) ?? worldbook.name;
    tx.insert(worldbooks).values({
      id: newWorldbookId,
      name: restoredName,
      source: worldbook.source,
      accountId: file.source.account_id,
      dataJson: JSON.stringify(worldbook.data ?? {}),
      version: worldbook.version,
      createdAt: worldbook.created_at,
      updatedAt: worldbook.updated_at,
    }).run();
    created.worldbooks += 1;

    for (const version of worldbook.versions) {
      const newVersionId = requireMappedId(
        idMap.worldbookVersions,
        version.id,
        `worldbook_version:${version.id}`,
      );
      tx.insert(worldbookVersions).values({
        id: newVersionId,
        worldbookId: newWorldbookId,
        parentVersionId: version.parent_version_id_ref
          ? requireMappedId(
              idMap.worldbookVersions,
              version.parent_version_id_ref,
              `worldbook_version:${version.parent_version_id_ref}`,
            )
          : null,
        versionNo: version.version_no,
        dataJson: JSON.stringify(version.data),
        contentHash: version.content_hash,
        createdByOperationId: resolvePromptAssetCreatedByOperationId(file, idMap, version.created_by_operation_id ?? null),
        createdAt: version.created_at,
      }).run();
      created.worldbook_versions += 1;
    }

    for (const entry of worldbook.entries) {
      const newEntryId = requireMappedId(idMap.worldbookEntries, entry.id, `worldbook_entry:${entry.id}`);
      tx.insert(worldbookEntries).values({
        id: newEntryId,
        worldbookId: newWorldbookId,
        uid: entry.uid,
        comment: entry.comment,
        content: entry.content,
        keysJson: JSON.stringify(entry.keys),
        keysSecondaryJson: JSON.stringify(entry.keys_secondary),
        selective: entry.selective,
        selectiveLogic: entry.selective_logic,
        constant: entry.constant,
        position: entry.position,
        order: entry.order,
        depth: entry.depth,
        role: entry.role,
        disable: entry.disable,
        scanDepth: entry.scan_depth ?? null,
        caseSensitive: entry.case_sensitive ?? null,
        matchWholeWords: entry.match_whole_words ?? null,
        excludeRecursion: entry.exclude_recursion,
        preventRecursion: entry.prevent_recursion,
        delayUntilRecursion: entry.delay_until_recursion ?? null,
        outletName: entry.outlet_name,
        extraJson: JSON.stringify(entry.extra ?? {}),
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
      }).run();
      created.worldbook_entries += 1;
    }
  }

  for (const profile of file.resources.regex_profiles) {
    const newProfileId = requireMappedId(idMap.regexProfiles, profile.id, `regex_profile:${profile.id}`);
    const restoredName = namePlan.regexProfiles.get(profile.id) ?? profile.name;
    tx.insert(regexProfiles).values({
      id: newProfileId,
      name: restoredName,
      source: profile.source,
      accountId: file.source.account_id,
      dataJson: JSON.stringify(profile.data ?? {}),
      version: profile.version,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    }).run();
    created.regex_profiles += 1;

    for (const version of profile.versions) {
      const newVersionId = requireMappedId(
        idMap.regexProfileVersions,
        version.id,
        `regex_profile_version:${version.id}`,
      );
      tx.insert(regexProfileVersions).values({
        id: newVersionId,
        regexProfileId: newProfileId,
        parentVersionId: version.parent_version_id_ref
          ? requireMappedId(
              idMap.regexProfileVersions,
              version.parent_version_id_ref,
              `regex_profile_version:${version.parent_version_id_ref}`,
            )
          : null,
        versionNo: version.version_no,
        dataJson: JSON.stringify(version.data),
        contentHash: version.content_hash,
        createdByOperationId: resolvePromptAssetCreatedByOperationId(file, idMap, version.created_by_operation_id ?? null),
        createdAt: version.created_at,
      }).run();
      created.regex_profile_versions += 1;
    }
  }

  for (const session of file.sessions) {
    const newSessionId = requireMappedId(idMap.sessions, session.id, `session:${session.id}`);
    const restoredTitle = namePlan.sessions.get(session.id) ?? session.title ?? null;
    const characterId = session.character_binding.character_id_ref
      ? requireOptionalMappedId(idMap.characters, session.character_binding.character_id_ref, `character:${session.character_binding.character_id_ref}`)
      : null;
    const characterVersionId = session.character_binding.character_version_id_ref
      ? requireOptionalMappedId(
          idMap.characterVersions,
          session.character_binding.character_version_id_ref,
          `character_version:${session.character_binding.character_version_id_ref}`,
        )
      : null;
    const presetId = session.profile_binding.preset_id_ref
      ? requireOptionalMappedId(
          idMap.presets,
          session.profile_binding.preset_id_ref,
          `preset:${session.profile_binding.preset_id_ref}`,
        )
      : null;
    const presetVersionId = session.profile_binding.preset_version_id_ref
      ? requireOptionalMappedId(
          idMap.presetVersions,
          session.profile_binding.preset_version_id_ref,
          `preset_version:${session.profile_binding.preset_version_id_ref}`,
        )
      : null;
    const worldbookProfileId = session.profile_binding.worldbook_id_ref
      ? requireOptionalMappedId(
          idMap.worldbooks,
          session.profile_binding.worldbook_id_ref,
          `worldbook:${session.profile_binding.worldbook_id_ref}`,
        )
      : null;
    const worldbookVersionId = session.profile_binding.worldbook_version_id_ref
      ? requireOptionalMappedId(
          idMap.worldbookVersions,
          session.profile_binding.worldbook_version_id_ref,
          `worldbook_version:${session.profile_binding.worldbook_version_id_ref}`,
        )
      : null;
    const regexProfileId = session.profile_binding.regex_profile_id_ref
      ? requireOptionalMappedId(
          idMap.regexProfiles,
          session.profile_binding.regex_profile_id_ref,
          `regex_profile:${session.profile_binding.regex_profile_id_ref}`,
        )
      : null;
    const regexProfileVersionId = session.profile_binding.regex_profile_version_id_ref
      ? requireOptionalMappedId(
          idMap.regexProfileVersions,
          session.profile_binding.regex_profile_version_id_ref,
          `regex_profile_version:${session.profile_binding.regex_profile_version_id_ref}`,
        )
      : null;

    tx.insert(sessions).values({
      id: newSessionId,
      title: restoredTitle,
      status: session.status,
      accountId: file.source.account_id,
      characterId,
      characterVersionId,
      characterSnapshotJson: session.character_binding.snapshot == null
        ? null
        : stringifyJsonField(session.character_binding.snapshot),
      userId: null,
      userSnapshotJson: session.user_binding.snapshot == null
        ? null
        : stringifyJsonField(session.user_binding.snapshot),
      characterSyncPolicy: session.character_binding.character_sync_policy,
      presetId,
      regexProfileId,
      worldbookProfileId,
      deepBinding: session.profile_binding.deep_binding ?? false,
      presetVersionId,
      worldbookVersionId,
      regexProfileVersionId,
      promptMode: session.prompt_mode ?? null,
      modelProvider: session.model_provider ?? null,
      modelName: session.model_name ?? null,
      modelParamsJson: session.model_params == null ? null : stringifyJsonField(session.model_params),
      metadataJson: session.metadata == null ? null : stringifyJsonField(session.metadata),
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    }).run();
    created.sessions += 1;

    for (const floor of session.floors) {
      const newFloorId = requireMappedId(idMap.floors, floor.id, `floor:${floor.id}`);
      tx.insert(floors).values({
        id: newFloorId,
        sessionId: newSessionId,
        floorNo: floor.floor_no,
        branchId: floor.branch_id,
        parentFloorId: floor.parent_floor_id_ref
          ? requireMappedId(idMap.floors, floor.parent_floor_id_ref, `floor:${floor.parent_floor_id_ref}`)
          : null,
        supersededAt: floor.superseded_at ?? null,
        supersededByFloorId: floor.superseded_by_floor_id_ref
          ? requireMappedId(idMap.floors, floor.superseded_by_floor_id_ref, `floor:${floor.superseded_by_floor_id_ref}`)
          : null,
        state: floor.state,
        metadataJson: floor.metadata == null ? null : stringifyJsonField(floor.metadata),
        tokenIn: floor.token_in,
        tokenOut: floor.token_out,
        createdAt: floor.created_at,
        updatedAt: floor.updated_at,
      }).run();
      created.floors += 1;
    }

    const branchRegistry = new SessionBranchRegistryService(tx);
    const branchRows = session.branches.some((branch) => branch.branch_id === "main")
      ? session.branches
      : [{
          branch_id: "main",
          source_floor_id_ref: null,
          source_branch_id: null,
          asset_binding: null,
          created_at: session.created_at,
          updated_at: session.updated_at,
        }, ...session.branches];
    const seenBranchIds = new Set<string>();
    for (const branch of branchRows) {
      if (seenBranchIds.has(branch.branch_id)) {
        continue;
      }
      seenBranchIds.add(branch.branch_id);
      branchRegistry.ensure({
        accountId: file.source.account_id,
        sessionId: newSessionId,
        branchId: branch.branch_id,
        sourceFloorId: branch.source_floor_id_ref
          ? requireMappedId(idMap.floors, branch.source_floor_id_ref, `floor:${branch.source_floor_id_ref}`)
          : null,
        sourceBranchId: branch.source_branch_id ?? null,
        assetBinding: translateBackupBranchAssetBinding(branch.asset_binding, idMap),
        createdAt: branch.created_at,
        updatedAt: branch.updated_at,
      });
      created.session_branches += 1;
    }

    for (const floor of session.floors) {
      const newFloorId = requireMappedId(idMap.floors, floor.id, `floor:${floor.id}`);
      for (const page of floor.pages) {
        const newPageId = requireMappedId(idMap.pages, page.id, `page:${page.id}`);
        tx.insert(messagePages).values({
          id: newPageId,
          floorId: newFloorId,
          pageNo: page.page_no,
          pageKind: page.page_kind,
          isActive: page.is_active,
          version: page.version,
          checksum: page.checksum,
          createdAt: page.created_at,
          updatedAt: page.updated_at,
        }).run();
        created.pages += 1;

        for (const message of page.messages) {
          const newMessageId = requireMappedId(idMap.messages, message.id, `message:${message.id}`);
          tx.insert(messages).values({
            id: newMessageId,
            pageId: newPageId,
            seq: message.seq,
            role: message.role,
            content: message.content,
            contentFormat: message.content_format,
            tokenCount: message.token_count,
            isHidden: message.is_hidden,
            source: message.source,
            createdAt: message.created_at,
          }).run();
          created.messages += 1;
        }
      }
    }

    if (session.variables.length > 0) {
      new VariableService(tx).restoreMany({
        accountId: file.source.account_id,
        items: session.variables.map((variable) => ({
          scope: variable.scope,
          scopeId: resolveBackupVariableScopeId({
            scope: variable.scope,
            scopeIdRef: variable.scope_id_ref,
            sessionId: newSessionId,
            idMap,
          }),
          key: variable.key,
          value: variable.value,
          updatedAt: variable.updated_at,
        })),
      });
      created.variables += session.variables.length;
    }

    if (session.branch_local_variable_snapshots.length > 0) {
      const snapshotService = new BranchLocalVariableSnapshotService(tx);
      for (const snapshot of session.branch_local_variable_snapshots) {
        const newFloorId = requireMappedId(idMap.floors, snapshot.floor_id_ref, `floor:${snapshot.floor_id_ref}`);
        snapshotService.restoreSnapshot({
          accountId: file.source.account_id,
          floorId: newFloorId,
          sessionId: newSessionId,
          branchId: snapshot.branch_id,
          createdAt: snapshot.created_at,
          values: snapshot.values,
          schemaVersion: snapshot.snapshot_version,
          provenance: translateBackupSnapshotProvenance({
            sessionId: newSessionId,
            branchId: snapshot.branch_id,
            provenance: snapshot.provenance ?? {},
            idMap,
          }),
        });
        created.branch_local_variable_snapshots += 1;
      }
    }

    const resolvedMemoryItems: Array<{
      scope: "chat" | "branch" | "floor";
      scopeId: string;
      type: "fact" | "summary" | "open_loop";
      summaryTier: "micro" | "macro" | null;
      status: "active" | "deprecated";
    }> = [];

    for (const item of session.memories.items) {
      const newMemoryItemId = requireMappedId(idMap.memoryItems, item.id, `memory_item:${item.id}`);
      const scopeId = resolveBackupMemoryScopeId({
        scope: item.scope,
        scopeIdRef: item.scope_id_ref,
        sessionId: newSessionId,
        idMap,
      });
      tx.insert(memoryItems).values({
        id: newMemoryItemId,
        scope: item.scope,
        scopeId,
        type: item.type,
        summaryTier: item.type === "summary" ? item.summary_tier ?? null : null,
        contentJson: JSON.stringify(item.content),
        importance: item.importance,
        confidence: item.confidence,
        sourceFloorId: item.source_floor_id_ref
          ? requireMappedId(idMap.floors, item.source_floor_id_ref, `floor:${item.source_floor_id_ref}`)
          : null,
        sourceMessageId: item.source_message_id_ref
          ? requireMappedId(idMap.messages, item.source_message_id_ref, `message:${item.source_message_id_ref}`)
          : null,
        accountId: file.source.account_id,
        status: item.status,
        lifecycleStatus: item.lifecycle_status ?? (item.status === "deprecated" ? "deprecated" : "active"),
        sourceJobId: item.source_job_id ?? null,
        tokenCountEstimate: item.token_count_estimate ?? null,
        lastUsedAt: item.last_used_at ?? null,
        coverageStartFloorNo: item.type === "summary" ? item.coverage_start_floor_no ?? null : null,
        coverageEndFloorNo: item.type === "summary" ? item.coverage_end_floor_no ?? null : null,
        derivedFromCount: item.type === "summary" ? item.derived_from_count ?? null : null,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }).run();
      resolvedMemoryItems.push({
        scope: item.scope,
        scopeId,
        type: item.type,
        summaryTier: item.type === "summary" ? item.summary_tier ?? null : null,
        status: item.status,
      });
      created.memory_items += 1;
    }

    for (const edge of session.memories.edges) {
      const fromId = requireMappedId(idMap.memoryItems, edge.from_id_ref, `memory_item:${edge.from_id_ref}`);
      const toId = requireMappedId(idMap.memoryItems, edge.to_id_ref, `memory_item:${edge.to_id_ref}`);
      tx.insert(memoryEdges).values({
        id: nanoid(),
        fromId,
        toId,
        relation: edge.relation,
        accountId: file.source.account_id,
        createdAt: edge.created_at,
      }).run();
      created.memory_edges += 1;
    }

    const runtimeScopeStateRows = buildImportedMemoryScopeStateRowsFromResolvedData({
      accountId: file.source.account_id,
      sessionId: newSessionId,
      now: session.updated_at,
      floors: session.floors.map((floor) => ({
        id: requireMappedId(idMap.floors, floor.id, `floor:${floor.id}`),
        branchId: floor.branch_id,
        floorNo: floor.floor_no,
      })),
      items: resolvedMemoryItems,
    });
    if (runtimeScopeStateRows.length > 0) {
      tx.insert(runtimeScopeStates).values(runtimeScopeStateRows).run();
      created.runtime_scope_states += runtimeScopeStateRows.length;
    }
  }

  for (const log of file.vc.operation_logs) {
    const newOperationLogId = requireMappedId(idMap.operationLogs, log.id, `operation_log:${log.id}`);
    const newOperationGroupId = log.operation_group_id
      ? requireMappedId(idMap.operationGroups, log.operation_group_id, `operation_group:${log.operation_group_id}`)
      : null;

    tx.insert(operationLogs).values({
      id: newOperationLogId,
      accountId: file.source.account_id,
      actorType: log.actor_type,
      actorId: log.actor_id ?? null,
      operationGroupId: newOperationGroupId,
      requestId: null,
      sourceType: log.source_type,
      action: log.action,
      status: log.status,
      sessionId: log.session_id_ref
        ? requireMappedId(idMap.sessions, log.session_id_ref, `session:${log.session_id_ref}`)
        : null,
      branchId: log.branch_id ?? null,
      floorId: log.floor_id_ref
        ? requireMappedId(idMap.floors, log.floor_id_ref, `floor:${log.floor_id_ref}`)
        : null,
      runId: null,
      targetType: log.target_type,
      targetId: resolveBackupOperationLogTargetId(log, idMap),
      beforeRefJson: stringifyJsonField(log.before_ref ?? null),
      afterRefJson: stringifyJsonField(log.after_ref ?? null),
      diffJson: stringifyJsonField(log.diff ?? null),
      metadataJson: stringifyJsonField(mergeRestoredOperationLogMetadata(log.metadata ?? null, log)),
      createdAt: log.created_at,
    }).run();
    created.operation_logs += 1;
  }

  for (const tag of file.vc.tags) {
    const newTagId = requireMappedId(idMap.vcTags, tag.id, `vc_tag:${tag.id}`);
    const restoredName = namePlan.vcTags.get(tag.id) ?? tag.name;
    tx.insert(vcTags).values({
      id: newTagId,
      accountId: file.source.account_id,
      name: restoredName,
      targetType: tag.target_type,
      targetId: resolveBackupVcTagTargetId(tag, idMap),
      sessionId: tag.session_id_ref
        ? requireMappedId(idMap.sessions, tag.session_id_ref, `session:${tag.session_id_ref}`)
        : null,
      metadataJson: tag.metadata == null ? null : stringifyJsonField(tag.metadata),
      createdByOperationId: resolveBackupCreatedByOperationId(idMap, tag.created_by_operation_id_ref ?? null),
      createdAt: tag.created_at,
    }).run();
    created.vc_tags += 1;
  }

  return {
    mode: prepared.restoreMode,
    created: backupRestoreCreatedSummarySchema.parse(created),
    renamed_resources: namePlan.renamedResources,
    dropped_bindings: preview.dropped_bindings,
    warnings: preview.warnings,
  };
}

function createRestoreIdMap(file: CoreAssetBackupAnalysis["file"]): CoreAssetBackupRestoreIdMap {
  return {
    characters: new Map(file.resources.characters.map((character) => [character.id, nanoid()])),
    characterVersions: new Map(
      file.resources.characters.flatMap((character) => character.versions.map((version) => [version.id, nanoid()] as const)),
    ),
    presets: new Map(file.resources.presets.map((preset) => [preset.id, nanoid()])),
    presetVersions: new Map(
      file.resources.presets.flatMap((preset) => preset.versions.map((version) => [version.id, nanoid()] as const)),
    ),
    worldbooks: new Map(file.resources.worldbooks.map((worldbook) => [worldbook.id, nanoid()])),
    worldbookVersions: new Map(
      file.resources.worldbooks.flatMap((worldbook) => worldbook.versions.map((version) => [version.id, nanoid()] as const)),
    ),
    worldbookEntries: new Map(
      file.resources.worldbooks.flatMap((worldbook) => worldbook.entries.map((entry) => [entry.id, nanoid()] as const)),
    ),
    regexProfiles: new Map(file.resources.regex_profiles.map((profile) => [profile.id, nanoid()])),
    regexProfileVersions: new Map(
      file.resources.regex_profiles.flatMap((profile) => profile.versions.map((version) => [version.id, nanoid()] as const)),
    ),
    sessions: new Map(file.sessions.map((session) => [session.id, nanoid()])),
    floors: new Map(file.sessions.flatMap((session) => session.floors.map((floor) => [floor.id, nanoid()] as const))),
    pages: new Map(
      file.sessions.flatMap((session) =>
        session.floors.flatMap((floor) => floor.pages.map((page) => [page.id, nanoid()] as const)),
      ),
    ),
    messages: new Map(
      file.sessions.flatMap((session) =>
        session.floors.flatMap((floor) =>
          floor.pages.flatMap((page) => page.messages.map((message) => [message.id, nanoid()] as const)),
        ),
      ),
    ),
    memoryItems: new Map(
      file.sessions.flatMap((session) => session.memories.items.map((item) => [item.id, nanoid()] as const)),
    ),
    vcTags: new Map(file.vc.tags.map((tag) => [tag.id, nanoid()])),
    operationLogs: new Map(file.vc.operation_logs.map((log) => [log.id, nanoid()])),
    operationGroups: new Map(file.vc.operation_logs
      .flatMap((log) => (log.operation_group_id ? [log.operation_group_id] : []))
      .map((operationGroupId) => [operationGroupId, nanoid()])),
  };
}

function requireMappedId(map: Map<string, string>, sourceId: string, label: string): string {
  const mapped = map.get(sourceId);
  if (!mapped) {
    throw new CoreAssetBackupError(400, "backup_invalid_reference", `Missing restore id mapping for ${label}`);
  }
  return mapped;
}

function requireOptionalMappedId(map: Map<string, string>, sourceId: string, label: string): string {
  return requireMappedId(map, sourceId, label);
}

function resolvePromptAssetCreatedByOperationId(
  file: CoreAssetBackupAnalysis["file"],
  idMap: CoreAssetBackupRestoreIdMap,
  sourceOperationId: string | null,
): string | null {
  if (!sourceOperationId) {
    return null;
  }
  return file.spec_version === "1.0.0"
    ? sourceOperationId
    : resolveBackupCreatedByOperationId(idMap, sourceOperationId);
}

function resolveBackupCreatedByOperationId(idMap: CoreAssetBackupRestoreIdMap, sourceOperationId: string | null): string | null {
  return sourceOperationId ? idMap.operationLogs.get(sourceOperationId) ?? null : null;
}

function resolveBackupVariableScopeId(input: {
  scope: "chat" | "branch" | "floor" | "page";
  scopeIdRef: string | null;
  sessionId: string;
  idMap: CoreAssetBackupRestoreIdMap;
}): string {
  if (input.scope === "chat") {
    return input.sessionId;
  }

  if (input.scope === "branch") {
    return buildBranchVariableScopeId(input.sessionId, input.scopeIdRef ?? "main");
  }

  if (input.scope === "floor") {
    if (!input.scopeIdRef) {
      throw new CoreAssetBackupError(400, "backup_invalid_reference", "Floor variable is missing floor scope ref");
    }
    return requireMappedId(input.idMap.floors, input.scopeIdRef, `floor:${input.scopeIdRef}`);
  }

  if (!input.scopeIdRef) {
    throw new CoreAssetBackupError(400, "backup_invalid_reference", "Page variable is missing page scope ref");
  }
  return requireMappedId(input.idMap.pages, input.scopeIdRef, `page:${input.scopeIdRef}`);
}

function resolveBackupMemoryScopeId(input: {
  scope: "chat" | "branch" | "floor";
  scopeIdRef: string | null;
  sessionId: string;
  idMap: CoreAssetBackupRestoreIdMap;
}): string {
  if (input.scope === "chat") {
    return input.sessionId;
  }

  if (input.scope === "branch") {
    return buildBranchMemoryScopeId(input.sessionId, input.scopeIdRef ?? "main");
  }

  if (!input.scopeIdRef) {
    throw new CoreAssetBackupError(400, "backup_invalid_reference", "Floor memory is missing floor scope ref");
  }
  return requireMappedId(input.idMap.floors, input.scopeIdRef, `floor:${input.scopeIdRef}`);
}

function translateBackupBranchAssetBinding(
  assetBinding: CoreAssetBackupAnalysis["file"]["sessions"][number]["branches"][number]["asset_binding"],
  idMap: CoreAssetBackupRestoreIdMap,
): SessionBranchAssetBindingState | null {
  if (!assetBinding) {
    return null;
  }

  return {
    deepBinding: assetBinding.deep_binding ?? false,
    presetId: assetBinding.preset_id_ref
      ? requireMappedId(idMap.presets, assetBinding.preset_id_ref, `preset:${assetBinding.preset_id_ref}`)
      : null,
    presetVersionId: assetBinding.preset_version_id_ref
      ? requireMappedId(
          idMap.presetVersions,
          assetBinding.preset_version_id_ref,
          `preset_version:${assetBinding.preset_version_id_ref}`,
        )
      : null,
    worldbookProfileId: assetBinding.worldbook_id_ref
      ? requireMappedId(idMap.worldbooks, assetBinding.worldbook_id_ref, `worldbook:${assetBinding.worldbook_id_ref}`)
      : null,
    worldbookVersionId: assetBinding.worldbook_version_id_ref
      ? requireMappedId(
          idMap.worldbookVersions,
          assetBinding.worldbook_version_id_ref,
          `worldbook_version:${assetBinding.worldbook_version_id_ref}`,
        )
      : null,
    regexProfileId: assetBinding.regex_profile_id_ref
      ? requireMappedId(
          idMap.regexProfiles,
          assetBinding.regex_profile_id_ref,
          `regex_profile:${assetBinding.regex_profile_id_ref}`,
        )
      : null,
    regexProfileVersionId: assetBinding.regex_profile_version_id_ref
      ? requireMappedId(
          idMap.regexProfileVersions,
          assetBinding.regex_profile_version_id_ref,
          `regex_profile_version:${assetBinding.regex_profile_version_id_ref}`,
        )
      : null,
  };
}

function resolveBackupVcTagTargetId(
  tag: CoreAssetBackupAnalysis["file"]["vc"]["tags"][number],
  idMap: CoreAssetBackupRestoreIdMap,
): string {
  if (tag.target_type === "floor") {
    return requireMappedId(idMap.floors, tag.target_id_ref, `floor:${tag.target_id_ref}`);
  }

  switch (tag.target_asset_kind) {
    case "character":
      return requireMappedId(idMap.characterVersions, tag.target_id_ref, `character_version:${tag.target_id_ref}`);
    case "preset":
      return requireMappedId(idMap.presetVersions, tag.target_id_ref, `preset_version:${tag.target_id_ref}`);
    case "worldbook":
      return requireMappedId(idMap.worldbookVersions, tag.target_id_ref, `worldbook_version:${tag.target_id_ref}`);
    case "regex_profile":
      return requireMappedId(
        idMap.regexProfileVersions,
        tag.target_id_ref,
        `regex_profile_version:${tag.target_id_ref}`,
      );
    default:
      throw new CoreAssetBackupError(
        400,
        "backup_invalid_reference",
        `Missing target_asset_kind for asset version tag ${tag.id}`,
      );
  }
}

function resolveBackupOperationLogTargetId(
  log: CoreAssetBackupAnalysis["file"]["vc"]["operation_logs"][number],
  idMap: CoreAssetBackupRestoreIdMap,
): string | null {
  if (!log.target_id_ref) {
    return null;
  }

  switch (log.target_type) {
    case "session":
      return idMap.sessions.get(log.target_id_ref) ?? null;
    case "floor":
      return idMap.floors.get(log.target_id_ref) ?? null;
    case "vc_tag":
      return idMap.vcTags.get(log.target_id_ref) ?? null;
    case "asset_version":
      return resolveBackupAssetVersionTargetId(log.target_id_ref, idMap);
    case "character":
      return idMap.characters.get(log.target_id_ref) ?? null;
    case "character_version":
      return idMap.characterVersions.get(log.target_id_ref) ?? null;
    case "preset":
      return idMap.presets.get(log.target_id_ref) ?? null;
    case "preset_version":
      return idMap.presetVersions.get(log.target_id_ref) ?? null;
    case "worldbook":
      return idMap.worldbooks.get(log.target_id_ref) ?? null;
    case "worldbook_version":
      return idMap.worldbookVersions.get(log.target_id_ref) ?? null;
    case "regex_profile":
      return idMap.regexProfiles.get(log.target_id_ref) ?? null;
    case "regex_profile_version":
      return idMap.regexProfileVersions.get(log.target_id_ref) ?? null;
    default:
      return log.target_id_ref;
  }
}

function resolveBackupAssetVersionTargetId(sourceId: string, idMap: CoreAssetBackupRestoreIdMap): string | null {
  return idMap.characterVersions.get(sourceId)
    ?? idMap.presetVersions.get(sourceId)
    ?? idMap.worldbookVersions.get(sourceId)
    ?? idMap.regexProfileVersions.get(sourceId)
    ?? null;
}

function mergeRestoredOperationLogMetadata(
  metadata: unknown,
  log: CoreAssetBackupAnalysis["file"]["vc"]["operation_logs"][number],
): unknown {
  const restoreSource = {
    operation_log_id: log.id,
    operation_group_id: log.operation_group_id ?? null,
    request_id: log.request_id ?? null,
    run_id: log.run_id ?? null,
  };

  if (isPlainRecord(metadata)) {
    const restoreRecord = isPlainRecord(metadata.restore)
      ? metadata.restore
      : {};
    return {
      ...metadata,
      restore: {
        ...restoreRecord,
        source: restoreSource,
      },
    };
  }

  if (metadata == null) {
    return {
      restore: {
        source: restoreSource,
      },
    };
  }

  return {
    value: metadata,
    restore: {
      source: restoreSource,
    },
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function translateBackupSnapshotProvenance(input: {
  sessionId: string;
  branchId: string;
  provenance: Record<string, ThBackupBranchLocalVariableProvenance>;
  idMap: CoreAssetBackupRestoreIdMap;
}): BranchLocalVariableProvenanceMap {
  const translated: BranchLocalVariableProvenanceMap = {};
  for (const [key, provenance] of Object.entries(input.provenance)) {
    translated[key] = {
      sourceScope: provenance.source_scope,
      sourceScopeId: resolveBackupProvenanceScopeId({
        sourceScope: provenance.source_scope,
        scopeIdRef: provenance.source_scope_id_ref ?? null,
        sessionId: input.sessionId,
        branchId: input.branchId,
        idMap: input.idMap,
      }),
      ...(provenance.source_variable_id ? { sourceVariableId: provenance.source_variable_id } : {}),
      ...(typeof provenance.source_updated_at === "number" ? { sourceUpdatedAt: provenance.source_updated_at } : {}),
      ...(provenance.inherited_from_floor_id_ref
        ? { inheritedFromFloorId: requireMappedId(input.idMap.floors, provenance.inherited_from_floor_id_ref, `floor:${provenance.inherited_from_floor_id_ref}`) }
        : {}),
      ...(provenance.inherited_from_branch_id ? { inheritedFromBranchId: provenance.inherited_from_branch_id } : {}),
      originKind: provenance.origin_kind,
    };
  }
  return translated;
}

function resolveBackupProvenanceScopeId(input: {
  sourceScope: ThBackupBranchLocalVariableProvenance["source_scope"];
  scopeIdRef: string | null;
  sessionId: string;
  branchId: string;
  idMap: CoreAssetBackupRestoreIdMap;
}): string {
  if (input.sourceScope === "chat") {
    return input.scopeIdRef ?? input.sessionId;
  }

  if (input.sourceScope === "branch") {
    return buildBranchVariableScopeId(input.sessionId, input.scopeIdRef ?? input.branchId);
  }

  if (input.sourceScope === "global") {
    return input.scopeIdRef ?? "global";
  }

  if (input.sourceScope === "floor") {
    if (!input.scopeIdRef) {
      throw new CoreAssetBackupError(400, "backup_invalid_reference", "Floor provenance is missing scope ref");
    }
    return requireMappedId(input.idMap.floors, input.scopeIdRef, `floor:${input.scopeIdRef}`);
  }

  if (!input.scopeIdRef) {
    throw new CoreAssetBackupError(400, "backup_invalid_reference", "Page provenance is missing scope ref");
  }
  return requireMappedId(input.idMap.pages, input.scopeIdRef, `page:${input.scopeIdRef}`);
}

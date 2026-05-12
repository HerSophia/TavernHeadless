import { and, asc, eq, inArray, or, type SQL } from "drizzle-orm";
import {
  parseBranchMemoryScopeId,
  parseBranchVariableScopeId,
} from "@tavern/shared";
import {
  type ThBackupBranchLocalVariableProvenance,
  type ThBackupBranchLocalVariableSnapshot,
  type ThBackupCharacter,
  type ThBackupDomain,
  type ThBackupMemoryEdge,
  type ThBackupMemoryItem,
  type ThBackupOperationLog,
  type ThBackupPreset,
  type ThBackupRegexProfile,
  type ThBackupSession,
  type ThBackupVariable,
  type ThBackupVc,
  type ThBackupVcAssetKind,
  type ThBackupVcTag,
  type ThBackupWorldbook,
} from "@tavern/shared/types/backup-file";

import type { AppDb } from "../db/client.js";
import {
  characterVersions,
  characters,
  operationLogs,
  presetVersions,
  presets,
  regexProfileVersions,
  regexProfiles,
  sessions,
  sessionBranches,
  vcTags,
  worldbookVersions,
  worldbookEntries,
  worldbooks,
} from "../db/schema.js";
import { parseJsonField } from "../lib/http.js";
import {
  emptyBackupCountSummary,
  type BackupCountSummary,
  type BackupOperationLogIncludeMode,
} from "./backup-runtime-job-definitions.js";
import { captureSessionExportSnapshot } from "./chat-export-snapshot.js";
import { CoreAssetBackupError } from "./core-asset-backup-parser.js";

export interface CoreAssetBackupExportSelection {
  accountId: string;
  domains?: ThBackupDomain[];
  sessionIds?: string[];
  characterIds?: string[];
  presetIds?: string[];
  worldbookIds?: string[];
  regexProfileIds?: string[];
  includeLinkedAssets?: boolean;
  includeVcTags?: boolean;
  includeOperationLogs?: BackupOperationLogIncludeMode;
  includeSecrets?: boolean;
}

export interface CoreAssetBackupSnapshot {
  createdAt: number;
  source: {
    accountId: string;
    appVersion?: string;
  };
  includedDomains: ThBackupDomain[];
  resources: {
    characters: ThBackupCharacter[];
    presets: ThBackupPreset[];
    worldbooks: ThBackupWorldbook[];
    regexProfiles: ThBackupRegexProfile[];
  };
  sessions: ThBackupSession[];
  vc: ThBackupVc;
  counts: BackupCountSummary;
  isFullExport: boolean;
}

const BACKUP_DOMAIN_ORDER: readonly ThBackupDomain[] = ["characters", "presets", "worldbooks", "regex_profiles", "sessions"];

type SessionBranchRow = typeof sessionBranches.$inferSelect;
type OperationLogRow = typeof operationLogs.$inferSelect;

type BackupVcTagExportItem = {
  tag: ThBackupVcTag;
  sourceOperationId: string | null;
};

export function captureCoreAssetBackupSnapshot(
  db: AppDb,
  input: CoreAssetBackupExportSelection,
): CoreAssetBackupSnapshot {
  if (input.includeSecrets === true) {
    throw new CoreAssetBackupError(400, "backup_secrets_unsupported", "Backup secrets are not supported in v1");
  }

  const accountId = input.accountId;
  const sessionIds = normalizeIdList(input.sessionIds);
  const characterIds = normalizeIdList(input.characterIds);
  const presetIds = normalizeIdList(input.presetIds);
  const worldbookIds = normalizeIdList(input.worldbookIds);
  const regexProfileIds = normalizeIdList(input.regexProfileIds);
  const hasAnySelection = sessionIds.length > 0
    || characterIds.length > 0
    || presetIds.length > 0
    || worldbookIds.length > 0
    || regexProfileIds.length > 0;
  const requestedDomains = normalizeDomains(input.domains, hasAnySelection);
  const requestedDomainSet = new Set<ThBackupDomain>(requestedDomains);

  if (sessionIds.length > 0) {
    requestedDomainSet.add("sessions");
  }
  if (characterIds.length > 0) {
    requestedDomainSet.add("characters");
  }
  if (presetIds.length > 0) {
    requestedDomainSet.add("presets");
  }
  if (worldbookIds.length > 0) {
    requestedDomainSet.add("worldbooks");
  }
  if (regexProfileIds.length > 0) {
    requestedDomainSet.add("regex_profiles");
  }

  const isFullExport = !hasAnySelection && requestedDomainSet.size === BACKUP_DOMAIN_ORDER.length;

  const selectedSessions = sessionIds.length > 0
    ? db
        .select()
        .from(sessions)
        .where(and(eq(sessions.accountId, accountId), inArray(sessions.id, sessionIds)))
        .orderBy(asc(sessions.createdAt), asc(sessions.updatedAt))
        .all()
    : !hasAnySelection && requestedDomainSet.has("sessions")
      ? db
          .select()
          .from(sessions)
          .where(eq(sessions.accountId, accountId))
          .orderBy(asc(sessions.createdAt), asc(sessions.updatedAt))
          .all()
      : [];
  assertSelectionExists(sessionIds, selectedSessions.map((row) => row.id), "session_ids");

  const selectedCharacters = characterIds.length > 0
    ? db
        .select()
        .from(characters)
        .where(and(eq(characters.accountId, accountId), inArray(characters.id, characterIds)))
        .orderBy(asc(characters.createdAt), asc(characters.updatedAt))
        .all()
    : !hasAnySelection && requestedDomainSet.has("characters")
      ? db
          .select()
          .from(characters)
          .where(eq(characters.accountId, accountId))
          .orderBy(asc(characters.createdAt), asc(characters.updatedAt))
          .all()
      : [];
  assertSelectionExists(characterIds, selectedCharacters.map((row) => row.id), "character_ids");

  const selectedPresets = presetIds.length > 0
    ? db
        .select()
        .from(presets)
        .where(and(eq(presets.accountId, accountId), inArray(presets.id, presetIds)))
        .orderBy(asc(presets.createdAt), asc(presets.updatedAt))
        .all()
    : !hasAnySelection && requestedDomainSet.has("presets")
      ? db
          .select()
          .from(presets)
          .where(eq(presets.accountId, accountId))
          .orderBy(asc(presets.createdAt), asc(presets.updatedAt))
          .all()
      : [];
  assertSelectionExists(presetIds, selectedPresets.map((row) => row.id), "preset_ids");

  const selectedWorldbooks = worldbookIds.length > 0
    ? db
        .select()
        .from(worldbooks)
        .where(and(eq(worldbooks.accountId, accountId), inArray(worldbooks.id, worldbookIds)))
        .orderBy(asc(worldbooks.createdAt), asc(worldbooks.updatedAt))
        .all()
    : !hasAnySelection && requestedDomainSet.has("worldbooks")
      ? db
          .select()
          .from(worldbooks)
          .where(eq(worldbooks.accountId, accountId))
          .orderBy(asc(worldbooks.createdAt), asc(worldbooks.updatedAt))
          .all()
      : [];
  assertSelectionExists(worldbookIds, selectedWorldbooks.map((row) => row.id), "worldbook_ids");

  const selectedRegexProfiles = regexProfileIds.length > 0
    ? db
        .select()
        .from(regexProfiles)
        .where(and(eq(regexProfiles.accountId, accountId), inArray(regexProfiles.id, regexProfileIds)))
        .orderBy(asc(regexProfiles.createdAt), asc(regexProfiles.updatedAt))
        .all()
    : !hasAnySelection && requestedDomainSet.has("regex_profiles")
      ? db
          .select()
          .from(regexProfiles)
          .where(eq(regexProfiles.accountId, accountId))
          .orderBy(asc(regexProfiles.createdAt), asc(regexProfiles.updatedAt))
          .all()
      : [];
  assertSelectionExists(regexProfileIds, selectedRegexProfiles.map((row) => row.id), "regex_profile_ids");

  const selectedCharacterIds = new Set(selectedCharacters.map((row) => row.id));
  const selectedPresetIds = new Set(selectedPresets.map((row) => row.id));
  const selectedWorldbookIds = new Set(selectedWorldbooks.map((row) => row.id));
  const selectedRegexProfileIds = new Set(selectedRegexProfiles.map((row) => row.id));
  const includeLinkedAssets = input.includeLinkedAssets ?? true;
  const includeVcTags = input.includeVcTags ?? true;
  const includeOperationLogs = input.includeOperationLogs ?? "none";

  const selectedSessionIdListForBranches = selectedSessions.map((row) => row.id);
  const selectedSessionBranchRows = selectedSessionIdListForBranches.length > 0
    ? db
        .select()
        .from(sessionBranches)
        .where(and(eq(sessionBranches.accountId, accountId), inArray(sessionBranches.sessionId, selectedSessionIdListForBranches)))
        .orderBy(asc(sessionBranches.sessionId), asc(sessionBranches.createdAt), asc(sessionBranches.updatedAt), asc(sessionBranches.branchId))
        .all()
    : [];
  const branchRowsBySession = groupRowsBy(selectedSessionBranchRows, (row) => row.sessionId);

  if (selectedSessions.length > 0) {
    for (const session of selectedSessions) {
      if (!includeLinkedAssets) {
        if (session.characterId && !selectedCharacterIds.has(session.characterId)) {
          throw new CoreAssetBackupError(
            400,
            "backup_incomplete_selection",
            `Selected sessions require character ${session.characterId} to be included`,
          );
        }
        if (session.presetId && !selectedPresetIds.has(session.presetId)) {
          throw new CoreAssetBackupError(
            400,
            "backup_incomplete_selection",
            `Selected sessions require preset ${session.presetId} to be included`,
          );
        }
        if (session.worldbookProfileId && !selectedWorldbookIds.has(session.worldbookProfileId)) {
          throw new CoreAssetBackupError(
            400,
            "backup_incomplete_selection",
            `Selected sessions require worldbook ${session.worldbookProfileId} to be included`,
          );
        }
        if (session.regexProfileId && !selectedRegexProfileIds.has(session.regexProfileId)) {
          throw new CoreAssetBackupError(
            400,
            "backup_incomplete_selection",
            `Selected sessions require regex profile ${session.regexProfileId} to be included`,
          );
        }
        continue;
      }

      if (session.characterId && !selectedCharacterIds.has(session.characterId)) {
        const linkedCharacter = db
          .select()
          .from(characters)
          .where(and(eq(characters.accountId, accountId), eq(characters.id, session.characterId)))
          .limit(1)
          .all()[0];
        if (!linkedCharacter) {
          throw new CoreAssetBackupError(
            400,
            "backup_incomplete_selection",
            `Session ${session.id} references missing character ${session.characterId}`,
          );
        }
        selectedCharacters.push(linkedCharacter);
        selectedCharacterIds.add(linkedCharacter.id);
      }

      if (session.presetId && !selectedPresetIds.has(session.presetId)) {
        const linkedPreset = db
          .select()
          .from(presets)
          .where(and(eq(presets.accountId, accountId), eq(presets.id, session.presetId)))
          .limit(1)
          .all()[0];
        if (!linkedPreset) {
          throw new CoreAssetBackupError(
            400,
            "backup_incomplete_selection",
            `Session ${session.id} references missing preset ${session.presetId}`,
          );
        }
        selectedPresets.push(linkedPreset);
        selectedPresetIds.add(linkedPreset.id);
      }

      if (session.worldbookProfileId && !selectedWorldbookIds.has(session.worldbookProfileId)) {
        const linkedWorldbook = db
          .select()
          .from(worldbooks)
          .where(and(eq(worldbooks.accountId, accountId), eq(worldbooks.id, session.worldbookProfileId)))
          .limit(1)
          .all()[0];
        if (!linkedWorldbook) {
          throw new CoreAssetBackupError(
            400,
            "backup_incomplete_selection",
            `Session ${session.id} references missing worldbook ${session.worldbookProfileId}`,
          );
        }
        selectedWorldbooks.push(linkedWorldbook);
        selectedWorldbookIds.add(linkedWorldbook.id);
      }

      if (session.regexProfileId && !selectedRegexProfileIds.has(session.regexProfileId)) {
        const linkedRegexProfile = db
          .select()
          .from(regexProfiles)
          .where(and(eq(regexProfiles.accountId, accountId), eq(regexProfiles.id, session.regexProfileId)))
          .limit(1)
          .all()[0];
        if (!linkedRegexProfile) {
          throw new CoreAssetBackupError(
            400,
            "backup_incomplete_selection",
            `Session ${session.id} references missing regex profile ${session.regexProfileId}`,
          );
        }
        selectedRegexProfiles.push(linkedRegexProfile);
        selectedRegexProfileIds.add(linkedRegexProfile.id);
      }
    }
  }

  if (selectedSessionBranchRows.length > 0) {
    for (const branch of selectedSessionBranchRows) {
      if (!hasBranchAssetBinding(branch)) {
        continue;
      }

      if (!includeLinkedAssets) {
        assertSelectedBranchAssetBindingIds(
          branch,
          selectedPresetIds,
          selectedWorldbookIds,
          selectedRegexProfileIds,
        );
        continue;
      }

      ensureSelectedPromptAssetRowsForBranchBinding(
        db,
        accountId,
        branch,
        selectedPresets,
        selectedPresetIds,
        selectedWorldbooks,
        selectedWorldbookIds,
        selectedRegexProfiles,
        selectedRegexProfileIds,
      );
    }
  }

  const includedDomainSet = new Set<ThBackupDomain>();
  if (!hasAnySelection) {
    for (const domain of requestedDomainSet) {
      includedDomainSet.add(domain);
    }
  } else {
    if (selectedSessions.length > 0 || sessionIds.length > 0) {
      includedDomainSet.add("sessions");
    }
    if (selectedCharacters.length > 0 || characterIds.length > 0) {
      includedDomainSet.add("characters");
    }
    if (selectedPresets.length > 0 || presetIds.length > 0) {
      includedDomainSet.add("presets");
    }
    if (selectedWorldbooks.length > 0 || worldbookIds.length > 0) {
      includedDomainSet.add("worldbooks");
    }
    if (selectedRegexProfiles.length > 0 || regexProfileIds.length > 0) {
      includedDomainSet.add("regex_profiles");
    }
  }

  const selectedCharacterIdList = selectedCharacters.map((row) => row.id);
  const selectedPresetIdList = selectedPresets.map((row) => row.id);
  const selectedWorldbookIdList = selectedWorldbooks.map((row) => row.id);
  const selectedRegexProfileIdList = selectedRegexProfiles.map((row) => row.id);

  const versionRows = selectedCharacterIdList.length > 0
    ? db
        .select()
        .from(characterVersions)
        .where(inArray(characterVersions.characterId, selectedCharacterIdList))
        .orderBy(asc(characterVersions.characterId), asc(characterVersions.versionNo), asc(characterVersions.createdAt))
        .all()
    : [];
  const versionsByCharacter = new Map<string, typeof versionRows>();
  const versionIdSet = new Set<string>();
  for (const row of versionRows) {
    versionIdSet.add(row.id);
    const list = versionsByCharacter.get(row.characterId);
    if (list) {
      list.push(row);
    } else {
      versionsByCharacter.set(row.characterId, [row]);
    }
  }

  const presetVersionRows = selectedPresetIdList.length > 0
    ? db
        .select()
        .from(presetVersions)
        .where(inArray(presetVersions.presetId, selectedPresetIdList))
        .orderBy(asc(presetVersions.presetId), asc(presetVersions.versionNo), asc(presetVersions.createdAt))
        .all()
    : [];
  const presetVersionsByPreset = new Map<string, typeof presetVersionRows>();
  const presetVersionIdSet = new Set<string>();
  const presetVersionToPresetId = new Map<string, string>();
  for (const row of presetVersionRows) {
    presetVersionIdSet.add(row.id);
    presetVersionToPresetId.set(row.id, row.presetId);
    const list = presetVersionsByPreset.get(row.presetId);
    if (list) {
      list.push(row);
    } else {
      presetVersionsByPreset.set(row.presetId, [row]);
    }
  }

  const worldbookVersionRows = selectedWorldbookIdList.length > 0
    ? db
        .select()
        .from(worldbookVersions)
        .where(inArray(worldbookVersions.worldbookId, selectedWorldbookIdList))
        .orderBy(asc(worldbookVersions.worldbookId), asc(worldbookVersions.versionNo), asc(worldbookVersions.createdAt))
        .all()
    : [];
  const worldbookVersionsByWorldbook = new Map<string, typeof worldbookVersionRows>();
  const worldbookVersionIdSet = new Set<string>();
  const worldbookVersionToWorldbookId = new Map<string, string>();
  for (const row of worldbookVersionRows) {
    worldbookVersionIdSet.add(row.id);
    worldbookVersionToWorldbookId.set(row.id, row.worldbookId);
    const list = worldbookVersionsByWorldbook.get(row.worldbookId);
    if (list) {
      list.push(row);
    } else {
      worldbookVersionsByWorldbook.set(row.worldbookId, [row]);
    }
  }

  const regexProfileVersionRows = selectedRegexProfileIdList.length > 0
    ? db
        .select()
        .from(regexProfileVersions)
        .where(inArray(regexProfileVersions.regexProfileId, selectedRegexProfileIdList))
        .orderBy(asc(regexProfileVersions.regexProfileId), asc(regexProfileVersions.versionNo), asc(regexProfileVersions.createdAt))
        .all()
    : [];
  const regexProfileVersionsByProfile = new Map<string, typeof regexProfileVersionRows>();
  const regexProfileVersionIdSet = new Set<string>();
  const regexProfileVersionToProfileId = new Map<string, string>();
  for (const row of regexProfileVersionRows) {
    regexProfileVersionIdSet.add(row.id);
    regexProfileVersionToProfileId.set(row.id, row.regexProfileId);
    const list = regexProfileVersionsByProfile.get(row.regexProfileId);
    if (list) {
      list.push(row);
    } else {
      regexProfileVersionsByProfile.set(row.regexProfileId, [row]);
    }
  }

  const worldbookEntryRows = selectedWorldbookIdList.length > 0
    ? db
        .select()
        .from(worldbookEntries)
        .where(inArray(worldbookEntries.worldbookId, selectedWorldbookIdList))
        .orderBy(asc(worldbookEntries.worldbookId), asc(worldbookEntries.order), asc(worldbookEntries.uid), asc(worldbookEntries.createdAt))
        .all()
    : [];
  const entriesByWorldbook = new Map<string, typeof worldbookEntryRows>();
  for (const row of worldbookEntryRows) {
    const list = entriesByWorldbook.get(row.worldbookId);
    if (list) {
      list.push(row);
    } else {
      entriesByWorldbook.set(row.worldbookId, [row]);
    }
  }

  const characterResources = selectedCharacters.map<ThBackupCharacter>((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    latest_version_no: row.latestVersionNo,
    versions: (versionsByCharacter.get(row.id) ?? []).map((version) => ({
      id: version.id,
      version_no: version.versionNo,
      data: parseJsonField(version.dataJson),
      content_hash: version.contentHash,
      source_artifact: {
        data: parseJsonField(version.sourceArtifactJson ?? null),
        format: version.sourceArtifactFormat ?? null,
        digest: version.sourceArtifactDigest ?? null,
      },
      created_at: version.createdAt,
    })),
  }));

  const presetResources = selectedPresets.map<ThBackupPreset>((row) => ({
    id: row.id,
    name: row.name,
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    version: row.version,
    data: parseJsonField(row.dataJson),
    versions: (presetVersionsByPreset.get(row.id) ?? []).map((version) => ({
      id: version.id,
      parent_version_id_ref: version.parentVersionId ?? null,
      version_no: version.versionNo,
      data: parseJsonField(version.dataJson),
      content_hash: version.contentHash,
      created_by_operation_id: version.createdByOperationId ?? null,
      created_at: version.createdAt,
    })),
  }));

  const worldbookResources = selectedWorldbooks.map<ThBackupWorldbook>((row) => ({
    id: row.id,
    name: row.name,
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    version: row.version,
    data: parseJsonField(row.dataJson),
    entries: (entriesByWorldbook.get(row.id) ?? []).map((entry) => ({
      id: entry.id,
      uid: entry.uid,
      comment: entry.comment,
      content: entry.content,
      keys: parseStringArray(entry.keysJson),
      keys_secondary: parseStringArray(entry.keysSecondaryJson),
      selective: entry.selective,
      selective_logic: entry.selectiveLogic,
      constant: entry.constant,
      position: entry.position,
      order: entry.order,
      depth: entry.depth,
      role: entry.role,
      disable: entry.disable,
      scan_depth: entry.scanDepth,
      case_sensitive: entry.caseSensitive,
      match_whole_words: entry.matchWholeWords,
      exclude_recursion: entry.excludeRecursion,
      prevent_recursion: entry.preventRecursion,
      delay_until_recursion: entry.delayUntilRecursion,
      outlet_name: entry.outletName,
      extra: parseJsonField(entry.extraJson ?? null),
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    })),
    versions: (worldbookVersionsByWorldbook.get(row.id) ?? []).map((version) => ({
      id: version.id,
      parent_version_id_ref: version.parentVersionId ?? null,
      version_no: version.versionNo,
      data: parseJsonField(version.dataJson),
      content_hash: version.contentHash,
      created_by_operation_id: version.createdByOperationId ?? null,
      created_at: version.createdAt,
    })),
  }));

  const regexProfileResources = selectedRegexProfiles.map<ThBackupRegexProfile>((row) => ({
    id: row.id,
    name: row.name,
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    version: row.version,
    data: parseJsonField(row.dataJson),
    versions: (regexProfileVersionsByProfile.get(row.id) ?? []).map((version) => ({
      id: version.id,
      parent_version_id_ref: version.parentVersionId ?? null,
      version_no: version.versionNo,
      data: parseJsonField(version.dataJson),
      content_hash: version.contentHash,
      created_by_operation_id: version.createdByOperationId ?? null,
      created_at: version.createdAt,
    })),
  }));

  const worldbookIdSet = new Set(worldbookResources.map((row) => row.id));
  const characterIdSet = new Set(characterResources.map((row) => row.id));
  const presetIdSet = new Set(presetResources.map((row) => row.id));
  const regexProfileIdSet = new Set(regexProfileResources.map((row) => row.id));

  const sessionResources = selectedSessions.map<ThBackupSession>((sessionRow) => {
    if (sessionRow.characterId && !characterIdSet.has(sessionRow.characterId)) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session ${sessionRow.id} references character ${sessionRow.characterId} that is not present in the backup`,
      );
    }
    if (sessionRow.characterVersionId && !versionIdSet.has(sessionRow.characterVersionId)) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session ${sessionRow.id} references character version ${sessionRow.characterVersionId} that is not present in the backup`,
      );
    }
    if (sessionRow.presetId && !presetIdSet.has(sessionRow.presetId)) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session ${sessionRow.id} references preset ${sessionRow.presetId} that is not present in the backup`,
      );
    }
    if (sessionRow.presetVersionId && !presetVersionIdSet.has(sessionRow.presetVersionId)) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session ${sessionRow.id} references preset version ${sessionRow.presetVersionId} that is not present in the backup`,
      );
    }
    if (sessionRow.worldbookProfileId && !worldbookIdSet.has(sessionRow.worldbookProfileId)) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session ${sessionRow.id} references worldbook ${sessionRow.worldbookProfileId} that is not present in the backup`,
      );
    }
    if (sessionRow.worldbookVersionId && !worldbookVersionIdSet.has(sessionRow.worldbookVersionId)) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session ${sessionRow.id} references worldbook version ${sessionRow.worldbookVersionId} that is not present in the backup`,
      );
    }
    if (sessionRow.regexProfileId && !regexProfileIdSet.has(sessionRow.regexProfileId)) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session ${sessionRow.id} references regex profile ${sessionRow.regexProfileId} that is not present in the backup`,
      );
    }
    if (sessionRow.regexProfileVersionId && !regexProfileVersionIdSet.has(sessionRow.regexProfileVersionId)) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session ${sessionRow.id} references regex profile version ${sessionRow.regexProfileVersionId} that is not present in the backup`,
      );
    }

    const snapshot = captureSessionExportSnapshot(db, sessionRow.id, {
      accountId,
      includeVariables: true,
      includeMemories: true,
    });
    const branchRows = branchRowsBySession.get(sessionRow.id) ?? [];
    for (const branch of branchRows) {
      assertBranchAssetBindingInBackup({
        branch,
        presetIdSet,
        presetVersionIdSet,
        presetVersionToPresetId,
        worldbookIdSet,
        worldbookVersionIdSet,
        worldbookVersionToWorldbookId,
        regexProfileIdSet,
        regexProfileVersionIdSet,
        regexProfileVersionToProfileId,
      });
    }

    return {
      id: sessionRow.id,
      title: sessionRow.title,
      status: sessionRow.status,
      created_at: sessionRow.createdAt,
      updated_at: sessionRow.updatedAt,
      prompt_mode: sessionRow.promptMode,
      model_provider: sessionRow.modelProvider,
      model_name: sessionRow.modelName,
      model_params: parseJsonField(sessionRow.modelParamsJson ?? null),
      metadata: parseJsonField(sessionRow.metadataJson ?? null),
      character_binding: {
        character_id_ref: sessionRow.characterId ?? null,
        character_version_id_ref: sessionRow.characterVersionId ?? null,
        character_sync_policy: snapshot.characterSyncPolicy,
        snapshot: snapshot.characterSnapshot,
      },
      user_binding: {
        user_id: sessionRow.userId ?? null,
        snapshot: snapshot.userSnapshot,
      },
      profile_binding: {
        deep_binding: sessionRow.deepBinding ?? false,
        preset_id_ref: sessionRow.presetId ?? null,
        preset_version_id_ref: sessionRow.presetVersionId ?? null,
        worldbook_id_ref: sessionRow.worldbookProfileId ?? null,
        worldbook_version_id_ref: sessionRow.worldbookVersionId ?? null,
        regex_profile_id_ref: sessionRow.regexProfileId ?? null,
        regex_profile_version_id_ref: sessionRow.regexProfileVersionId ?? null,
      },
      branches: branchRows.map((branch) => ({
        branch_id: branch.branchId,
        source_floor_id_ref: branch.sourceFloorId ?? null,
        source_branch_id: branch.sourceBranchId ?? null,
        asset_binding: toBackupSessionBranchAssetBinding(branch),
        created_at: branch.createdAt,
        updated_at: branch.updatedAt,
      })),
      floors: snapshot.floors.map((floor) => ({
        id: floor.id,
        floor_no: floor.floorNo,
        branch_id: floor.branchId,
        parent_floor_id_ref: floor.parentFloorId,
        superseded_at: floor.supersededAt,
        superseded_by_floor_id_ref: floor.supersededByFloorId,
        state: floor.state,
        token_in: floor.tokenIn,
        token_out: floor.tokenOut,
        metadata: floor.metadata,
        created_at: floor.createdAt,
        updated_at: floor.updatedAt,
        pages: floor.pages.map((page) => ({
          id: page.id,
          page_no: page.pageNo,
          page_kind: page.pageKind,
          is_active: page.isActive,
          version: page.version,
          checksum: page.checksum,
          created_at: page.createdAt,
          updated_at: page.updatedAt,
          messages: page.messages.map((message) => ({
            id: message.id,
            seq: message.seq,
            role: message.role,
            content: message.content,
            content_format: message.contentFormat,
            token_count: message.tokenCount,
            is_hidden: message.isHidden,
            source: message.source,
            created_at: message.createdAt,
          })),
        })),
      })),
      variables: (snapshot.variables ?? []).map<ThBackupVariable>((row) => ({
        scope: row.scope,
        scope_id_ref: row.scope === "chat"
          ? null
          : row.scope === "branch"
            ? row.scopeRef?.branchId ?? parseBranchVariableScopeId(row.scopeId)?.branchId ?? row.scopeId
            : row.scopeId,
        key: row.key,
        value: row.value,
        updated_at: row.updatedAt,
      })),
      branch_local_variable_snapshots: (snapshot.branchLocalVariableSnapshots ?? []).map((row) =>
        toBackupBranchLocalVariableSnapshot(row, sessionRow.id),
      ),
      memories: {
        items: (snapshot.memories?.items ?? []).map<ThBackupMemoryItem>((row) => ({
          id: row.id,
          scope: row.scope,
          scope_id_ref: row.scope === "chat"
            ? null
            : row.scope === "branch"
              ? row.scopeRef?.branchId ?? parseBranchMemoryScopeId(row.scopeId)?.branchId ?? row.scopeId
              : row.scopeId,
          type: row.type,
          summary_tier: row.summaryTier,
          content: row.content,
          importance: row.importance,
          confidence: row.confidence,
          source_floor_id_ref: row.sourceFloorId,
          source_message_id_ref: row.sourceMessageId,
          status: row.status,
          lifecycle_status: row.lifecycleStatus,
          source_job_id: row.sourceJobId,
          token_count_estimate: row.tokenCountEstimate,
          last_used_at: row.lastUsedAt,
          coverage_start_floor_no: row.coverageStartFloorNo,
          coverage_end_floor_no: row.coverageEndFloorNo,
          derived_from_count: row.derivedFromCount,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
        })),
        edges: (snapshot.memories?.edges ?? []).map<ThBackupMemoryEdge>((row) => ({
          from_id_ref: row.fromId,
          to_id_ref: row.toId,
          relation: row.relation,
          created_at: row.createdAt,
        })),
      },
    };
  });

  const exportedSessionIds = new Set(sessionResources.map((session) => session.id));
  const exportedFloorIds = new Set(
    sessionResources.flatMap((session) => session.floors.map((floor) => floor.id)),
  );
  const characterVersionIds = new Set(versionRows.map((version) => version.id));
  const presetVersionIds = new Set(presetVersionRows.map((version) => version.id));
  const worldbookVersionIds = new Set(worldbookVersionRows.map((version) => version.id));
  const regexProfileVersionIds = new Set(regexProfileVersionRows.map((version) => version.id));
  const assetVersionKindById = new Map<string, ThBackupVcAssetKind>([
    ...versionRows.map((version) => [version.id, "character"] as const),
    ...presetVersionRows.map((version) => [version.id, "preset"] as const),
    ...worldbookVersionRows.map((version) => [version.id, "worldbook"] as const),
    ...regexProfileVersionRows.map((version) => [version.id, "regex_profile"] as const),
  ]);
  const vcTagExportItems = includeVcTags
    ? collectBackupVcTags(db, accountId, exportedSessionIds, exportedFloorIds, assetVersionKindById)
    : [];
  const exportedVcTagIds = new Set(vcTagExportItems.map((item) => item.tag.id));
  const referencedOperationIds = collectReferencedBackupOperationIds(
    presetVersionRows,
    worldbookVersionRows,
    regexProfileVersionRows,
    vcTagExportItems,
  );
  const operationLogRows = collectBackupOperationLogs(db, accountId, includeOperationLogs, {
    referencedOperationIds,
    exportedSessionIds,
    exportedFloorIds,
    exportedVcTagIds,
    characterIds: new Set(characterResources.map((character) => character.id)),
    characterVersionIds,
    presetIds: new Set(presetResources.map((preset) => preset.id)),
    presetVersionIds,
    worldbookIds: new Set(worldbookResources.map((worldbook) => worldbook.id)),
    worldbookVersionIds,
    regexProfileIds: new Set(regexProfileResources.map((profile) => profile.id)),
    regexProfileVersionIds,
    assetVersionKindById,
  });
  const exportedOperationLogIds = new Set(operationLogRows.map((row) => row.id));
  const vc: ThBackupVc = {
    tags: vcTagExportItems.map(({ tag, sourceOperationId }) => ({
      ...tag,
      created_by_operation_id_ref: sourceOperationId && exportedOperationLogIds.has(sourceOperationId)
        ? sourceOperationId
        : null,
    })),
    operation_logs: operationLogRows.map((row) => toBackupOperationLog(row, {
      exportedSessionIds,
      exportedFloorIds,
      exportedVcTagIds,
      characterIds: new Set(characterResources.map((character) => character.id)),
      characterVersionIds,
      presetIds: new Set(presetResources.map((preset) => preset.id)),
      presetVersionIds,
      worldbookIds: new Set(worldbookResources.map((worldbook) => worldbook.id)),
      worldbookVersionIds,
      regexProfileIds: new Set(regexProfileResources.map((profile) => profile.id)),
      regexProfileVersionIds,
      assetVersionKindById,
    })),
  };

  const counts = emptyBackupCountSummary();
  counts.characters = characterResources.length;
  counts.character_versions = versionRows.length;
  counts.presets = presetResources.length;
  counts.preset_versions = presetVersionRows.length;
  counts.worldbooks = worldbookResources.length;
  counts.worldbook_versions = worldbookVersionRows.length;
  counts.worldbook_entries = worldbookEntryRows.length;
  counts.regex_profiles = regexProfileResources.length;
  counts.regex_profile_versions = regexProfileVersionRows.length;
  counts.sessions = sessionResources.length;
  counts.vc_tags = vc.tags.length;
  counts.operation_logs = vc.operation_logs.length;
  for (const session of sessionResources) {
    counts.session_branches += session.branches.length;
    counts.floors += session.floors.length;
    counts.variables += session.variables.length;
    counts.branch_local_variable_snapshots += session.branch_local_variable_snapshots.length;
    counts.memory_items += session.memories.items.length;
    counts.memory_edges += session.memories.edges.length;
    for (const floor of session.floors) {
      counts.pages += floor.pages.length;
      for (const page of floor.pages) {
        counts.messages += page.messages.length;
      }
    }
  }

  return {
    createdAt: Date.now(),
    source: {
      accountId,
    },
    includedDomains: BACKUP_DOMAIN_ORDER.filter((domain) => includedDomainSet.has(domain)),
    resources: {
      characters: characterResources,
      presets: presetResources,
      worldbooks: worldbookResources,
      regexProfiles: regexProfileResources,
    },
    sessions: sessionResources,
    vc,
    counts,
    isFullExport,
  };
}

function groupRowsBy<TRow, TKey>(rows: readonly TRow[], getKey: (row: TRow) => TKey): Map<TKey, TRow[]> {
  const grouped = new Map<TKey, TRow[]>();
  for (const row of rows) {
    const key = getKey(row);
    const list = grouped.get(key);
    if (list) {
      list.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return grouped;
}

function hasBranchAssetBinding(branch: SessionBranchRow): boolean {
  return branch.assetBindingDeepBinding !== null
    || branch.assetBindingPresetId !== null
    || branch.assetBindingPresetVersionId !== null
    || branch.assetBindingWorldbookProfileId !== null
    || branch.assetBindingWorldbookVersionId !== null
    || branch.assetBindingRegexProfileId !== null
    || branch.assetBindingRegexProfileVersionId !== null;
}

function assertSelectedBranchAssetBindingIds(
  branch: SessionBranchRow,
  selectedPresetIds: Set<string>,
  selectedWorldbookIds: Set<string>,
  selectedRegexProfileIds: Set<string>,
): void {
  if (branch.assetBindingPresetId && !selectedPresetIds.has(branch.assetBindingPresetId)) {
    throw new CoreAssetBackupError(
      400,
      "backup_incomplete_selection",
      `Session branch ${branch.sessionId}:${branch.branchId} requires preset ${branch.assetBindingPresetId} to be included`,
    );
  }
  if (branch.assetBindingWorldbookProfileId && !selectedWorldbookIds.has(branch.assetBindingWorldbookProfileId)) {
    throw new CoreAssetBackupError(
      400,
      "backup_incomplete_selection",
      `Session branch ${branch.sessionId}:${branch.branchId} requires worldbook ${branch.assetBindingWorldbookProfileId} to be included`,
    );
  }
  if (branch.assetBindingRegexProfileId && !selectedRegexProfileIds.has(branch.assetBindingRegexProfileId)) {
    throw new CoreAssetBackupError(
      400,
      "backup_incomplete_selection",
      `Session branch ${branch.sessionId}:${branch.branchId} requires regex profile ${branch.assetBindingRegexProfileId} to be included`,
    );
  }
}

function ensureSelectedPromptAssetRowsForBranchBinding(
  db: AppDb,
  accountId: string,
  branch: SessionBranchRow,
  selectedPresets: Array<typeof presets.$inferSelect>,
  selectedPresetIds: Set<string>,
  selectedWorldbooks: Array<typeof worldbooks.$inferSelect>,
  selectedWorldbookIds: Set<string>,
  selectedRegexProfiles: Array<typeof regexProfiles.$inferSelect>,
  selectedRegexProfileIds: Set<string>,
): void {
  if (branch.assetBindingPresetId) {
    ensureSelectedPreset(db, accountId, branch.assetBindingPresetId, selectedPresets, selectedPresetIds, branch);
  }
  if (branch.assetBindingPresetVersionId) {
    const version = db
      .select({ presetId: presetVersions.presetId })
      .from(presetVersions)
      .where(eq(presetVersions.id, branch.assetBindingPresetVersionId))
      .limit(1)
      .all()[0];
    if (!version) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session branch ${branch.sessionId}:${branch.branchId} references missing preset version ${branch.assetBindingPresetVersionId}`,
      );
    }
    ensureSelectedPreset(db, accountId, version.presetId, selectedPresets, selectedPresetIds, branch);
  }

  if (branch.assetBindingWorldbookProfileId) {
    ensureSelectedWorldbook(
      db,
      accountId,
      branch.assetBindingWorldbookProfileId,
      selectedWorldbooks,
      selectedWorldbookIds,
      branch,
    );
  }
  if (branch.assetBindingWorldbookVersionId) {
    const version = db
      .select({ worldbookId: worldbookVersions.worldbookId })
      .from(worldbookVersions)
      .where(eq(worldbookVersions.id, branch.assetBindingWorldbookVersionId))
      .limit(1)
      .all()[0];
    if (!version) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session branch ${branch.sessionId}:${branch.branchId} references missing worldbook version ${branch.assetBindingWorldbookVersionId}`,
      );
    }
    ensureSelectedWorldbook(db, accountId, version.worldbookId, selectedWorldbooks, selectedWorldbookIds, branch);
  }

  if (branch.assetBindingRegexProfileId) {
    ensureSelectedRegexProfile(
      db,
      accountId,
      branch.assetBindingRegexProfileId,
      selectedRegexProfiles,
      selectedRegexProfileIds,
      branch,
    );
  }
  if (branch.assetBindingRegexProfileVersionId) {
    const version = db
      .select({ regexProfileId: regexProfileVersions.regexProfileId })
      .from(regexProfileVersions)
      .where(eq(regexProfileVersions.id, branch.assetBindingRegexProfileVersionId))
      .limit(1)
      .all()[0];
    if (!version) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session branch ${branch.sessionId}:${branch.branchId} references missing regex profile version ${branch.assetBindingRegexProfileVersionId}`,
      );
    }
    ensureSelectedRegexProfile(db, accountId, version.regexProfileId, selectedRegexProfiles, selectedRegexProfileIds, branch);
  }
}

function ensureSelectedPreset(
  db: AppDb,
  accountId: string,
  presetId: string,
  selectedPresets: Array<typeof presets.$inferSelect>,
  selectedPresetIds: Set<string>,
  branch: SessionBranchRow,
): void {
  if (selectedPresetIds.has(presetId)) {
    return;
  }
  const row = db
    .select()
    .from(presets)
    .where(and(eq(presets.accountId, accountId), eq(presets.id, presetId)))
    .limit(1)
    .all()[0];
  if (!row) {
    throw new CoreAssetBackupError(
      400,
      "backup_incomplete_selection",
      `Session branch ${branch.sessionId}:${branch.branchId} references missing preset ${presetId}`,
    );
  }
  selectedPresets.push(row);
  selectedPresetIds.add(row.id);
}

function ensureSelectedWorldbook(
  db: AppDb,
  accountId: string,
  worldbookId: string,
  selectedWorldbooks: Array<typeof worldbooks.$inferSelect>,
  selectedWorldbookIds: Set<string>,
  branch: SessionBranchRow,
): void {
  if (selectedWorldbookIds.has(worldbookId)) {
    return;
  }
  const row = db
    .select()
    .from(worldbooks)
    .where(and(eq(worldbooks.accountId, accountId), eq(worldbooks.id, worldbookId)))
    .limit(1)
    .all()[0];
  if (!row) {
    throw new CoreAssetBackupError(
      400,
      "backup_incomplete_selection",
      `Session branch ${branch.sessionId}:${branch.branchId} references missing worldbook ${worldbookId}`,
    );
  }
  selectedWorldbooks.push(row);
  selectedWorldbookIds.add(row.id);
}

function ensureSelectedRegexProfile(
  db: AppDb,
  accountId: string,
  regexProfileId: string,
  selectedRegexProfiles: Array<typeof regexProfiles.$inferSelect>,
  selectedRegexProfileIds: Set<string>,
  branch: SessionBranchRow,
): void {
  if (selectedRegexProfileIds.has(regexProfileId)) {
    return;
  }
  const row = db
    .select()
    .from(regexProfiles)
    .where(and(eq(regexProfiles.accountId, accountId), eq(regexProfiles.id, regexProfileId)))
    .limit(1)
    .all()[0];
  if (!row) {
    throw new CoreAssetBackupError(
      400,
      "backup_incomplete_selection",
      `Session branch ${branch.sessionId}:${branch.branchId} references missing regex profile ${regexProfileId}`,
    );
  }
  selectedRegexProfiles.push(row);
  selectedRegexProfileIds.add(row.id);
}

function toBackupSessionBranchAssetBinding(branch: SessionBranchRow): ThBackupSession["branches"][number]["asset_binding"] {
  if (!hasBranchAssetBinding(branch)) {
    return null;
  }
  return {
    deep_binding: branch.assetBindingDeepBinding ?? false,
    preset_id_ref: branch.assetBindingPresetId ?? null,
    preset_version_id_ref: branch.assetBindingPresetVersionId ?? null,
    worldbook_id_ref: branch.assetBindingWorldbookProfileId ?? null,
    worldbook_version_id_ref: branch.assetBindingWorldbookVersionId ?? null,
    regex_profile_id_ref: branch.assetBindingRegexProfileId ?? null,
    regex_profile_version_id_ref: branch.assetBindingRegexProfileVersionId ?? null,
  };
}

function assertBranchAssetBindingInBackup(input: {
  branch: SessionBranchRow;
  presetIdSet: Set<string>;
  presetVersionIdSet: Set<string>;
  presetVersionToPresetId: Map<string, string>;
  worldbookIdSet: Set<string>;
  worldbookVersionIdSet: Set<string>;
  worldbookVersionToWorldbookId: Map<string, string>;
  regexProfileIdSet: Set<string>;
  regexProfileVersionIdSet: Set<string>;
  regexProfileVersionToProfileId: Map<string, string>;
}): void {
  const { branch } = input;
  if (branch.assetBindingPresetId && !input.presetIdSet.has(branch.assetBindingPresetId)) {
    throw new CoreAssetBackupError(
      400,
      "backup_incomplete_selection",
      `Session branch ${branch.sessionId}:${branch.branchId} references preset ${branch.assetBindingPresetId} that is not present in the backup`,
    );
  }
  if (branch.assetBindingPresetVersionId) {
    const ownerId = input.presetVersionToPresetId.get(branch.assetBindingPresetVersionId);
    if (!ownerId || !input.presetVersionIdSet.has(branch.assetBindingPresetVersionId)) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session branch ${branch.sessionId}:${branch.branchId} references preset version ${branch.assetBindingPresetVersionId} that is not present in the backup`,
      );
    }
    if (branch.assetBindingPresetId && ownerId !== branch.assetBindingPresetId) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session branch ${branch.sessionId}:${branch.branchId} preset version ${branch.assetBindingPresetVersionId} does not belong to preset ${branch.assetBindingPresetId}`,
      );
    }
  }

  if (branch.assetBindingWorldbookProfileId && !input.worldbookIdSet.has(branch.assetBindingWorldbookProfileId)) {
    throw new CoreAssetBackupError(
      400,
      "backup_incomplete_selection",
      `Session branch ${branch.sessionId}:${branch.branchId} references worldbook ${branch.assetBindingWorldbookProfileId} that is not present in the backup`,
    );
  }
  if (branch.assetBindingWorldbookVersionId) {
    const ownerId = input.worldbookVersionToWorldbookId.get(branch.assetBindingWorldbookVersionId);
    if (!ownerId || !input.worldbookVersionIdSet.has(branch.assetBindingWorldbookVersionId)) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session branch ${branch.sessionId}:${branch.branchId} references worldbook version ${branch.assetBindingWorldbookVersionId} that is not present in the backup`,
      );
    }
    if (branch.assetBindingWorldbookProfileId && ownerId !== branch.assetBindingWorldbookProfileId) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session branch ${branch.sessionId}:${branch.branchId} worldbook version ${branch.assetBindingWorldbookVersionId} does not belong to worldbook ${branch.assetBindingWorldbookProfileId}`,
      );
    }
  }

  if (branch.assetBindingRegexProfileId && !input.regexProfileIdSet.has(branch.assetBindingRegexProfileId)) {
    throw new CoreAssetBackupError(
      400,
      "backup_incomplete_selection",
      `Session branch ${branch.sessionId}:${branch.branchId} references regex profile ${branch.assetBindingRegexProfileId} that is not present in the backup`,
    );
  }
  if (branch.assetBindingRegexProfileVersionId) {
    const ownerId = input.regexProfileVersionToProfileId.get(branch.assetBindingRegexProfileVersionId);
    if (!ownerId || !input.regexProfileVersionIdSet.has(branch.assetBindingRegexProfileVersionId)) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session branch ${branch.sessionId}:${branch.branchId} references regex profile version ${branch.assetBindingRegexProfileVersionId} that is not present in the backup`,
      );
    }
    if (branch.assetBindingRegexProfileId && ownerId !== branch.assetBindingRegexProfileId) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session branch ${branch.sessionId}:${branch.branchId} regex profile version ${branch.assetBindingRegexProfileVersionId} does not belong to regex profile ${branch.assetBindingRegexProfileId}`,
      );
    }
  }
}

function collectBackupVcTags(
  db: AppDb,
  accountId: string,
  exportedSessionIds: Set<string>,
  exportedFloorIds: Set<string>,
  assetVersionKindById: Map<string, ThBackupVcAssetKind>,
): BackupVcTagExportItem[] {
  const targetConditions = [];
  const floorIds = [...exportedFloorIds];
  const assetVersionIds = [...assetVersionKindById.keys()];

  if (floorIds.length > 0) {
    targetConditions.push(and(eq(vcTags.targetType, "floor"), inArray(vcTags.targetId, floorIds)));
  }
  if (assetVersionIds.length > 0) {
    targetConditions.push(and(eq(vcTags.targetType, "asset_version"), inArray(vcTags.targetId, assetVersionIds)));
  }
  if (targetConditions.length === 0) {
    return [];
  }

  const targetWhere = targetConditions.length === 1 ? targetConditions[0] : or(...targetConditions);
  if (!targetWhere) {
    return [];
  }

  return db
    .select()
    .from(vcTags)
    .where(and(eq(vcTags.accountId, accountId), targetWhere))
    .orderBy(asc(vcTags.createdAt), asc(vcTags.name), asc(vcTags.id))
    .all()
    .map((tag) => ({
      tag: {
        id: tag.id,
        name: tag.name,
        target_type: tag.targetType,
        target_asset_kind: tag.targetType === "asset_version"
          ? assetVersionKindById.get(tag.targetId) ?? null
          : null,
        target_id_ref: tag.targetId,
        session_id_ref: tag.sessionId && exportedSessionIds.has(tag.sessionId) ? tag.sessionId : null,
        metadata: parseJsonField(tag.metadataJson ?? null),
        created_by_operation_id_ref: null,
        created_at: tag.createdAt,
      },
      sourceOperationId: tag.createdByOperationId,
    }));
}

function collectReferencedBackupOperationIds(
  presetVersionRows: Array<typeof presetVersions.$inferSelect>,
  worldbookVersionRows: Array<typeof worldbookVersions.$inferSelect>,
  regexProfileVersionRows: Array<typeof regexProfileVersions.$inferSelect>,
  vcTagExportItems: BackupVcTagExportItem[],
): Set<string> {
  const ids = new Set<string>();
  for (const row of presetVersionRows) pushOptionalId(ids, row.createdByOperationId);
  for (const row of worldbookVersionRows) pushOptionalId(ids, row.createdByOperationId);
  for (const row of regexProfileVersionRows) pushOptionalId(ids, row.createdByOperationId);
  for (const item of vcTagExportItems) pushOptionalId(ids, item.sourceOperationId);
  return ids;
}

function collectBackupOperationLogs(
  db: AppDb,
  accountId: string,
  mode: BackupOperationLogIncludeMode,
  context: BackupOperationLogCollectionContext,
): OperationLogRow[] {
  if (mode === "none") {
    return [];
  }

  const conditions: SQL[] = [];
  const referencedOperationIds = toNonEmptyArray(context.referencedOperationIds);
  if (referencedOperationIds.length > 0) {
    conditions.push(inArray(operationLogs.id, referencedOperationIds));
  }

  if (mode === "selected_scope") {
    const sessionIds = toNonEmptyArray(context.exportedSessionIds);
    const floorIds = toNonEmptyArray(context.exportedFloorIds);
    const vcTagIds = toNonEmptyArray(context.exportedVcTagIds);
    const characterIds = toNonEmptyArray(context.characterIds);
    const characterVersionIds = toNonEmptyArray(context.characterVersionIds);
    const presetIds = toNonEmptyArray(context.presetIds);
    const presetVersionIds = toNonEmptyArray(context.presetVersionIds);
    const worldbookIds = toNonEmptyArray(context.worldbookIds);
    const worldbookVersionIds = toNonEmptyArray(context.worldbookVersionIds);
    const regexProfileIds = toNonEmptyArray(context.regexProfileIds);
    const regexProfileVersionIds = toNonEmptyArray(context.regexProfileVersionIds);
    const assetVersionIds = toNonEmptyArray(new Set(context.assetVersionKindById.keys()));

    if (sessionIds.length > 0) {
      conditions.push(inArray(operationLogs.sessionId, sessionIds));
      pushOperationLogCondition(conditions, and(eq(operationLogs.targetType, "session"), inArray(operationLogs.targetId, sessionIds)));
    }
    if (floorIds.length > 0) {
      conditions.push(inArray(operationLogs.floorId, floorIds));
      pushOperationLogCondition(conditions, and(eq(operationLogs.targetType, "floor"), inArray(operationLogs.targetId, floorIds)));
    }
    if (vcTagIds.length > 0) {
      pushOperationLogCondition(conditions, and(eq(operationLogs.targetType, "vc_tag"), inArray(operationLogs.targetId, vcTagIds)));
    }
    if (assetVersionIds.length > 0) {
      pushOperationLogCondition(conditions, and(eq(operationLogs.targetType, "asset_version"), inArray(operationLogs.targetId, assetVersionIds)));
    }
    pushOperationLogTargetCondition(conditions, "character", characterIds);
    pushOperationLogTargetCondition(conditions, "character_version", characterVersionIds);
    pushOperationLogTargetCondition(conditions, "preset", presetIds);
    pushOperationLogTargetCondition(conditions, "preset_version", presetVersionIds);
    pushOperationLogTargetCondition(conditions, "worldbook", worldbookIds);
    pushOperationLogTargetCondition(conditions, "worldbook_version", worldbookVersionIds);
    pushOperationLogTargetCondition(conditions, "regex_profile", regexProfileIds);
    pushOperationLogTargetCondition(conditions, "regex_profile_version", regexProfileVersionIds);
  }

  if (conditions.length === 0) {
    return [];
  }

  const scopeWhere = conditions.length === 1 ? conditions[0] : or(...conditions);
  if (!scopeWhere) {
    return [];
  }

  return db
    .select()
    .from(operationLogs)
    .where(and(eq(operationLogs.accountId, accountId), scopeWhere))
    .orderBy(asc(operationLogs.createdAt), asc(operationLogs.id))
    .all();
}

type BackupOperationLogCollectionContext = BackupOperationLogExportContext & {
  referencedOperationIds: Set<string>;
};

type BackupOperationLogExportContext = {
  exportedSessionIds: Set<string>;
  exportedFloorIds: Set<string>;
  exportedVcTagIds: Set<string>;
  characterIds: Set<string>;
  characterVersionIds: Set<string>;
  presetIds: Set<string>;
  presetVersionIds: Set<string>;
  worldbookIds: Set<string>;
  worldbookVersionIds: Set<string>;
  regexProfileIds: Set<string>;
  regexProfileVersionIds: Set<string>;
  assetVersionKindById: Map<string, ThBackupVcAssetKind>;
};

function pushOperationLogTargetCondition(
  conditions: SQL[],
  targetType: string,
  targetIds: string[],
): void {
  if (targetIds.length > 0) {
    pushOperationLogCondition(conditions, and(eq(operationLogs.targetType, targetType), inArray(operationLogs.targetId, targetIds)));
  }
}

function pushOperationLogCondition(conditions: SQL[], condition: SQL | undefined): void {
  if (condition) {
    conditions.push(condition);
  }
}

function toBackupOperationLog(
  row: OperationLogRow,
  context: BackupOperationLogExportContext,
): ThBackupOperationLog {
  return {
    id: row.id,
    operation_group_id: row.operationGroupId ?? null,
    request_id: row.requestId ?? null,
    actor_type: row.actorType,
    actor_id: row.actorId ?? null,
    source_type: row.sourceType,
    action: row.action,
    status: row.status,
    session_id_ref: row.sessionId && context.exportedSessionIds.has(row.sessionId) ? row.sessionId : null,
    branch_id: row.branchId ?? null,
    floor_id_ref: row.floorId && context.exportedFloorIds.has(row.floorId) ? row.floorId : null,
    run_id: row.runId ?? null,
    target_type: row.targetType,
    target_id_ref: encodeBackupOperationLogTargetIdRef(row.targetType, row.targetId, context),
    before_ref: parseJsonField(row.beforeRefJson ?? null),
    after_ref: parseJsonField(row.afterRefJson ?? null),
    diff: parseJsonField(row.diffJson ?? null),
    metadata: parseJsonField(row.metadataJson ?? null),
    created_at: row.createdAt,
  };
}

function encodeBackupOperationLogTargetIdRef(
  targetType: string,
  targetId: string | null,
  context: BackupOperationLogExportContext,
): string | null {
  if (!targetId) {
    return null;
  }

  switch (targetType) {
    case "session":
      return context.exportedSessionIds.has(targetId) ? targetId : null;
    case "floor":
      return context.exportedFloorIds.has(targetId) ? targetId : null;
    case "vc_tag":
      return context.exportedVcTagIds.has(targetId) ? targetId : null;
    case "asset_version":
      return context.assetVersionKindById.has(targetId) ? targetId : null;
    case "character":
      return context.characterIds.has(targetId) ? targetId : null;
    case "character_version":
      return context.characterVersionIds.has(targetId) ? targetId : null;
    case "preset":
      return context.presetIds.has(targetId) ? targetId : null;
    case "preset_version":
      return context.presetVersionIds.has(targetId) ? targetId : null;
    case "worldbook":
      return context.worldbookIds.has(targetId) ? targetId : null;
    case "worldbook_version":
      return context.worldbookVersionIds.has(targetId) ? targetId : null;
    case "regex_profile":
      return context.regexProfileIds.has(targetId) ? targetId : null;
    case "regex_profile_version":
      return context.regexProfileVersionIds.has(targetId) ? targetId : null;
    default:
      return targetId;
  }
}

function pushOptionalId(target: Set<string>, value: string | null | undefined): void {
  if (typeof value === "string" && value.trim().length > 0) {
    target.add(value);
  }
}

function toNonEmptyArray(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).filter((value) => value.trim().length > 0);
}

function normalizeIdList(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }

  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

function normalizeDomains(domains: ThBackupDomain[] | undefined, hasAnySelection: boolean): ThBackupDomain[] {
  if (!domains || domains.length === 0) {
    return hasAnySelection ? [] : [...BACKUP_DOMAIN_ORDER];
  }

  const set = new Set<ThBackupDomain>();
  for (const domain of domains) {
    set.add(domain);
  }
  return BACKUP_DOMAIN_ORDER.filter((domain) => set.has(domain));
}

function assertSelectionExists(selectedIds: readonly string[], foundIds: readonly string[], fieldName: string): void {
  if (selectedIds.length === 0) {
    return;
  }

  const found = new Set(foundIds);
  const missing = selectedIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new CoreAssetBackupError(
      400,
      "backup_selection_not_found",
      `Some selected resources do not exist: ${missing.join(", ")}`,
      {
        details: {
          field: fieldName,
          missing,
        },
      },
    );
  }
}

function parseStringArray(raw: string): string[] {
  const parsed = parseJsonField(raw);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function toBackupBranchLocalVariableSnapshot(
  row: NonNullable<ReturnType<typeof captureSessionExportSnapshot>["branchLocalVariableSnapshots"]>[number],
  sessionId: string,
): ThBackupBranchLocalVariableSnapshot {
  const provenanceEntries = Object.entries(row.provenance ?? {});
  const provenance = provenanceEntries.length > 0
    ? Object.fromEntries(
        provenanceEntries.map(([key, entry]) => [key, toBackupBranchLocalVariableProvenance(entry, sessionId)]),
      )
    : undefined;

  return {
    floor_id_ref: row.floorId,
    branch_id: row.branchId,
    snapshot_version: row.schemaVersion,
    values: row.values,
    ...(provenance ? { provenance } : {}),
    created_at: row.createdAt,
  };
}

function toBackupBranchLocalVariableProvenance(
  entry: NonNullable<ReturnType<typeof captureSessionExportSnapshot>["branchLocalVariableSnapshots"]>[number]["provenance"][string],
  sessionId: string,
): ThBackupBranchLocalVariableProvenance {
  const sourceScopeIdRef = encodeBackupProvenanceScopeIdRef(
    entry.sourceScope,
    entry.sourceScopeId,
    sessionId,
    entry.inheritedFromBranchId,
  );

  return {
    source_scope: entry.sourceScope,
    ...(sourceScopeIdRef === undefined ? {} : { source_scope_id_ref: sourceScopeIdRef }),
    ...(entry.sourceVariableId ? { source_variable_id: entry.sourceVariableId } : {}),
    ...(entry.sourceUpdatedAt !== undefined ? { source_updated_at: entry.sourceUpdatedAt } : {}),
    ...(entry.inheritedFromFloorId ? { inherited_from_floor_id_ref: entry.inheritedFromFloorId } : {}),
    ...(entry.inheritedFromBranchId ? { inherited_from_branch_id: entry.inheritedFromBranchId } : {}),
    origin_kind: entry.originKind,
  };
}

function encodeBackupProvenanceScopeIdRef(
  sourceScope: NonNullable<ReturnType<typeof captureSessionExportSnapshot>["branchLocalVariableSnapshots"]>[number]["provenance"][string]["sourceScope"],
  sourceScopeId: string,
  sessionId: string,
  inheritedFromBranchId: string | undefined,
): string | null | undefined {
  if (sourceScope === "chat") {
    return sourceScopeId === sessionId ? null : sourceScopeId;
  }

  if (sourceScope === "branch") {
    const parsed = parseBranchVariableScopeId(sourceScopeId);
    if (parsed) {
      return parsed.branchId;
    }
    return inheritedFromBranchId ?? sourceScopeId;
  }

  return sourceScopeId;
}

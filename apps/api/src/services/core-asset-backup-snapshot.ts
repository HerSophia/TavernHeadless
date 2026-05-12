import { and, asc, eq, inArray } from "drizzle-orm";
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
  type ThBackupPreset,
  type ThBackupRegexProfile,
  type ThBackupSession,
  type ThBackupVariable,
  type ThBackupWorldbook,
} from "@tavern/shared/types/backup-file";

import type { AppDb } from "../db/client.js";
import {
  characterVersions,
  characters,
  presetVersions,
  presets,
  regexProfileVersions,
  regexProfiles,
  sessions,
  sessionBranches,
  worldbookVersions,
  worldbookEntries,
  worldbooks,
} from "../db/schema.js";
import { parseJsonField } from "../lib/http.js";
import { emptyBackupCountSummary, type BackupCountSummary } from "./backup-runtime-job-definitions.js";
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
  counts: BackupCountSummary;
  isFullExport: boolean;
}

const BACKUP_DOMAIN_ORDER: readonly ThBackupDomain[] = ["characters", "presets", "worldbooks", "regex_profiles", "sessions"];

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
  for (const row of presetVersionRows) {
    presetVersionIdSet.add(row.id);
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
  for (const row of worldbookVersionRows) {
    worldbookVersionIdSet.add(row.id);
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
  for (const row of regexProfileVersionRows) {
    regexProfileVersionIdSet.add(row.id);
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
    const branchRows = db
      .select()
      .from(sessionBranches)
      .where(and(eq(sessionBranches.accountId, accountId), eq(sessionBranches.sessionId, sessionRow.id)))
      .orderBy(asc(sessionBranches.createdAt), asc(sessionBranches.updatedAt), asc(sessionBranches.branchId))
      .all();

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
    counts,
    isFullExport,
  };
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

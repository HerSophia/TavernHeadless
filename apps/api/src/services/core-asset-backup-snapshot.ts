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
  type ThBackupSession,
  type ThBackupVariable,
  type ThBackupWorldbook,
} from "@tavern/shared/types/backup-file";

import type { AppDb } from "../db/client.js";
import {
  characterVersions,
  characters,
  sessions,
  sessionBranches,
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
  worldbookIds?: string[];
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
    worldbooks: ThBackupWorldbook[];
  };
  sessions: ThBackupSession[];
  counts: BackupCountSummary;
  isFullExport: boolean;
}

const BACKUP_DOMAIN_ORDER: readonly ThBackupDomain[] = ["characters", "worldbooks", "sessions"];

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
  const worldbookIds = normalizeIdList(input.worldbookIds);
  const hasAnySelection = sessionIds.length > 0 || characterIds.length > 0 || worldbookIds.length > 0;
  const requestedDomains = normalizeDomains(input.domains, hasAnySelection);
  const requestedDomainSet = new Set<ThBackupDomain>(requestedDomains);

  if (sessionIds.length > 0) {
    requestedDomainSet.add("sessions");
  }
  if (characterIds.length > 0) {
    requestedDomainSet.add("characters");
  }
  if (worldbookIds.length > 0) {
    requestedDomainSet.add("worldbooks");
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

  const selectedCharacterIds = new Set(selectedCharacters.map((row) => row.id));
  const selectedWorldbookIds = new Set(selectedWorldbooks.map((row) => row.id));
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
        if (session.worldbookProfileId && !selectedWorldbookIds.has(session.worldbookProfileId)) {
          throw new CoreAssetBackupError(
            400,
            "backup_incomplete_selection",
            `Selected sessions require worldbook ${session.worldbookProfileId} to be included`,
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
    if (selectedWorldbooks.length > 0 || worldbookIds.length > 0) {
      includedDomainSet.add("worldbooks");
    }
  }

  const selectedCharacterIdList = selectedCharacters.map((row) => row.id);
  const selectedWorldbookIdList = selectedWorldbooks.map((row) => row.id);

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
  }));

  const worldbookIdSet = new Set(worldbookResources.map((row) => row.id));
  const characterIdSet = new Set(characterResources.map((row) => row.id));

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
    if (sessionRow.worldbookProfileId && !worldbookIdSet.has(sessionRow.worldbookProfileId)) {
      throw new CoreAssetBackupError(
        400,
        "backup_incomplete_selection",
        `Session ${sessionRow.id} references worldbook ${sessionRow.worldbookProfileId} that is not present in the backup`,
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
        worldbook_id_ref: sessionRow.worldbookProfileId ?? null,
        preset_id: sessionRow.presetId ?? null,
        regex_profile_id: sessionRow.regexProfileId ?? null,
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
  counts.worldbooks = worldbookResources.length;
  counts.worldbook_entries = worldbookEntryRows.length;
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
      worldbooks: worldbookResources,
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

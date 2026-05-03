import { and, asc, eq } from "drizzle-orm";
import { thBackupFileSchema } from "@tavern/shared";
import {
  type ThBackupBranchLocalVariableProvenance,
  type ThBackupFile,
  type ThBackupMemoryItem,
} from "@tavern/shared/types/backup-file";

import type { AppDb } from "../db/client.js";
import { characters, sessions, worldbooks } from "../db/schema.js";
import {
  backupDroppedBindingSummarySchema,
  backupRenamedResourceSchema,
  backupTopLevelCreateSummarySchema,
  backupWarningSchema,
  type BackupCountSummary,
  type BackupDroppedBindingSummary,
  type BackupRenamedResource,
  type BackupTopLevelCreateSummary,
  type BackupWarning,
  emptyBackupCountSummary,
} from "./backup-runtime-job-definitions.js";
import {
  CoreAssetBackupError,
  assertCoreAssetBackupRestoreMode,
  parseCoreAssetBackupFile,
} from "./core-asset-backup-parser.js";

export interface BackupRestoreNamePlan {
  characters: Map<string, string>;
  worldbooks: Map<string, string>;
  sessions: Map<string, string | null>;
  renamedResources: BackupRenamedResource[];
}

export interface CoreAssetBackupPreviewResult {
  backup_kind: string;
  restore_mode: "create_copy";
  included_domains: ThBackupFile["included_domains"];
  counts: BackupCountSummary;
  will_create: BackupTopLevelCreateSummary;
  renamed_resources: BackupRenamedResource[];
  dropped_bindings: BackupDroppedBindingSummary;
  warnings: BackupWarning[];
}

export interface CoreAssetBackupAnalysis {
  file: ThBackupFile;
  restoreMode: "create_copy";
  namePlan: BackupRestoreNamePlan;
  preview: CoreAssetBackupPreviewResult;
}

export function previewCoreAssetBackup(
  db: AppDb,
  input: { accountId: string; data: unknown; mode?: string | null },
): CoreAssetBackupPreviewResult {
  return analyzeCoreAssetBackup(db, input).preview;
}

export function analyzeCoreAssetBackup(
  db: AppDb,
  input: { accountId: string; data: unknown; mode?: string | null },
): CoreAssetBackupAnalysis {
  const restoreMode = assertCoreAssetBackupRestoreMode(input.mode);
  const file = parseCoreAssetBackupFile(input.data);
  const warnings = validateCoreAssetBackupFile(file);
  const counts = countCoreAssetBackupFile(file);
  const droppedBindings = collectDroppedBindings(file);
  const namePlan = planCoreAssetBackupCopyRestore(db, input.accountId, file);

  const previewWarnings = [
    ...warnings,
    ...toDroppedBindingWarnings(droppedBindings),
  ];

  return {
    file,
    restoreMode,
    namePlan,
    preview: {
      backup_kind: file.backup_kind,
      restore_mode: restoreMode,
      included_domains: file.included_domains,
      counts,
      will_create: {
        characters: file.resources.characters.length,
        worldbooks: file.resources.worldbooks.length,
        sessions: file.sessions.length,
      },
      renamed_resources: namePlan.renamedResources,
      dropped_bindings: droppedBindings,
      warnings: previewWarnings,
    },
  };
}

export function planCoreAssetBackupCopyRestore(
  db: AppDb,
  accountId: string,
  file: ThBackupFile,
): BackupRestoreNamePlan {
  const existingCharacterNames = new Set(
    db
      .select({ name: characters.name })
      .from(characters)
      .where(eq(characters.accountId, accountId))
      .all()
      .map((row) => row.name),
  );
  const existingWorldbookNames = new Set(
    db
      .select({ name: worldbooks.name })
      .from(worldbooks)
      .where(eq(worldbooks.accountId, accountId))
      .all()
      .map((row) => row.name),
  );
  const existingSessionTitles = new Set(
    db
      .select({ title: sessions.title })
      .from(sessions)
      .where(eq(sessions.accountId, accountId))
      .all()
      .map((row) => row.title)
      .filter((title): title is string => typeof title === "string" && title.trim().length > 0),
  );

  const charactersPlan = new Map<string, string>();
  const worldbooksPlan = new Map<string, string>();
  const sessionsPlan = new Map<string, string | null>();
  const renamedResources: BackupRenamedResource[] = [];

  for (const character of file.resources.characters) {
    const resolved = resolveCreateCopyName(character.name, existingCharacterNames);
    charactersPlan.set(character.id, resolved.name);
    if (resolved.renamed) {
      renamedResources.push({
        type: "character",
        old_name: character.name,
        new_name: resolved.name,
      });
    }
  }

  for (const worldbook of file.resources.worldbooks) {
    const resolved = resolveCreateCopyName(worldbook.name, existingWorldbookNames);
    worldbooksPlan.set(worldbook.id, resolved.name);
    if (resolved.renamed) {
      renamedResources.push({
        type: "worldbook",
        old_name: worldbook.name,
        new_name: resolved.name,
      });
    }
  }

  for (const session of file.sessions) {
    if (!session.title || session.title.trim().length === 0) {
      sessionsPlan.set(session.id, session.title ?? null);
      continue;
    }

    const resolved = resolveCreateCopyName(session.title, existingSessionTitles);
    sessionsPlan.set(session.id, resolved.name);
    if (resolved.renamed) {
      renamedResources.push({
        type: "session",
        old_name: session.title,
        new_name: resolved.name,
      });
    }
  }

  return {
    characters: charactersPlan,
    worldbooks: worldbooksPlan,
    sessions: sessionsPlan,
    renamedResources: backupRenamedResourceSchema.array().parse(renamedResources),
  };
}

export function countCoreAssetBackupFile(file: ThBackupFile): BackupCountSummary {
  const counts = emptyBackupCountSummary();
  counts.characters = file.resources.characters.length;
  counts.character_versions = file.resources.characters.reduce(
    (sum, character) => sum + character.versions.length,
    0,
  );
  counts.worldbooks = file.resources.worldbooks.length;
  counts.worldbook_entries = file.resources.worldbooks.reduce(
    (sum, worldbook) => sum + worldbook.entries.length,
    0,
  );
  counts.sessions = file.sessions.length;

  for (const session of file.sessions) {
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

  return counts;
}

function resolveCreateCopyName(
  desiredName: string,
  existingNames: Set<string>,
): { name: string; renamed: boolean } {
  if (!existingNames.has(desiredName)) {
    existingNames.add(desiredName);
    return { name: desiredName, renamed: false };
  }

  const restoredBase = `${desiredName} (restored)`;
  if (!existingNames.has(restoredBase)) {
    existingNames.add(restoredBase);
    return { name: restoredBase, renamed: true };
  }

  let index = 2;
  while (existingNames.has(`${desiredName} (restored ${index})`)) {
    index += 1;
  }

  const resolved = `${desiredName} (restored ${index})`;
  existingNames.add(resolved);
  return { name: resolved, renamed: true };
}

function collectDroppedBindings(file: ThBackupFile): BackupDroppedBindingSummary {
  const dropped = {
    users: 0,
    presets: 0,
    regex_profiles: 0,
  };

  for (const session of file.sessions) {
    if (session.user_binding.user_id) {
      dropped.users += 1;
    }
    if (session.profile_binding.preset_id) {
      dropped.presets += 1;
    }
    if (session.profile_binding.regex_profile_id) {
      dropped.regex_profiles += 1;
    }
  }

  return backupDroppedBindingSummarySchema.parse(dropped);
}

function toDroppedBindingWarnings(dropped: BackupDroppedBindingSummary): BackupWarning[] {
  const warnings: BackupWarning[] = [];
  if (dropped.users > 0) {
    warnings.push({
      code: "restore_drops_user_binding",
      message: `${dropped.users} 个 session 的 user 绑定将在 restore 时清空`,
    });
  }
  if (dropped.presets > 0) {
    warnings.push({
      code: "restore_drops_preset_binding",
      message: `${dropped.presets} 个 session 的 preset 绑定将在 restore 时清空`,
    });
  }
  if (dropped.regex_profiles > 0) {
    warnings.push({
      code: "restore_drops_regex_profile_binding",
      message: `${dropped.regex_profiles} 个 session 的 regex profile 绑定将在 restore 时清空`,
    });
  }
  return backupWarningSchema.array().parse(warnings);
}

function validateCoreAssetBackupFile(file: ThBackupFile): BackupWarning[] {
  const issues: Array<{ path: string; message: string }> = [];
  let missingMainBranchRegistryCount = 0;

  const characterIds = new Set<string>();
  const characterVersionToCharacterId = new Map<string, string>();
  for (const [characterIndex, character] of file.resources.characters.entries()) {
    pushUniqueIssue(characterIds, character.id, `resources.characters.${characterIndex}.id`, "Duplicate character id", issues);
    const versionNos = new Set<number>();
    for (const [versionIndex, version] of character.versions.entries()) {
      pushUniqueMapIssue(
        characterVersionToCharacterId,
        version.id,
        character.id,
        `resources.characters.${characterIndex}.versions.${versionIndex}.id`,
        "Duplicate character version id",
        issues,
      );
      if (versionNos.has(version.version_no)) {
        issues.push({
          path: `resources.characters.${characterIndex}.versions.${versionIndex}.version_no`,
          message: `Duplicate character version number ${version.version_no}`,
        });
      }
      versionNos.add(version.version_no);
    }
  }

  const worldbookIds = new Set<string>();
  for (const [worldbookIndex, worldbook] of file.resources.worldbooks.entries()) {
    pushUniqueIssue(worldbookIds, worldbook.id, `resources.worldbooks.${worldbookIndex}.id`, "Duplicate worldbook id", issues);
    const entryIds = new Set<string>();
    for (const [entryIndex, entry] of worldbook.entries.entries()) {
      pushUniqueIssue(
        entryIds,
        entry.id,
        `resources.worldbooks.${worldbookIndex}.entries.${entryIndex}.id`,
        "Duplicate worldbook entry id",
        issues,
      );
    }
  }

  const sessionIds = new Set<string>();
  for (const [sessionIndex, session] of file.sessions.entries()) {
    pushUniqueIssue(sessionIds, session.id, `sessions.${sessionIndex}.id`, "Duplicate session id", issues);

    if (session.character_binding.character_id_ref && !characterIds.has(session.character_binding.character_id_ref)) {
      issues.push({
        path: `sessions.${sessionIndex}.character_binding.character_id_ref`,
        message: `Missing referenced character ${session.character_binding.character_id_ref}`,
      });
    }

    if (session.character_binding.character_version_id_ref) {
      const owningCharacterId = characterVersionToCharacterId.get(session.character_binding.character_version_id_ref);
      if (!owningCharacterId) {
        issues.push({
          path: `sessions.${sessionIndex}.character_binding.character_version_id_ref`,
          message: `Missing referenced character version ${session.character_binding.character_version_id_ref}`,
        });
      } else if (
        session.character_binding.character_id_ref
        && owningCharacterId !== session.character_binding.character_id_ref
      ) {
        issues.push({
          path: `sessions.${sessionIndex}.character_binding.character_version_id_ref`,
          message: "character_version_id_ref does not belong to character_id_ref",
        });
      }
    }

    if (session.profile_binding.worldbook_id_ref && !worldbookIds.has(session.profile_binding.worldbook_id_ref)) {
      issues.push({
        path: `sessions.${sessionIndex}.profile_binding.worldbook_id_ref`,
        message: `Missing referenced worldbook ${session.profile_binding.worldbook_id_ref}`,
      });
    }

    const branchRegistryIds = new Set<string>();
    const floorIds = new Set<string>();
    const pageIds = new Set<string>();
    const messageIds = new Set<string>();
    const memoryItemIds = new Set<string>();

    for (const [branchIndex, branch] of session.branches.entries()) {
      pushUniqueIssue(
        branchRegistryIds,
        branch.branch_id,
        `sessions.${sessionIndex}.branches.${branchIndex}.branch_id`,
        "Duplicate branch registry entry",
        issues,
      );
    }

    if (!branchRegistryIds.has("main")) {
      missingMainBranchRegistryCount += 1;
    }

    for (const [floorIndex, floor] of session.floors.entries()) {
      pushUniqueIssue(floorIds, floor.id, `sessions.${sessionIndex}.floors.${floorIndex}.id`, "Duplicate floor id", issues);
      if (!branchRegistryIds.has(floor.branch_id) && floor.branch_id !== "main") {
        issues.push({
          path: `sessions.${sessionIndex}.floors.${floorIndex}.branch_id`,
          message: `Missing branch registry entry for branch ${floor.branch_id}`,
        });
      }

      for (const [pageIndex, page] of floor.pages.entries()) {
        pushUniqueIssue(
          pageIds,
          page.id,
          `sessions.${sessionIndex}.floors.${floorIndex}.pages.${pageIndex}.id`,
          "Duplicate page id",
          issues,
        );
        for (const [messageIndex, message] of page.messages.entries()) {
          pushUniqueIssue(
            messageIds,
            message.id,
            `sessions.${sessionIndex}.floors.${floorIndex}.pages.${pageIndex}.messages.${messageIndex}.id`,
            "Duplicate message id",
            issues,
          );
        }
      }
    }

    for (const [branchIndex, branch] of session.branches.entries()) {
      if (branch.source_floor_id_ref && !floorIds.has(branch.source_floor_id_ref)) {
        issues.push({
          path: `sessions.${sessionIndex}.branches.${branchIndex}.source_floor_id_ref`,
          message: `Missing referenced floor ${branch.source_floor_id_ref}`,
        });
      }
    }

    for (const [floorIndex, floor] of session.floors.entries()) {
      if (floor.parent_floor_id_ref && !floorIds.has(floor.parent_floor_id_ref)) {
        issues.push({
          path: `sessions.${sessionIndex}.floors.${floorIndex}.parent_floor_id_ref`,
          message: `Missing parent floor ${floor.parent_floor_id_ref}`,
        });
      }
      if (floor.superseded_by_floor_id_ref && !floorIds.has(floor.superseded_by_floor_id_ref)) {
        issues.push({
          path: `sessions.${sessionIndex}.floors.${floorIndex}.superseded_by_floor_id_ref`,
          message: `Missing superseded floor ${floor.superseded_by_floor_id_ref}`,
        });
      }
    }

    for (const [variableIndex, variable] of session.variables.entries()) {
      validateVariableScopeRef(sessionIndex, session.id, branchRegistryIds, floorIds, pageIds, variable, variableIndex, issues);
    }

    for (const [snapshotIndex, snapshot] of session.branch_local_variable_snapshots.entries()) {
      if (!floorIds.has(snapshot.floor_id_ref)) {
        issues.push({
          path: `sessions.${sessionIndex}.branch_local_variable_snapshots.${snapshotIndex}.floor_id_ref`,
          message: `Missing referenced floor ${snapshot.floor_id_ref}`,
        });
      }
      if (!branchRegistryIds.has(snapshot.branch_id) && snapshot.branch_id !== "main") {
        issues.push({
          path: `sessions.${sessionIndex}.branch_local_variable_snapshots.${snapshotIndex}.branch_id`,
          message: `Missing branch registry entry for branch ${snapshot.branch_id}`,
        });
      }
      for (const [key, provenance] of Object.entries(snapshot.provenance ?? {})) {
        validateSnapshotProvenance(
          sessionIndex,
          session.id,
          branchRegistryIds,
          floorIds,
          pageIds,
          snapshot.branch_id,
          snapshotIndex,
          key,
          provenance,
          issues,
        );
      }
    }

    for (const [itemIndex, item] of session.memories.items.entries()) {
      pushUniqueIssue(
        memoryItemIds,
        item.id,
        `sessions.${sessionIndex}.memories.items.${itemIndex}.id`,
        "Duplicate memory item id",
        issues,
      );
      validateMemoryScopeRef(sessionIndex, session.id, branchRegistryIds, floorIds, item, itemIndex, issues);
      if (item.source_floor_id_ref && !floorIds.has(item.source_floor_id_ref)) {
        issues.push({
          path: `sessions.${sessionIndex}.memories.items.${itemIndex}.source_floor_id_ref`,
          message: `Missing referenced floor ${item.source_floor_id_ref}`,
        });
      }
      if (item.source_message_id_ref && !messageIds.has(item.source_message_id_ref)) {
        issues.push({
          path: `sessions.${sessionIndex}.memories.items.${itemIndex}.source_message_id_ref`,
          message: `Missing referenced message ${item.source_message_id_ref}`,
        });
      }
    }

    for (const [edgeIndex, edge] of session.memories.edges.entries()) {
      if (!memoryItemIds.has(edge.from_id_ref)) {
        issues.push({
          path: `sessions.${sessionIndex}.memories.edges.${edgeIndex}.from_id_ref`,
          message: `Missing referenced memory item ${edge.from_id_ref}`,
        });
      }
      if (!memoryItemIds.has(edge.to_id_ref)) {
        issues.push({
          path: `sessions.${sessionIndex}.memories.edges.${edgeIndex}.to_id_ref`,
          message: `Missing referenced memory item ${edge.to_id_ref}`,
        });
      }
    }
  }

  if (issues.length > 0) {
    throw new CoreAssetBackupError(
      400,
      "backup_invalid_reference",
      "Backup document contains invalid internal references",
      { details: issues },
    );
  }

  const warnings: BackupWarning[] = [];
  if (missingMainBranchRegistryCount > 0) {
    warnings.push({
      code: "restore_missing_main_branch_registry",
      message: `${missingMainBranchRegistryCount} 个 session 缺少 main branch registry，restore 时将自动补齐`,
    });
  }

  return backupWarningSchema.array().parse(warnings);
}

function pushUniqueIssue(
  set: Set<string>,
  value: string,
  path: string,
  prefix: string,
  issues: Array<{ path: string; message: string }>,
): void {
  if (set.has(value)) {
    issues.push({ path, message: `${prefix}: ${value}` });
    return;
  }
  set.add(value);
}

function pushUniqueMapIssue(
  map: Map<string, string>,
  key: string,
  value: string,
  path: string,
  prefix: string,
  issues: Array<{ path: string; message: string }>,
): void {
  if (map.has(key)) {
    issues.push({ path, message: `${prefix}: ${key}` });
    return;
  }
  map.set(key, value);
}

function validateVariableScopeRef(
  sessionIndex: number,
  sessionId: string,
  branchRegistryIds: Set<string>,
  floorIds: Set<string>,
  pageIds: Set<string>,
  variable: ThBackupFile["sessions"][number]["variables"][number],
  variableIndex: number,
  issues: Array<{ path: string; message: string }>,
): void {
  switch (variable.scope) {
    case "chat": {
      if (variable.scope_id_ref !== null && variable.scope_id_ref !== sessionId) {
        issues.push({
          path: `sessions.${sessionIndex}.variables.${variableIndex}.scope_id_ref`,
          message: `Chat scope must use null or the session id ${sessionId}`,
        });
      }
      return;
    }
    case "branch": {
      const branchId = variable.scope_id_ref ?? "main";
      if (!branchRegistryIds.has(branchId) && branchId !== "main") {
        issues.push({
          path: `sessions.${sessionIndex}.variables.${variableIndex}.scope_id_ref`,
          message: `Missing branch registry entry for branch ${branchId}`,
        });
      }
      return;
    }
    case "floor": {
      if (!variable.scope_id_ref || !floorIds.has(variable.scope_id_ref)) {
        issues.push({
          path: `sessions.${sessionIndex}.variables.${variableIndex}.scope_id_ref`,
          message: `Missing referenced floor ${variable.scope_id_ref ?? "null"}`,
        });
      }
      return;
    }
    case "page": {
      if (!variable.scope_id_ref || !pageIds.has(variable.scope_id_ref)) {
        issues.push({
          path: `sessions.${sessionIndex}.variables.${variableIndex}.scope_id_ref`,
          message: `Missing referenced page ${variable.scope_id_ref ?? "null"}`,
        });
      }
      return;
    }
  }
}

function validateSnapshotProvenance(
  sessionIndex: number,
  sessionId: string,
  branchRegistryIds: Set<string>,
  floorIds: Set<string>,
  pageIds: Set<string>,
  snapshotBranchId: string,
  snapshotIndex: number,
  key: string,
  provenance: ThBackupBranchLocalVariableProvenance,
  issues: Array<{ path: string; message: string }>,
): void {
  const basePath = `sessions.${sessionIndex}.branch_local_variable_snapshots.${snapshotIndex}.provenance.${key}`;
  if (provenance.inherited_from_floor_id_ref && !floorIds.has(provenance.inherited_from_floor_id_ref)) {
    issues.push({
      path: `${basePath}.inherited_from_floor_id_ref`,
      message: `Missing referenced floor ${provenance.inherited_from_floor_id_ref}`,
    });
  }

  if (provenance.inherited_from_branch_id && !branchRegistryIds.has(provenance.inherited_from_branch_id) && provenance.inherited_from_branch_id !== "main") {
    issues.push({
      path: `${basePath}.inherited_from_branch_id`,
      message: `Missing branch registry entry for branch ${provenance.inherited_from_branch_id}`,
    });
  }

  switch (provenance.source_scope) {
    case "chat": {
      if (provenance.source_scope_id_ref !== undefined && provenance.source_scope_id_ref !== null && provenance.source_scope_id_ref !== sessionId) {
        issues.push({
          path: `${basePath}.source_scope_id_ref`,
          message: `Chat provenance must use null or the session id ${sessionId}`,
        });
      }
      return;
    }
    case "branch": {
      const branchId = provenance.source_scope_id_ref ?? snapshotBranchId;
      if (!branchRegistryIds.has(branchId) && branchId !== "main") {
        issues.push({
          path: `${basePath}.source_scope_id_ref`,
          message: `Missing branch registry entry for branch ${branchId}`,
        });
      }
      return;
    }
    case "floor": {
      if (!provenance.source_scope_id_ref || !floorIds.has(provenance.source_scope_id_ref)) {
        issues.push({
          path: `${basePath}.source_scope_id_ref`,
          message: `Missing referenced floor ${provenance.source_scope_id_ref ?? "null"}`,
        });
      }
      return;
    }
    case "page": {
      if (!provenance.source_scope_id_ref || !pageIds.has(provenance.source_scope_id_ref)) {
        issues.push({
          path: `${basePath}.source_scope_id_ref`,
          message: `Missing referenced page ${provenance.source_scope_id_ref ?? "null"}`,
        });
      }
      return;
    }
    case "global":
      return;
  }
}

function validateMemoryScopeRef(
  sessionIndex: number,
  sessionId: string,
  branchRegistryIds: Set<string>,
  floorIds: Set<string>,
  item: ThBackupMemoryItem,
  itemIndex: number,
  issues: Array<{ path: string; message: string }>,
): void {
  switch (item.scope) {
    case "chat": {
      if (item.scope_id_ref !== null && item.scope_id_ref !== sessionId) {
        issues.push({
          path: `sessions.${sessionIndex}.memories.items.${itemIndex}.scope_id_ref`,
          message: `Chat memory scope must use null or the session id ${sessionId}`,
        });
      }
      return;
    }
    case "branch": {
      const branchId = item.scope_id_ref ?? "main";
      if (!branchRegistryIds.has(branchId) && branchId !== "main") {
        issues.push({
          path: `sessions.${sessionIndex}.memories.items.${itemIndex}.scope_id_ref`,
          message: `Missing branch registry entry for branch ${branchId}`,
        });
      }
      return;
    }
    case "floor": {
      if (!item.scope_id_ref || !floorIds.has(item.scope_id_ref)) {
        issues.push({
          path: `sessions.${sessionIndex}.memories.items.${itemIndex}.scope_id_ref`,
          message: `Missing referenced floor ${item.scope_id_ref ?? "null"}`,
        });
      }
      return;
    }
  }
}

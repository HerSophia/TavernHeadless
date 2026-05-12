import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBranchMemoryScopeId, buildBranchVariableScopeId } from "@tavern/shared";
import {
  type ThBackupFile,
} from "@tavern/shared/types/backup-file";

import { buildApp, type BuildAppResult } from "../../app.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import {
  accountUsers,
  characterVersions,
  characters,
  floors,
  memoryEdges,
  memoryItems,
  messagePages,
  messages,
  runtimeScopeStates,
  sessionBranches,
  sessions,
  presetVersions,
  presets,
  regexProfileVersions,
  regexProfiles,
  variables,
  worldbookEntries,
  worldbookVersions,
  worldbooks,
} from "../../db/schema.js";
import { stringifyJsonField } from "../../lib/http.js";
import { BranchLocalVariableSnapshotService } from "../../services/branch-local-variable-snapshot-service.js";
import { BackupWorker } from "../../services/backup-worker.js";
import { buildMemoryRuntimeScopeKey, MEMORY_RUNTIME_SCOPE_TYPE } from "../../services/memory-runtime-job-definitions.js";

const NOW = 1_760_000_000_000;

describe("backup routes", () => {
  const builtApps: BuildAppResult[] = [];
  let artifactDir: string;

  beforeEach(async () => {
    artifactDir = await mkdtemp(join(tmpdir(), "tavern-backup-routes-"));
  });

  afterEach(async () => {
    while (builtApps.length > 0) {
      const built = builtApps.pop();
      if (built) {
        await built.app.close();
      }
    }
    await rm(artifactDir, { recursive: true, force: true });
  });

  async function createBackupApp() {
    const built = await buildApp({
      databasePath: ":memory:",
      auth: { mode: "off" },
      accountMode: "single",
      backupArtifactDir: artifactDir,
      backupImportMaxBytes: 50_000_000,
      backupExportArtifactTtlMs: 60_000,
    });
    builtApps.push(built);
    await built.app.ready();
    return built;
  }

  async function seedCoreAssets(database: BuildAppResult["database"]) {
    const userId = "user-1";
    const characterId = "char-1";
    const characterVersionId = "charver-1";
    const presetId = "preset-1";
    const presetVersionId = "presetver-1";
    const worldbookId = "wb-1";
    const worldbookVersionId = "wbver-1";
    const worldbookEntryId = "wbe-1";
    const regexProfileId = "regex-1";
    const regexProfileVersionId = "regexver-1";
    const sessionId = "session-1";
    const mainFloorId = "floor-main-1";
    const altFloorId = "floor-alt-1";
    const mainPageId = "page-main-1";
    const altPageId = "page-alt-1";
    const mainMessageId = "message-main-1";
    const altMessageId = "message-alt-1";
    const chatMemoryId = "memory-chat-1";
    const branchMemoryId = "memory-branch-1";
    const floorMemoryId = "memory-floor-1";

    await database.insert(accountUsers).values({
      id: userId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: "User One",
      snapshotJson: stringifyJsonField({ name: "User One" }) ?? "{}",
      status: "active",
      revision: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await database.insert(characters).values({
      id: characterId,
      name: "Alice",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      status: "active",
      deletedAt: null,
      revision: 0,
      latestVersionNo: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await database.insert(characterVersions).values({
      id: characterVersionId,
      characterId,
      versionNo: 1,
      dataJson: stringifyJsonField({ name: "Alice", primaryGreeting: "Hello." }) ?? "{}",
      contentHash: "hash-1",
      sourceArtifactJson: stringifyJsonField({ spec: "card" }),
      sourceArtifactFormat: "character_card_v2",
      sourceArtifactDigest: "sha256:card-1",
      createdAt: NOW,
    });

    await database.insert(presets).values({
      id: presetId,
      name: "Story Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: stringifyJsonField({ prompts: [{ identifier: "main", content: "Preset v1" }] }) ?? "{}",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await database.insert(presetVersions).values({
      id: presetVersionId,
      presetId,
      parentVersionId: null,
      versionNo: 1,
      dataJson: stringifyJsonField({ prompts: [{ identifier: "main", content: "Preset v1" }] }) ?? "{}",
      contentHash: "sha256:preset-1",
      createdByOperationId: null,
      createdAt: NOW,
    });

    await database.insert(worldbooks).values({
      id: worldbookId,
      name: "Lorebook",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: stringifyJsonField({ scanDepth: 3 }) ?? "{}",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await database.insert(worldbookEntries).values({
      id: worldbookEntryId,
      worldbookId,
      uid: 0,
      comment: "",
      content: "Kingdom lore",
      keysJson: stringifyJsonField(["kingdom"]) ?? "[]",
      keysSecondaryJson: stringifyJsonField([]) ?? "[]",
      selective: true,
      selectiveLogic: 0,
      constant: false,
      position: 0,
      order: 100,
      depth: 4,
      role: 0,
      disable: false,
      scanDepth: null,
      caseSensitive: null,
      matchWholeWords: null,
      excludeRecursion: false,
      preventRecursion: false,
      delayUntilRecursion: null,
      outletName: "",
      extraJson: stringifyJsonField({}) ?? "{}",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await database.insert(worldbookVersions).values({
      id: worldbookVersionId,
      worldbookId,
      parentVersionId: null,
      versionNo: 1,
      dataJson: stringifyJsonField({ name: "Lorebook", entries: [{ uid: 0, content: "Kingdom lore" }] }) ?? "{}",
      contentHash: "sha256:worldbook-1",
      createdByOperationId: null,
      createdAt: NOW,
    });

    await database.insert(regexProfiles).values({
      id: regexProfileId,
      name: "Story Regex",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: stringifyJsonField({ scripts: [{ scriptName: "trim", findRegex: "/foo/g", replaceString: "bar" }] }) ?? "{}",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await database.insert(regexProfileVersions).values({
      id: regexProfileVersionId,
      regexProfileId,
      parentVersionId: null,
      versionNo: 1,
      dataJson: stringifyJsonField({ scripts: [{ scriptName: "trim", findRegex: "/foo/g", replaceString: "bar" }] }) ?? "{}",
      contentHash: "sha256:regex-1",
      createdByOperationId: null,
      createdAt: NOW,
    });

    await database.insert(sessions).values({
      id: sessionId,
      title: "Story A",
      status: "active",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      characterId,
      characterVersionId,
      characterSnapshotJson: stringifyJsonField({ name: "Alice" }),
      userId,
      userSnapshotJson: stringifyJsonField({ name: "User One" }),
      characterSyncPolicy: "pin",
      presetId,
      regexProfileId,
      worldbookProfileId: worldbookId,
      deepBinding: true,
      presetVersionId,
      worldbookVersionId,
      regexProfileVersionId,
      promptMode: "native",
      modelProvider: "openai-compatible",
      modelName: "model-x",
      modelParamsJson: stringifyJsonField({ temperature: 0.8 }),
      metadataJson: stringifyJsonField({ label: "seed" }),
      createdAt: NOW,
      updatedAt: NOW + 500,
    });

    await database.insert(floors).values([
      {
        id: mainFloorId,
        sessionId,
        floorNo: 0,
        branchId: "main",
        parentFloorId: null,
        supersededAt: null,
        supersededByFloorId: null,
        state: "committed",
        metadataJson: null,
        tokenIn: 3,
        tokenOut: 4,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: altFloorId,
        sessionId,
        floorNo: 1,
        branchId: "alt",
        parentFloorId: mainFloorId,
        supersededAt: null,
        supersededByFloorId: null,
        state: "committed",
        metadataJson: stringifyJsonField({ branch: "alt" }),
        tokenIn: 5,
        tokenOut: 6,
        createdAt: NOW + 100,
        updatedAt: NOW + 100,
      },
    ]);

    await database.insert(sessionBranches).values([
      {
        id: "branch-main-1",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        sessionId,
        branchId: "main",
        sourceFloorId: null,
        sourceBranchId: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "branch-alt-1",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        sessionId,
        branchId: "alt",
        sourceFloorId: mainFloorId,
        sourceBranchId: "main",
        createdAt: NOW + 100,
        updatedAt: NOW + 100,
      },
    ]);

    await database.insert(messagePages).values([
      {
        id: mainPageId,
        floorId: mainFloorId,
        pageNo: 0,
        pageKind: "output",
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: altPageId,
        floorId: altFloorId,
        pageNo: 0,
        pageKind: "output",
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: NOW + 100,
        updatedAt: NOW + 100,
      },
    ]);

    await database.insert(messages).values([
      {
        id: mainMessageId,
        pageId: mainPageId,
        seq: 0,
        role: "assistant",
        content: "Hello from main",
        contentFormat: "text",
        tokenCount: 4,
        isHidden: false,
        source: null,
        createdAt: NOW,
      },
      {
        id: altMessageId,
        pageId: altPageId,
        seq: 0,
        role: "assistant",
        content: "Hello from alt",
        contentFormat: "text",
        tokenCount: 5,
        isHidden: false,
        source: null,
        createdAt: NOW + 100,
      },
    ]);

    await database.insert(variables).values([
      {
        id: "var-chat-1",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        key: "topic",
        valueJson: stringifyJsonField("story") ?? '"story"',
        updatedAt: NOW,
      },
      {
        id: "var-branch-1",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "alt"),
        key: "mood",
        valueJson: stringifyJsonField("branch-mood") ?? '"branch-mood"',
        updatedAt: NOW + 100,
      },
      {
        id: "var-floor-1",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "floor",
        scopeId: altFloorId,
        key: "floor_flag",
        valueJson: stringifyJsonField(true) ?? "true",
        updatedAt: NOW + 100,
      },
      {
        id: "var-page-1",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "page",
        scopeId: altPageId,
        key: "page_flag",
        valueJson: stringifyJsonField(1) ?? "1",
        updatedAt: NOW + 100,
      },
    ]);

    new BranchLocalVariableSnapshotService(database).restoreSnapshot({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      floorId: altFloorId,
      sessionId,
      branchId: "alt",
      createdAt: NOW + 100,
      values: { mood: "branch-local" },
      provenance: {
        mood: {
          sourceScope: "branch",
          sourceScopeId: buildBranchVariableScopeId(sessionId, "alt"),
          sourceVariableId: "var-branch-1",
          sourceUpdatedAt: NOW + 100,
          inheritedFromBranchId: "alt",
          originKind: "authored",
        },
      },
    });

    await database.insert(memoryItems).values([
      {
        id: chatMemoryId,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        type: "summary",
        summaryTier: "macro",
        contentJson: stringifyJsonField({ text: "chat summary" }) ?? "{}",
        factKey: null,
        importance: 0.9,
        confidence: 1,
        sourceFloorId: mainFloorId,
        sourceMessageId: mainMessageId,
        status: "active",
        lifecycleStatus: "active",
        sourceJobId: null,
        tokenCountEstimate: 20,
        lastUsedAt: NOW + 200,
        coverageStartFloorNo: 0,
        coverageEndFloorNo: 1,
        derivedFromCount: 2,
        createdAt: NOW,
        updatedAt: NOW + 200,
      },
      {
        id: branchMemoryId,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchMemoryScopeId(sessionId, "alt"),
        type: "fact",
        summaryTier: null,
        contentJson: stringifyJsonField({ text: "branch fact" }) ?? "{}",
        factKey: "branch_fact",
        importance: 0.7,
        confidence: 1,
        sourceFloorId: altFloorId,
        sourceMessageId: altMessageId,
        status: "active",
        lifecycleStatus: "active",
        sourceJobId: null,
        tokenCountEstimate: 12,
        lastUsedAt: NOW + 200,
        coverageStartFloorNo: null,
        coverageEndFloorNo: null,
        derivedFromCount: null,
        createdAt: NOW + 100,
        updatedAt: NOW + 200,
      },
      {
        id: floorMemoryId,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "floor",
        scopeId: altFloorId,
        type: "open_loop",
        summaryTier: null,
        contentJson: stringifyJsonField({ text: "floor loop" }) ?? "{}",
        factKey: null,
        importance: 0.5,
        confidence: 0.8,
        sourceFloorId: altFloorId,
        sourceMessageId: altMessageId,
        status: "active",
        lifecycleStatus: "active",
        sourceJobId: null,
        tokenCountEstimate: 8,
        lastUsedAt: NOW + 200,
        coverageStartFloorNo: null,
        coverageEndFloorNo: null,
        derivedFromCount: null,
        createdAt: NOW + 100,
        updatedAt: NOW + 200,
      },
    ]);

    await database.insert(memoryEdges).values({
      id: "memory-edge-1",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      fromId: branchMemoryId,
      toId: chatMemoryId,
      relation: "derived_from",
      createdAt: NOW + 200,
    });

    return {
      characterId,
      presetId,
      worldbookId,
      regexProfileId,
      sessionId,
      altFloorId,
    };
  }

  it("exports, previews, restores, and keeps branch-aware session truth", async () => {
    const built = await createBackupApp();
    const seeded = await seedCoreAssets(built.database);
    const worker = new BackupWorker(built.database, {
      artifactDir,
      pollIntervalMs: 60_000,
      workerId: "backup-worker-test",
      exportArtifactTtlMs: 60_000,
    });

    const createExportResponse = await built.app.inject({
      method: "POST",
      url: "/backup/jobs/export",
      payload: {
        session_ids: [seeded.sessionId],
        include_linked_assets: true,
      },
    });

    expect(createExportResponse.statusCode).toBe(202);
    const exportJobId = JSON.parse(createExportResponse.body).data.job_id as string;

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const detailResponse = await built.app.inject({
      method: "GET",
      url: `/backup-jobs/${exportJobId}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    const detailBody = JSON.parse(detailResponse.body);
    expect(detailBody.data.job_kind).toBe("export_core_assets");
    expect(detailBody.data.result.counts.sessions).toBe(1);
    expect(detailBody.data.result.counts.branch_local_variable_snapshots).toBe(1);

    const downloadResponse = await built.app.inject({
      method: "GET",
      url: `/backup-jobs/${exportJobId}/file`,
    });
    expect(downloadResponse.statusCode).toBe(200);
    const backupFile = JSON.parse(downloadResponse.body) as ThBackupFile;
    expect(backupFile.spec).toBe("tavern_headless_backup");
    expect(backupFile.sessions).toHaveLength(1);
    expect(backupFile.resources.presets).toHaveLength(1);
    expect(backupFile.resources.presets[0]?.versions).toHaveLength(1);
    expect(backupFile.resources.worldbooks[0]?.versions).toHaveLength(1);
    expect(backupFile.resources.regex_profiles).toHaveLength(1);
    expect(backupFile.resources.regex_profiles[0]?.versions).toHaveLength(1);
    expect(backupFile.sessions[0]?.profile_binding.deep_binding).toBe(true);
    expect(backupFile.sessions[0]?.profile_binding.preset_version_id_ref).toBe("presetver-1");
    expect(backupFile.sessions[0]?.profile_binding.worldbook_version_id_ref).toBe("wbver-1");
    expect(backupFile.sessions[0]?.profile_binding.regex_profile_version_id_ref).toBe("regexver-1");

    const previewResponse = await built.app.inject({
      method: "POST",
      url: "/backup/restore/preview",
      payload: {
        data: backupFile,
      },
    });
    expect(previewResponse.statusCode).toBe(200);
    const previewBody = JSON.parse(previewResponse.body);
    expect(previewBody.data.counts.sessions).toBe(1);
    expect(previewBody.data.renamed_resources.length).toBeGreaterThan(0);
    expect(previewBody.data.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "restore_drops_user_binding" }),
      ]),
    );
    expect(previewBody.data.counts.preset_versions).toBe(1);
    expect(previewBody.data.counts.worldbook_versions).toBe(1);
    expect(previewBody.data.counts.regex_profile_versions).toBe(1);
    expect(previewBody.data.dropped_bindings.presets).toBe(0);
    expect(previewBody.data.dropped_bindings.regex_profiles).toBe(0);

    const createRestoreResponse = await built.app.inject({
      method: "POST",
      url: "/backup/jobs/restore",
      payload: {
        data: backupFile,
        mode: "create_copy",
      },
    });
    expect(createRestoreResponse.statusCode).toBe(202);
    const restoreJobId = JSON.parse(createRestoreResponse.body).data.job_id as string;

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const restoreDetailResponse = await built.app.inject({
      method: "GET",
      url: `/backup-jobs/${restoreJobId}`,
    });
    expect(restoreDetailResponse.statusCode).toBe(200);
    const restoreDetailBody = JSON.parse(restoreDetailResponse.body);
    expect(restoreDetailBody.data.result.created.sessions).toBe(1);
    expect(restoreDetailBody.data.result.created.preset_versions).toBe(1);
    expect(restoreDetailBody.data.result.created.worldbook_versions).toBe(1);
    expect(restoreDetailBody.data.result.created.regex_profile_versions).toBe(1);
    expect(restoreDetailBody.data.result.created.branch_local_variable_snapshots).toBe(1);
    expect(restoreDetailBody.data.result.created.runtime_scope_states).toBeGreaterThan(0);

    const sessionRows = await built.database.select().from(sessions).where(eq(sessions.accountId, DEFAULT_ADMIN_ACCOUNT_ID));
    expect(sessionRows).toHaveLength(2);
    const restoredSession = sessionRows.find((row) => row.id !== seeded.sessionId);
    expect(restoredSession).toBeDefined();
    expect(restoredSession?.title).toContain("(restored)");
    expect(restoredSession?.characterId).not.toBeNull();
    expect(restoredSession?.characterId).not.toBe(seeded.characterId);
    expect(restoredSession?.worldbookProfileId).not.toBe(seeded.worldbookId);
    expect(restoredSession?.presetId).not.toBeNull();
    expect(restoredSession?.presetId).not.toBe(seeded.presetId);
    expect(restoredSession?.regexProfileId).not.toBeNull();
    expect(restoredSession?.regexProfileId).not.toBe(seeded.regexProfileId);
    expect(restoredSession?.deepBinding).toBe(true);
    expect(restoredSession?.presetVersionId).not.toBeNull();
    expect(restoredSession?.worldbookVersionId).not.toBeNull();
    expect(restoredSession?.regexProfileVersionId).not.toBeNull();
    expect(restoredSession?.userId).toBeNull();

    const restoredCharacter = await built.database.select().from(characters).where(and(
      eq(characters.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
      like(characters.name, "%(restored)%"),
    ));
    expect(restoredCharacter.length).toBeGreaterThan(0);

    const restoredWorldbook = await built.database.select().from(worldbooks).where(and(
      eq(worldbooks.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
      like(worldbooks.name, "%(restored)%"),
    ));
    expect(restoredWorldbook.length).toBeGreaterThan(0);

    const restoredBranches = await built.database.select().from(sessionBranches).where(eq(sessionBranches.sessionId, restoredSession!.id));
    expect(restoredBranches.map((row) => row.branchId).sort()).toEqual(["alt", "main"]);

    const restoredAltFloor = await built.database.select().from(floors).where(and(
      eq(floors.sessionId, restoredSession!.id),
      eq(floors.branchId, "alt"),
    ));
    expect(restoredAltFloor).toHaveLength(1);

    const restoredBranchScopeId = buildBranchVariableScopeId(restoredSession!.id, "alt");
    const restoredBranchVariables = await built.database.select().from(variables).where(and(
      eq(variables.scope, "branch"),
      eq(variables.scopeId, restoredBranchScopeId),
      eq(variables.key, "mood"),
    ));
    expect(restoredBranchVariables).toHaveLength(1);
    expect(JSON.parse(restoredBranchVariables[0]!.valueJson)).toBe("branch-mood");

    const snapshot = new BranchLocalVariableSnapshotService(built.database).getFloorLocalSnapshot({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      floorId: restoredAltFloor[0]!.id,
    });
    expect(snapshot?.values).toEqual({ mood: "branch-local" });

    const restoredBranchMemoryScopeId = buildBranchMemoryScopeId(restoredSession!.id, "alt");
    const restoredBranchMemories = await built.database.select().from(memoryItems).where(and(
      eq(memoryItems.scope, "branch"),
      eq(memoryItems.scopeId, restoredBranchMemoryScopeId),
    ));
    expect(restoredBranchMemories).toHaveLength(1);

    const runtimeScopeKey = buildMemoryRuntimeScopeKey("branch", restoredBranchMemoryScopeId);
    const runtimeScopeRows = await built.database.select().from(runtimeScopeStates).where(and(
      eq(runtimeScopeStates.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
      eq(runtimeScopeStates.scopeType, MEMORY_RUNTIME_SCOPE_TYPE),
      eq(runtimeScopeStates.scopeKey, runtimeScopeKey),
    ));
    expect(runtimeScopeRows).toHaveLength(1);

    const listResponse = await built.app.inject({
      method: "GET",
      url: "/backup-jobs",
    });
    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body).data).toHaveLength(2);
  });

  it("supports cancel and retry projections for backup jobs", async () => {
    const built = await createBackupApp();

    const createResponse = await built.app.inject({
      method: "POST",
      url: "/backup/jobs/export",
      payload: {},
    });
    expect(createResponse.statusCode).toBe(202);
    const jobId = JSON.parse(createResponse.body).data.job_id as string;

    const cancelResponse = await built.app.inject({
      method: "POST",
      url: `/backup-jobs/${jobId}/cancel`,
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(JSON.parse(cancelResponse.body).data.status).toBe("cancelled");

    const retryResponse = await built.app.inject({
      method: "POST",
      url: `/backup-jobs/${jobId}/retry`,
    });
    expect(retryResponse.statusCode).toBe(200);
    expect(JSON.parse(retryResponse.body).data.status).toBe("retry_waiting");

    const filteredListResponse = await built.app.inject({
      method: "GET",
      url: "/backup-jobs?job_kind=export_core_assets",
    });
    expect(filteredListResponse.statusCode).toBe(200);
    const filteredList = JSON.parse(filteredListResponse.body);
    expect(filteredList.data).toHaveLength(1);
    expect(filteredList.data[0].job_kind).toBe("export_core_assets");
  });
});

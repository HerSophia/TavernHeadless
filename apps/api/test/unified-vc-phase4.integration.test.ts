import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { buildApp } from "../src/app.js";
import type { DatabaseConnection } from "../src/db/client.js";
import {
  branchLocalVariableSnapshots,
  floorResultSnapshots,
  floorRunStates,
  floors,
  messagePages,
  messages,
  operationLogs,
  presetVersions,
  presets,
  promptRuntimeExplainSnapshots,
  promptSnapshots,
  vcTags,
} from "../src/db/schema.js";

type ItemResponse<T> = { data: T };

describe("unified VC phase 4 routes", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection["db"];

  beforeEach(async () => {
    ({ app, database } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    await app.close();
  });

  async function createSession(): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "phase 4" },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  async function createFloor(args: {
    branchId?: string;
    floorNo: number;
    parentFloorId?: string;
    sessionId: string;
    state?: "committed" | "draft" | "failed" | "generating";
  }): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        branch_id: args.branchId ?? "main",
        floor_no: args.floorNo,
        parent_floor_id: args.parentFloorId,
        session_id: args.sessionId,
        state: args.state ?? "committed",
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  async function seedPresetVersions(): Promise<{ presetId: string; version1Id: string; version2Id: string }> {
    const now = Date.now();
    const presetId = "preset-phase4";
    const version1Id = "preset-phase4-v1";
    const version2Id = "preset-phase4-v2";
    await database.insert(presets).values({
      id: presetId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: "Phase 4 Preset",
      source: "test",
      dataJson: JSON.stringify({ temperature: 0.9 }),
      version: 2,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(presetVersions).values({
      id: version1Id,
      presetId,
      parentVersionId: null,
      versionNo: 1,
      dataJson: JSON.stringify({ temperature: 0.7 }),
      contentHash: "sha256:preset-phase4-v1",
      createdAt: now - 10,
    });
    await database.insert(presetVersions).values({
      id: version2Id,
      presetId,
      parentVersionId: version1Id,
      versionNo: 2,
      dataJson: JSON.stringify({ temperature: 0.9 }),
      contentHash: "sha256:preset-phase4-v2",
      createdAt: now,
    });

    return { presetId, version1Id, version2Id };
  }

  async function seedClonePayload(args: { floorId: string; sessionId: string; branchId: string }): Promise<{
    assistantMessageId: string;
    outputPageId: string;
    promptDigest: string;
  }> {
    const now = Date.now();
    const inputPageId = `${args.floorId}-input-page`;
    const outputPageId = `${args.floorId}-output-page`;
    const userMessageId = `${args.floorId}-user-message`;
    const assistantMessageId = `${args.floorId}-assistant-message`;
    const promptDigest = `sha256:${args.floorId}:prompt`;

    await database.insert(messagePages).values({
      id: inputPageId,
      floorId: args.floorId,
      pageNo: 0,
      pageKind: "input",
      isActive: true,
      version: 1,
      checksum: "input-checksum",
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(messagePages).values({
      id: outputPageId,
      floorId: args.floorId,
      pageNo: 1,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: "output-checksum",
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(messages).values({
      id: userMessageId,
      pageId: inputPageId,
      seq: 0,
      role: "user",
      content: "hello",
      contentFormat: "text",
      tokenCount: 1,
      isHidden: false,
      source: "test",
      createdAt: now,
    });
    await database.insert(messages).values({
      id: assistantMessageId,
      pageId: outputPageId,
      seq: 0,
      role: "assistant",
      content: "world",
      contentFormat: "markdown",
      tokenCount: 2,
      isHidden: false,
      source: "test",
      createdAt: now,
    });
    await database.insert(promptSnapshots).values({
      floorId: args.floorId,
      sessionId: args.sessionId,
      presetId: null,
      presetUpdatedAt: null,
      presetVersion: null,
      presetVersionId: null,
      presetContentHash: null,
      worldbookId: null,
      worldbookUpdatedAt: null,
      worldbookVersion: null,
      worldbookVersionId: null,
      worldbookContentHash: null,
      regexProfileId: null,
      regexProfileUpdatedAt: null,
      regexProfileVersion: null,
      regexProfileVersionId: null,
      regexProfileContentHash: null,
      characterId: null,
      characterVersionId: null,
      characterImportedFormat: null,
      characterContentHash: null,
      worldbookActivatedEntryUidsJson: "[]",
      worldbookActivatedEntriesJson: "[]",
      regexPreRuleNamesJson: "[]",
      regexPostRuleNamesJson: "[]",
      promptMode: "compat_plus",
      assetManifestDigest: "sha256:manifest",
      promptDigest,
      tokenEstimate: 12,
      createdAt: now,
    });
    await database.insert(floorResultSnapshots).values({
      floorId: args.floorId,
      outputPageId,
      assistantMessageId,
      generatedText: "world",
      summariesJson: JSON.stringify(["summary"]),
      usageJson: JSON.stringify({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }),
      verifierJson: null,
      committedAt: now,
      updatedAt: now,
    });
    await database.insert(promptRuntimeExplainSnapshots).values({
      id: `${args.floorId}-explain`,
      floorId: args.floorId,
      sessionId: args.sessionId,
      targetBranchId: args.branchId,
      sourceFloorId: args.floorId,
      historySourceBranchId: args.branchId,
      historySourceMode: "existing_branch",
      snapshotVersion: 1,
      assetsJson: "{}",
      memoryJson: null,
      resolvedPolicyJson: "{}",
      sourceMapJson: "{}",
      diagnosticsJson: "[]",
      trimReasonsJson: "[]",
      excludedSourcesJson: "[]",
      sectionStatsJson: "[]",
      createdAt: now,
    });
    await database.insert(branchLocalVariableSnapshots).values({
      floorId: args.floorId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId: args.sessionId,
      branchId: args.branchId,
      valuesJson: JSON.stringify({ mood: "calm" }),
      snapshotVersion: 2,
      provenanceJson: JSON.stringify({ mood: { source: "test" } }),
      createdAt: now,
    });

    return { assistantMessageId, outputPageId, promptDigest };
  }

  it("resets a branch by superseding later live floors and recording an operation log", async () => {
    const sessionId = await createSession();
    const floor0 = await createFloor({ sessionId, floorNo: 0 });
    const floor1 = await createFloor({ sessionId, floorNo: 1, parentFloorId: floor0 });
    const floor2 = await createFloor({ sessionId, floorNo: 2, parentFloorId: floor1 });

    const response = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/branches/main/reset`,
      payload: {
        target_floor_id: floor1,
        expected_head_floor_id: floor2,
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      data: {
        branch_id: "main",
        expected_head_floor_id: floor2,
        session_id: sessionId,
        superseded_count: 1,
        superseded_floor_ids: [floor2],
        target_floor_id: floor1,
      },
    });

    const resetFloor = await database.select().from(floors).where(eq(floors.id, floor2)).get();
    expect(resetFloor?.supersededByFloorId).toBe(floor1);
    expect(resetFloor?.supersededAt).toEqual(expect.any(Number));

    const targetFloor = await database.select().from(floors).where(eq(floors.id, floor1)).get();
    expect(targetFloor?.supersededAt).toBeNull();

    const log = await database
      .select()
      .from(operationLogs)
      .where(and(eq(operationLogs.sessionId, sessionId), eq(operationLogs.action, "reset_branch")))
      .get();
    expect(log?.targetType).toBe("session_branch");
    expect(log?.targetId).toBe(`${sessionId}:main`);
    expect(log?.floorId).toBe(floor1);
    expect(JSON.parse(log?.afterRefJson ?? "{}").head_floor_id).toBe(floor1);
  });

  it("rejects reset when the expected branch head is stale", async () => {
    const sessionId = await createSession();
    const floor0 = await createFloor({ sessionId, floorNo: 0 });
    const floor1 = await createFloor({ sessionId, floorNo: 1, parentFloorId: floor0 });

    const response = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/branches/main/reset`,
      payload: {
        target_floor_id: floor0,
        expected_head_floor_id: floor0,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("branch_head_conflict");

    const headFloor = await database.select().from(floors).where(eq(floors.id, floor1)).get();
    expect(headFloor?.supersededAt).toBeNull();
  });

  it("previews a fast-forward branch merge", async () => {
    const sessionId = await createSession();
    const floor0 = await createFloor({ sessionId, floorNo: 0 });
    const floor1 = await createFloor({ sessionId, floorNo: 1, parentFloorId: floor0 });
    const sourceFloor = await createFloor({ sessionId, branchId: "feature", floorNo: 2, parentFloorId: floor1 });

    const response = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/branches/feature/merge/preview`,
      payload: { target_branch_id: "main" },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<ItemResponse<{
      can_merge: boolean;
      fork_floor_id: string;
      source_head_floor_id: string;
      source_only_floors: Array<{ id: string }>;
      strategy: string;
      target_head_floor_id: string;
    }>>();
    expect(body.data.can_merge).toBe(true);
    expect(body.data.strategy).toBe("fast_forward");
    expect(body.data.fork_floor_id).toBe(floor1);
    expect(body.data.source_head_floor_id).toBe(sourceFloor);
    expect(body.data.target_head_floor_id).toBe(floor1);
    expect(body.data.source_only_floors.map((floor) => floor.id)).toEqual([sourceFloor]);
  });

  it("previews a no-op merge when the source branch is already included in the target branch", async () => {
    const sessionId = await createSession();
    const floor0 = await createFloor({ sessionId, floorNo: 0 });
    const floor1 = await createFloor({ sessionId, floorNo: 1, parentFloorId: floor0 });
    await createFloor({ sessionId, branchId: "feature", floorNo: 2, parentFloorId: floor1 });

    const response = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/branches/main/merge/preview`,
      payload: { target_branch_id: "feature" },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<ItemResponse<{
      can_merge: boolean;
      source_only_floors: Array<{ id: string }>;
      strategy: string;
      target_only_floors: Array<{ id: string }>;
    }>>();
    expect(body.data.can_merge).toBe(true);
    expect(body.data.strategy).toBe("no_op");
    expect(body.data.source_only_floors).toEqual([]);
    expect(body.data.target_only_floors).toHaveLength(1);
  });

  it("rejects merge when target head CAS is stale", async () => {
    const sessionId = await createSession();
    const floor0 = await createFloor({ sessionId, floorNo: 0 });
    const floor1 = await createFloor({ sessionId, floorNo: 1, parentFloorId: floor0 });
    await createFloor({ sessionId, branchId: "feature", floorNo: 2, parentFloorId: floor1 });

    const response = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/branches/feature/merge`,
      payload: {
        expected_target_head_floor_id: floor0,
        target_branch_id: "main",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("branch_head_conflict");
  });

  it("blocks merge when the target branch diverged", async () => {
    const sessionId = await createSession();
    const floor0 = await createFloor({ sessionId, floorNo: 0 });
    const floor1 = await createFloor({ sessionId, floorNo: 1, parentFloorId: floor0 });
    const mainFloor2 = await createFloor({ sessionId, floorNo: 2, parentFloorId: floor1 });
    await createFloor({ sessionId, branchId: "feature", floorNo: 2, parentFloorId: floor1 });

    const response = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/branches/feature/merge/preview`,
      payload: { target_branch_id: "main" },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<ItemResponse<{ can_merge: boolean; conflicts: Array<{ code: string; target_floor_id?: string }>; strategy: string }>>();
    expect(body.data.can_merge).toBe(false);
    expect(body.data.strategy).toBe("blocked");
    expect(body.data.conflicts).toContainEqual(expect.objectContaining({
      code: "target_diverged",
      target_floor_id: mainFloor2,
    }));
  });

  it("detects non-committed source floors and active runs during merge preview", async () => {
    const sessionId = await createSession();
    const floor0 = await createFloor({ sessionId, floorNo: 0 });
    const floor1 = await createFloor({ sessionId, floorNo: 1, parentFloorId: floor0 });
    const draftFloor = await createFloor({ sessionId, branchId: "feature", floorNo: 2, parentFloorId: floor1, state: "draft" });
    const now = Date.now();
    await database.insert(floorRunStates).values({
      floorId: draftFloor,
      runId: "run-feature",
      runType: "respond",
      status: "running",
      phase: "input_recorded",
      publicPhase: "preparing",
      phaseSeq: 0,
      attemptNo: 1,
      pendingOutputJson: null,
      verifierJson: null,
      errorJson: null,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    });

    const response = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/branches/feature/merge/preview`,
      payload: { target_branch_id: "main" },
    });

    expect(response.statusCode, response.body).toBe(200);
    const conflicts = response.json<ItemResponse<{ conflicts: Array<{ code: string; source_floor_id?: string }> }>>().data.conflicts;
    expect(conflicts).toContainEqual(expect.objectContaining({
      code: "source_floor_not_committed",
      source_floor_id: draftFloor,
    }));
    expect(conflicts).toContainEqual(expect.objectContaining({ code: "source_branch_busy" }));
  });

  it("merges a fast-forward branch by cloning messages, snapshots, and operation log", async () => {
    const sessionId = await createSession();
    const floor0 = await createFloor({ sessionId, floorNo: 0 });
    const floor1 = await createFloor({ sessionId, floorNo: 1, parentFloorId: floor0 });
    const sourceFloor = await createFloor({ sessionId, branchId: "feature", floorNo: 2, parentFloorId: floor1 });
    const sourcePayload = await seedClonePayload({ branchId: "feature", floorId: sourceFloor, sessionId });

    const response = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/branches/feature/merge`,
      payload: {
        expected_target_head_floor_id: floor1,
        target_branch_id: "main",
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<ItemResponse<{ merged_count: number; merged_floor_ids: string[]; operation_id: string; strategy: string }>>();
    expect(body.data.strategy).toBe("fast_forward");
    expect(body.data.merged_count).toBe(1);
    expect(body.data.merged_floor_ids).toHaveLength(1);
    expect(body.data.merged_floor_ids[0]).not.toBe(sourceFloor);

    const mergedFloorId = body.data.merged_floor_ids[0]!;
    const mergedFloor = await database.select().from(floors).where(eq(floors.id, mergedFloorId)).get();
    expect(mergedFloor).toEqual(expect.objectContaining({
      branchId: "main",
      floorNo: 2,
      parentFloorId: floor1,
      state: "committed",
    }));

    const clonedPages = await database.select().from(messagePages).where(eq(messagePages.floorId, mergedFloorId)).all();
    expect(clonedPages).toHaveLength(2);
    expect(clonedPages.map((page) => page.id)).not.toContain(sourcePayload.outputPageId);

    const clonedMessages = await database
      .select()
      .from(messages)
      .where(inArray(messages.pageId, clonedPages.map((page) => page.id)))
      .all();
    expect(clonedMessages).toHaveLength(2);
    expect(clonedMessages.map((message) => message.id)).not.toContain(sourcePayload.assistantMessageId);
    expect(clonedMessages.map((message) => message.content).sort()).toEqual(["hello", "world"]);

    const clonedPromptSnapshot = await database.select().from(promptSnapshots).where(eq(promptSnapshots.floorId, mergedFloorId)).get();
    expect(clonedPromptSnapshot?.promptDigest).toBe(sourcePayload.promptDigest);

    const clonedResultSnapshot = await database.select().from(floorResultSnapshots).where(eq(floorResultSnapshots.floorId, mergedFloorId)).get();
    expect(clonedResultSnapshot?.outputPageId).not.toBe(sourcePayload.outputPageId);
    expect(clonedResultSnapshot?.assistantMessageId).not.toBe(sourcePayload.assistantMessageId);

    const clonedExplain = await database.select().from(promptRuntimeExplainSnapshots).where(eq(promptRuntimeExplainSnapshots.floorId, mergedFloorId)).get();
    expect(clonedExplain?.targetBranchId).toBe("main");
    expect(clonedExplain?.sourceFloorId).toBe(mergedFloorId);

    const clonedVariables = await database.select().from(branchLocalVariableSnapshots).where(eq(branchLocalVariableSnapshots.floorId, mergedFloorId)).get();
    expect(clonedVariables?.branchId).toBe("main");
    expect(JSON.parse(clonedVariables?.valuesJson ?? "{}")).toEqual({ mood: "calm" });

    const log = await database.select().from(operationLogs).where(eq(operationLogs.id, body.data.operation_id)).get();
    expect(log?.action).toBe("merge_branch");
    expect(log?.targetId).toBe(`${sessionId}:main`);
    expect(JSON.parse(log?.afterRefJson ?? "{}").merged_floor_ids).toEqual([mergedFloorId]);
  });

  it("creates VC tags for floors and asset versions", async () => {
    const sessionId = await createSession();
    const floorId = await createFloor({ sessionId, floorNo: 0 });
    const { version1Id } = await seedPresetVersions();

    const floorTagResponse = await app.inject({
      method: "POST",
      url: "/vc-tags",
      payload: {
        name: "important-floor",
        target_type: "floor",
        target_id: floorId,
        metadata: { note: "keep" },
      },
    });
    expect(floorTagResponse.statusCode, floorTagResponse.body).toBe(201);
    expect(floorTagResponse.json<ItemResponse<{ session_id: string; created_by_operation_id: string }>>().data.session_id).toBe(sessionId);
    expect(floorTagResponse.json<ItemResponse<{ created_by_operation_id: string }>>().data.created_by_operation_id).toEqual(expect.any(String));

    const versionTagResponse = await app.inject({
      method: "POST",
      url: "/vc-tags",
      payload: {
        name: "important-version",
        target_type: "asset_version",
        target_id: version1Id,
      },
    });
    expect(versionTagResponse.statusCode, versionTagResponse.body).toBe(201);
    expect(versionTagResponse.json<ItemResponse<{ session_id: string | null }>>().data.session_id).toBeNull();

    const listResponse = await app.inject({
      method: "GET",
      url: `/vc-tags?target_type=asset_version&target_id=${version1Id}`,
    });
    expect(listResponse.statusCode, listResponse.body).toBe(200);
    expect(listResponse.json<{ data: Array<{ name: string }> }>().data.map((tag) => tag.name)).toEqual(["important-version"]);

    const tagRows = await database.select().from(vcTags).all();
    expect(tagRows).toHaveLength(2);

    const logs = await database.select().from(operationLogs).where(eq(operationLogs.action, "create_tag")).all();
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.targetType === "vc_tag")).toBe(true);
  });

  it("compares preset versions and rolls back by creating a new version", async () => {
    const { presetId, version1Id, version2Id } = await seedPresetVersions();

    const compareResponse = await app.inject({
      method: "POST",
      url: `/presets/${presetId}/versions/compare`,
      payload: {
        left_version_id: version1Id,
        right_version_id: version2Id,
      },
    });
    expect(compareResponse.statusCode, compareResponse.body).toBe(200);
    const compareBody = compareResponse.json<{
      data: { diff: { changes: Array<{ path: string; change_type: string }>; mode: string } };
    }>();
    expect(compareBody.data.diff.mode).toBe("summary");
    expect(compareBody.data.diff.changes).toContainEqual(expect.objectContaining({
      path: "temperature",
      change_type: "changed",
    }));

    const rollbackResponse = await app.inject({
      method: "POST",
      url: `/presets/${presetId}/versions/${version1Id}/rollback`,
      payload: { expected_version: 2 },
    });
    expect(rollbackResponse.statusCode, rollbackResponse.body).toBe(200);
    const rollbackBody = rollbackResponse.json<ItemResponse<{
      rolled_back_from_version_id: string;
      version: number;
      version_id: string;
    }>>();
    expect(rollbackBody.data.rolled_back_from_version_id).toBe(version1Id);
    expect(rollbackBody.data.version).toBe(3);

    const currentPreset = await database.select().from(presets).where(eq(presets.id, presetId)).get();
    expect(currentPreset?.version).toBe(3);
    expect(JSON.parse(currentPreset?.dataJson ?? "{}").temperature).toBe(0.7);

    const rollbackVersion = await database
      .select()
      .from(presetVersions)
      .where(and(eq(presetVersions.presetId, presetId), eq(presetVersions.versionNo, 3)))
      .get();
    expect(rollbackVersion?.id).toBe(rollbackBody.data.version_id);
    expect(rollbackVersion?.parentVersionId).toBe(version2Id);

    const log = await database
      .select()
      .from(operationLogs)
      .where(and(eq(operationLogs.targetId, presetId), eq(operationLogs.action, "rollback_preset")))
      .get();
    expect(log?.id).toBe(rollbackVersion?.createdByOperationId);
    expect(log?.metadataJson).toContain(version1Id);
  });
});

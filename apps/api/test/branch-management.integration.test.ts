import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { buildApp } from "../src/app";
import type { DatabaseConnection } from "../src/db/client.js";
import {
  operationLogs,
  presetVersions,
  presets,
  promptSnapshots,
  regexProfileVersions,
  regexProfiles,
  sessionBranches,
  worldbookVersions,
  worldbooks,
} from "../src/db/schema.js";
import { ChatHistoryLoader } from "../src/services/chat-history-loader.js";
import { ChatTargetResolver } from "../src/services/chat/target-resolver.js";
import { TurnModelService } from "../src/services/chat/turn-model-service.js";

type ItemResponse<T> = { data: T };

describe("branch management routes", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection["db"];

  beforeEach(async () => {
    ({ app, database } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  async function createSession(): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "branch test" },
    });

    expect(response.statusCode).toBe(201);
    return (response.json() as ItemResponse<{ id: string }>).data.id;
  }

  async function createFloor(args: {
    sessionId: string;
    floorNo: number;
    branchId: string;
    state?: "draft" | "generating" | "committed" | "failed";
    parentFloorId?: string;
  }): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        session_id: args.sessionId,
        floor_no: args.floorNo,
        branch_id: args.branchId,
        state: args.state ?? "committed",
        ...(args.parentFloorId ? { parent_floor_id: args.parentFloorId } : {}),
      },
    });

    expect(response.statusCode).toBe(201);
    return (response.json() as ItemResponse<{ id: string }>).data.id;
  }

  async function seedPromptAssetVersions(now: number) {
    await database.insert(presets).values({
      id: "preset-checkout",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: "Checkout Preset",
      source: "test",
      dataJson: JSON.stringify({ prompts: [], prompt_order: [] }),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(worldbooks).values({
      id: "worldbook-checkout",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: "Checkout Worldbook",
      source: "test",
      dataJson: JSON.stringify({ name: "Checkout Worldbook" }),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(regexProfiles).values({
      id: "regex-checkout",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: "Checkout Regex",
      source: "test",
      dataJson: JSON.stringify([]),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(presetVersions).values({
      id: "preset-version-checkout",
      presetId: "preset-checkout",
      parentVersionId: null,
      versionNo: 1,
      dataJson: JSON.stringify({ prompts: [], prompt_order: [] }),
      contentHash: "sha256:preset-checkout",
      createdAt: now,
    });
    await database.insert(worldbookVersions).values({
      id: "worldbook-version-checkout",
      worldbookId: "worldbook-checkout",
      parentVersionId: null,
      versionNo: 1,
      dataJson: JSON.stringify({ name: "Checkout Worldbook", entries: [] }),
      contentHash: "sha256:worldbook-checkout",
      createdAt: now,
    });
    await database.insert(regexProfileVersions).values({
      id: "regex-version-checkout",
      regexProfileId: "regex-checkout",
      parentVersionId: null,
      versionNo: 1,
      dataJson: JSON.stringify([]),
      contentHash: "sha256:regex-checkout",
      createdAt: now,
    });

    return {
      presetId: "preset-checkout",
      presetVersionId: "preset-version-checkout",
      worldbookId: "worldbook-checkout",
      worldbookVersionId: "worldbook-version-checkout",
      regexProfileId: "regex-checkout",
      regexProfileVersionId: "regex-version-checkout",
    };
  }


  it("lists the default main branch even before any floor is created", async () => {
    const sessionId = await createSession();

    const response = await app.inject({ method: "GET", url: `/sessions/${sessionId}/branches` });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: Array<{
        branch_id: string;
        floor_count: number;
        latest_floor_no: number | null;
        latest_floor_id: string | null;
        latest_state: string | null;
      }>;
    };

    expect(body.data).toEqual([
      { branch_id: "main", floor_count: 0, latest_floor_no: null, latest_floor_id: null, latest_state: null, updated_at: expect.any(Number) },
    ]);
  });

  it("lists branches for a session", async () => {
    const sessionId = await createSession();

    await createFloor({ sessionId, floorNo: 0, branchId: "main" });
    await createFloor({ sessionId, floorNo: 1, branchId: "main" });
    await createFloor({ sessionId, floorNo: 1, branchId: "alt" });

    const response = await app.inject({ method: "GET", url: `/sessions/${sessionId}/branches` });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: Array<{ branch_id: string; floor_count: number; latest_floor_no: number | null }>;
    };

    const main = body.data.find((row) => row.branch_id === "main");
    const alt = body.data.find((row) => row.branch_id === "alt");

    expect(main).toBeDefined();
    expect(main?.floor_count).toBe(2);
    expect(alt).toBeDefined();
    expect(alt?.latest_floor_no).toBe(1);
  });

  it("returns branch diff against main", async () => {
    const sessionId = await createSession();

    // 通过真实 parent_floor_id 链构造 ancestry：
    //   main: f0 → f1
    //   alt:  f0 → alt_f1 → alt_f2
    // 两支在 f0 处分叉，diff 的 fork 应落在 f0（floor_no=0）。
    const mainF0 = await createFloor({ sessionId, floorNo: 0, branchId: "main" });
    await createFloor({ sessionId, floorNo: 1, branchId: "main", parentFloorId: mainF0 });
    const altF1 = await createFloor({
      sessionId,
      floorNo: 1,
      branchId: "alt",
      parentFloorId: mainF0,
    });
    await createFloor({ sessionId, floorNo: 2, branchId: "alt", parentFloorId: altF1 });

    const response = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/branches/diff?target_branch_id=alt`,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: {
        base_branch_id: string;
        target_branch_id: string;
        fork_floor_no: number | null;
        shared_floor_nos: number[];
      };
    };

    expect(body.data.base_branch_id).toBe("main");
    expect(body.data.target_branch_id).toBe("alt");
    // ancestry-based diff：两支在 f0 处是真实共同祖先。
    expect(body.data.fork_floor_no).toBe(0);
    expect(body.data.shared_floor_nos).toEqual([0]);
  });

  it("checks out a committed floor into a non-destructive branch with asset version refs and operation log", async () => {
    const sessionId = await createSession();
    const now = Date.now();
    const assetRefs = await seedPromptAssetVersions(now);
    const sourceFloorId = await createFloor({ sessionId, floorNo: 0, branchId: "main" });
    const laterFloorId = await createFloor({
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: sourceFloorId,
    });

    await database.insert(promptSnapshots).values({
      floorId: sourceFloorId,
      sessionId,
      presetId: assetRefs.presetId,
      presetUpdatedAt: now,
      presetVersion: 1,
      presetVersionId: assetRefs.presetVersionId,
      presetContentHash: "sha256:preset-checkout",
      worldbookId: assetRefs.worldbookId,
      worldbookUpdatedAt: now,
      worldbookVersion: 1,
      worldbookVersionId: assetRefs.worldbookVersionId,
      worldbookContentHash: "sha256:worldbook-checkout",
      regexProfileId: assetRefs.regexProfileId,
      regexProfileUpdatedAt: now,
      regexProfileVersion: 1,
      regexProfileVersionId: assetRefs.regexProfileVersionId,
      regexProfileContentHash: "sha256:regex-checkout",
      promptMode: "compat_strict",
      assetManifestDigest: "sha256:asset-manifest",
      promptDigest: "sha256:prompt-checkout",
      tokenEstimate: 12,
      createdAt: now,
    });

    const response = await app.inject({
      method: "POST",
      url: `/floors/${sourceFloorId}/branch`,
      payload: { branch_id: "checkout-1" },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toEqual({
      data: {
        branch_id: "checkout-1",
        source_floor_id: sourceFloorId,
        source_floor_no: 0,
        session_id: sessionId,
      },
    });

    const [branchRow] = await database
      .select()
      .from(sessionBranches)
      .where(eq(sessionBranches.branchId, "checkout-1"));
    expect(branchRow).toMatchObject({
      sessionId,
      sourceFloorId,
      sourceBranchId: "main",
      assetBindingDeepBinding: true,
      assetBindingPresetId: assetRefs.presetId,
      assetBindingPresetVersionId: assetRefs.presetVersionId,
      assetBindingWorldbookProfileId: assetRefs.worldbookId,
      assetBindingWorldbookVersionId: assetRefs.worldbookVersionId,
      assetBindingRegexProfileId: assetRefs.regexProfileId,
      assetBindingRegexProfileVersionId: assetRefs.regexProfileVersionId,
    });

    const branchContext = await new ChatTargetResolver(
      database,
      new ChatHistoryLoader(database),
      (code, message) => new Error(`${code}:${message}`),
    ).resolveRespondBranchContext(sessionId, "checkout-1", undefined, DEFAULT_ADMIN_ACCOUNT_ID);
    expect(branchContext).toMatchObject({
      branchExists: false,
      historySourceBranchId: "main",
      historySourceMode: "source_floor_branch",
      nextFloorNo: 1,
      parentFloorId: sourceFloorId,
      inheritanceSource: { floorId: sourceFloorId, branchId: "main" },
      assetBinding: {
        deepBinding: true,
        presetVersionId: assetRefs.presetVersionId,
        worldbookVersionId: assetRefs.worldbookVersionId,
        regexProfileVersionId: assetRefs.regexProfileVersionId,
      },
    });
    const sessionInfo = new TurnModelService({
      enableAsyncMemoryIngest: false,
      enableMemoryConsolidationByDefault: false,
      executionTimeoutMs: 60_000,
      memoryStoreEnabled: false,
    }).buildSessionPromptInfo({
      presetId: null,
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterSnapshotJson: null,
      promptMode: null,
      userSnapshotJson: null,
    }, {}, undefined, branchContext.assetBinding);
    expect(sessionInfo.deepBinding).toBe(true);
    expect(sessionInfo.presetVersionId).toBe(assetRefs.presetVersionId);
    expect(sessionInfo.worldbookVersionId).toBe(assetRefs.worldbookVersionId);
    expect(sessionInfo.regexProfileVersionId).toBe(assetRefs.regexProfileVersionId);

    const sourceAfter = await app.inject({ method: "GET", url: `/floors/${sourceFloorId}` });
    const laterAfter = await app.inject({ method: "GET", url: `/floors/${laterFloorId}` });
    expect(sourceAfter.statusCode).toBe(200);
    expect(laterAfter.statusCode).toBe(200);
    expect(sourceAfter.json<ItemResponse<{ superseded_at: number | null }>>().data.superseded_at).toBeNull();
    expect(laterAfter.json<ItemResponse<{ superseded_at: number | null }>>().data.superseded_at).toBeNull();

    const logsResponse = await app.inject({
      method: "GET",
      url: `/operation-logs?action=checkout_branch&target_type=session_branch&target_id=${encodeURIComponent(`${sessionId}:checkout-1`)}`,
    });
    expect(logsResponse.statusCode, logsResponse.body).toBe(200);
    const logsBody = logsResponse.json<{
      data: Array<{
        action: string;
        floor_id: string | null;
        target_type: string;
        target_id: string | null;
        after_ref: {
          binding_source?: string;
          asset_binding?: {
            preset_version_id?: string | null;
            worldbook_version_id?: string | null;
            regex_profile_version_id?: string | null;
          } | null;
        } | null;
      }>;
    }>();
    expect(logsBody.data).toHaveLength(1);
    expect(logsBody.data[0]).toMatchObject({
      action: "checkout_branch",
      floor_id: sourceFloorId,
      target_type: "session_branch",
      target_id: `${sessionId}:checkout-1`,
    });
    expect(logsBody.data[0]?.after_ref?.binding_source).toBe("prompt_snapshot_versions");
    expect(logsBody.data[0]?.after_ref?.asset_binding?.preset_version_id).toBe(assetRefs.presetVersionId);
    expect(logsBody.data[0]?.after_ref?.asset_binding?.worldbook_version_id).toBe(assetRefs.worldbookVersionId);
    expect(logsBody.data[0]?.after_ref?.asset_binding?.regex_profile_version_id).toBe(assetRefs.regexProfileVersionId);

    const rawLogs = await database.select().from(operationLogs).where(eq(operationLogs.action, "checkout_branch"));
    expect(JSON.stringify(rawLogs)).not.toContain("prompts");
  });

  it("deletes a non-main branch", async () => {
    const sessionId = await createSession();

    await createFloor({ sessionId, floorNo: 0, branchId: "main" });
    await createFloor({ sessionId, floorNo: 1, branchId: "alt" });
    await createFloor({ sessionId, floorNo: 2, branchId: "alt" });

    const response = await app.inject({
      method: "DELETE",
      url: `/branches/alt?session_id=${sessionId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        branch_id: "alt",
        session_id: sessionId,
        deleted_floor_count: 2,
      },
    });

    const floorListResponse = await app.inject({
      method: "GET",
      url: `/floors?session_id=${sessionId}&branch_id=alt`,
    });
    expect(floorListResponse.statusCode).toBe(200);
    expect((floorListResponse.json() as { data: unknown[] }).data).toHaveLength(0);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import {
  TH_CHAT_SPEC,
  TH_CHAT_SPEC_VERSION,
  buildBranchVariableScopeId,
  type ThChatFile,
} from "@tavern/shared";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  accounts,
  branchLocalVariableSnapshots,
  floors,
  messagePages,
  messages,
  sessions,
  variables,
} from "../../db/schema.js";
import { stringifyJsonField } from "../../lib/http.js";
import {
  serializeSessionToThChat,
} from "../chat-export.js";
import {
  buildThChatImportManifest,
  type ThChatImportManifest,
} from "../chat-import-manifest.js";
import {
  publishChatImportManifestInTransaction,
} from "../chat-import-publisher.js";
import {
  BRANCH_LOCAL_SNAPSHOT_SCHEMA_V1,
  BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2,
  BranchLocalSnapshotMissingError,
  BranchLocalVariableSnapshotService,
} from "../branch-local-variable-snapshot-service.js";

const NOW = 1_700_000_000_000;
const ACCOUNT_ID = DEFAULT_ADMIN_ACCOUNT_ID;

interface SeedResult {
  sessionId: string;
  floorId: string;
  pageId: string;
  messageId: string;
}

/** 构造一个带 branch_local_variable_snapshot 的最小 session。 */
function seedSessionWithSnapshot(database: DatabaseConnection): SeedResult {
  const sessionId = nanoid();
  const floorId = nanoid();
  const pageId = nanoid();
  const messageId = nanoid();

  database.db.insert(sessions).values({
    id: sessionId,
    title: "Phase3 Test",
    status: "active",
    accountId: ACCOUNT_ID,
    characterSnapshotJson: stringifyJsonField({ name: "Alice" }),
    userSnapshotJson: stringifyJsonField({ name: "Bob" }),
    characterSyncPolicy: "pin",
    metadataJson: null,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();

  database.db.insert(floors).values({
    id: floorId,
    sessionId,
    floorNo: 0,
    branchId: "main",
    parentFloorId: null,
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    metadataJson: null,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();

  database.db.insert(messagePages).values({
    id: pageId,
    floorId,
    pageNo: 0,
    pageKind: "output",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();

  database.db.insert(messages).values({
    id: messageId,
    pageId,
    seq: 0,
    role: "assistant",
    content: "Hello",
    contentFormat: "text",
    tokenCount: 1,
    isHidden: false,
    source: "narrator",
    createdAt: NOW,
  }).run();

  // 撑一点 chat/branch 变量，方便 snapshot 有真实内容
  const branchScopeId = buildBranchVariableScopeId(sessionId, "main");
  database.db.insert(variables).values({
    id: nanoid(),
    accountId: ACCOUNT_ID,
    scope: "chat",
    scopeId: sessionId,
    key: "chat_only",
    valueJson: JSON.stringify("chat-value"),
    updatedAt: NOW,
  }).run();
  database.db.insert(variables).values({
    id: nanoid(),
    accountId: ACCOUNT_ID,
    scope: "branch",
    scopeId: branchScopeId,
    key: "branch_only",
    valueJson: JSON.stringify({ coins: 5 }),
    updatedAt: NOW,
  }).run();

  // 使用 Service 持久化一份带 provenance 的 v2 快照
  const service = new BranchLocalVariableSnapshotService(database.db);
  service.persistFloorLocalSnapshot({
    accountId: ACCOUNT_ID,
    floorId,
    sessionId,
    branchId: "main",
    createdAt: NOW + 10,
  });

  return { sessionId, floorId, pageId, messageId };
}

function createManifestFromFile(file: ThChatFile, accountId: string): ThChatImportManifest {
  return buildThChatImportManifest(file, {
    accountId,
    characterBinding: {
      characterId: null,
      characterVersionId: null,
      characterSnapshotJson: null,
    },
    importedAt: NOW + 1_000,
  });
}

describe("Chat import/export branch local snapshot fidelity", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("exports branch_local_variable_snapshots with provenance and round-trips through import", async () => {
    const { sessionId, floorId } = seedSessionWithSnapshot(database);

    const exported = serializeSessionToThChat(database.db, sessionId, {
      accountId: ACCOUNT_ID,
    });

    expect(exported.spec).toBe(TH_CHAT_SPEC);
    expect(exported.spec_version).toBe(TH_CHAT_SPEC_VERSION);

    const snapshotSection = exported.data.branch_local_variable_snapshots;
    expect(snapshotSection).toBeDefined();
    expect(snapshotSection).toHaveLength(1);
    const onlySnapshot = snapshotSection![0]!;

    expect(onlySnapshot.floor_id_ref).toBe(floorId);
    expect(onlySnapshot.branch_id).toBe("main");
    expect(onlySnapshot.snapshot_version).toBe(BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2);
    expect(onlySnapshot.values).toEqual({
      chat_only: "chat-value",
      branch_only: { coins: 5 },
    });
    // chat_only 走 chat scope；branch_only 走 branch scope
    expect(onlySnapshot.provenance?.chat_only).toMatchObject({
      source_scope: "chat",
      source_scope_id_ref: null,
      origin_kind: "inherited",
    });
    expect(onlySnapshot.provenance?.branch_only).toMatchObject({
      source_scope: "branch",
      source_scope_id_ref: "main",
      origin_kind: "authored",
    });

    // ── Round-trip import ──
    const targetDatabase = createDatabase(":memory:");
    try {
      // account 设置
      await targetDatabase.db.insert(accounts).values({
        id: ACCOUNT_ID,
        name: ACCOUNT_ID,
        createdAt: NOW,
        updatedAt: NOW,
      }).onConflictDoNothing();

      const manifest = createManifestFromFile(exported, ACCOUNT_ID);
      const result = targetDatabase.db.transaction((tx) =>
        publishChatImportManifestInTransaction(tx, manifest),
      );

      const [sessionRow] = await targetDatabase.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, result.sessionId));
      expect(sessionRow).toBeTruthy();

      const [floorRow] = await targetDatabase.db
        .select()
        .from(floors)
        .where(eq(floors.sessionId, result.sessionId));
      expect(floorRow).toBeTruthy();
      const newFloorId = floorRow!.id;

      const [snapshotRow] = await targetDatabase.db
        .select()
        .from(branchLocalVariableSnapshots)
        .where(eq(branchLocalVariableSnapshots.floorId, newFloorId));
      expect(snapshotRow).toBeTruthy();
      expect(snapshotRow!.snapshotVersion).toBe(BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2);
      expect(snapshotRow!.provenanceJson).toBeTruthy();
      expect(JSON.parse(snapshotRow!.valuesJson)).toEqual({
        chat_only: "chat-value",
        branch_only: { coins: 5 },
      });

      const importedService = new BranchLocalVariableSnapshotService(targetDatabase.db);
      const reloaded = importedService.getFloorLocalSnapshot({
        accountId: ACCOUNT_ID,
        floorId: newFloorId,
      });
      expect(reloaded).not.toBeNull();
      expect(reloaded!.schemaVersion).toBe(BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2);
      expect(reloaded!.provenance.chat_only).toMatchObject({
        sourceScope: "chat",
        sourceScopeId: result.sessionId,
        originKind: "inherited",
      });
      expect(reloaded!.provenance.branch_only).toMatchObject({
        sourceScope: "branch",
        sourceScopeId: buildBranchVariableScopeId(result.sessionId, "main"),
        originKind: "authored",
      });

      // 导入后在目标 branch 上做 materialize 应能找到 source snapshot，
      // 不再抛 BranchLocalSnapshotMissingError
      const materialized = importedService.materializeFromSourceFloor({
        accountId: ACCOUNT_ID,
        sessionId: result.sessionId,
        sourceFloorId: newFloorId,
        sourceBranchId: "main",
        targetBranchId: "alt",
        createdAt: NOW + 2_000,
      });
      expect(materialized.restoredKeys.sort()).toEqual(["branch_only", "chat_only"]);
    } finally {
      targetDatabase.close();
    }
  });

  it("still imports legacy 1.0.0 files that omit branch_local_variable_snapshots (missing-snapshot fallback stays intact)", async () => {
    const legacyFile: ThChatFile = {
      spec: TH_CHAT_SPEC,
      spec_version: "1.0.0",
      exported_at: NOW,
      export_source: "legacy",
      data: {
        title: "legacy",
        status: "active",
        created_at: NOW,
        updated_at: NOW,
        character_snapshot: null,
        user_snapshot: null,
        character_sync_policy: "pin",
        preset_name: null,
        prompt_mode: null,
        model_provider: null,
        model_name: null,
        metadata: null,
        floors: [
          {
            floor_no: 0,
            branch_id: "main",
            parent_floor_id_ref: null,
            state: "committed",
            token_in: 0,
            token_out: 0,
            metadata: null,
            created_at: NOW,
            updated_at: NOW,
            _original_id: "legacy-floor-1",
            pages: [
              {
                page_no: 0,
                page_kind: "output",
                is_active: true,
                version: 1,
                checksum: null,
                created_at: NOW,
                updated_at: NOW,
                _original_id: "legacy-page-1",
                messages: [
                  {
                    seq: 0,
                    role: "assistant",
                    content: "hi",
                    content_format: "text",
                    token_count: 1,
                    is_hidden: false,
                    source: null,
                    created_at: NOW,
                    _original_id: "legacy-msg-1",
                  },
                ],
              },
            ],
          },
        ],
        // 故意不带 variables，也不带 branch_local_variable_snapshots，
        // 验证旧格式路径未被要求
      },
    };

    const targetDatabase = createDatabase(":memory:");
    try {
      await targetDatabase.db.insert(accounts).values({
        id: ACCOUNT_ID,
        name: ACCOUNT_ID,
        createdAt: NOW,
        updatedAt: NOW,
      }).onConflictDoNothing();

      const manifest = createManifestFromFile(legacyFile, ACCOUNT_ID);
      const result = targetDatabase.db.transaction((tx) =>
        publishChatImportManifestInTransaction(tx, manifest),
      );

      const [floorRow] = await targetDatabase.db
        .select()
        .from(floors)
        .where(eq(floors.sessionId, result.sessionId));
      expect(floorRow).toBeTruthy();

      const rows = await targetDatabase.db
        .select()
        .from(branchLocalVariableSnapshots)
        .where(eq(branchLocalVariableSnapshots.floorId, floorRow!.id));
      expect(rows).toHaveLength(0);

      // 旧格式导入后仍然应当保持原有语义：试图从该 floor materialize 会触发
      // BranchLocalSnapshotMissingError
      const service = new BranchLocalVariableSnapshotService(targetDatabase.db);
      expect(() => service.requireSourceFloorLocalValues({
        accountId: ACCOUNT_ID,
        sessionId: result.sessionId,
        sourceFloorId: floorRow!.id,
        sourceBranchId: "main",
      })).toThrow(BranchLocalSnapshotMissingError);
    } finally {
      targetDatabase.close();
    }
  });

  it("falls back to v1 semantics when an imported snapshot row declares snapshot_version=1", async () => {
    const file: ThChatFile = {
      spec: TH_CHAT_SPEC,
      spec_version: TH_CHAT_SPEC_VERSION,
      exported_at: NOW,
      export_source: "test",
      data: {
        title: "v1 snapshot",
        status: "active",
        created_at: NOW,
        updated_at: NOW,
        character_snapshot: null,
        user_snapshot: null,
        character_sync_policy: "pin",
        preset_name: null,
        prompt_mode: null,
        model_provider: null,
        model_name: null,
        metadata: null,
        floors: [
          {
            floor_no: 0,
            branch_id: "main",
            parent_floor_id_ref: null,
            state: "committed",
            token_in: 0,
            token_out: 0,
            metadata: null,
            created_at: NOW,
            updated_at: NOW,
            _original_id: "v1-floor",
            pages: [
              {
                page_no: 0,
                page_kind: "output",
                is_active: true,
                version: 1,
                checksum: null,
                created_at: NOW,
                updated_at: NOW,
                _original_id: "v1-page",
                messages: [
                  {
                    seq: 0,
                    role: "assistant",
                    content: "hi",
                    content_format: "text",
                    token_count: 1,
                    is_hidden: false,
                    source: null,
                    created_at: NOW,
                    _original_id: "v1-msg",
                  },
                ],
              },
            ],
          },
        ],
        branch_local_variable_snapshots: [
          {
            floor_id_ref: "v1-floor",
            branch_id: "main",
            snapshot_version: 1,
            values: { legacy_key: "legacy-value" },
            created_at: NOW + 1,
          },
        ],
      },
    };

    const targetDatabase = createDatabase(":memory:");
    try {
      await targetDatabase.db.insert(accounts).values({
        id: ACCOUNT_ID,
        name: ACCOUNT_ID,
        createdAt: NOW,
        updatedAt: NOW,
      }).onConflictDoNothing();

      const manifest = createManifestFromFile(file, ACCOUNT_ID);
      const result = targetDatabase.db.transaction((tx) =>
        publishChatImportManifestInTransaction(tx, manifest),
      );

      const [floorRow] = await targetDatabase.db
        .select()
        .from(floors)
        .where(eq(floors.sessionId, result.sessionId));
      expect(floorRow).toBeTruthy();

      const service = new BranchLocalVariableSnapshotService(targetDatabase.db);
      const reloaded = service.getFloorLocalSnapshot({
        accountId: ACCOUNT_ID,
        floorId: floorRow!.id,
      });
      expect(reloaded).not.toBeNull();
      // v1 导入：provenance 应为空，schemaVersion = 1
      expect(reloaded!.schemaVersion).toBe(BRANCH_LOCAL_SNAPSHOT_SCHEMA_V1);
      expect(reloaded!.provenance).toEqual({});
      expect(reloaded!.values).toEqual({ legacy_key: "legacy-value" });
    } finally {
      targetDatabase.close();
    }
  });
});

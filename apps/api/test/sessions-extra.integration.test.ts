/**
* sessions.ts branch coverage expansion.
 *
 * Targets:
 *POST /sessions — snapshot-only bindings, binding errors
 *   GET /sessions — status, keyword filters
 *   PATCH /sessions/:id — user binding update, not-found
 *   POST /sessions/:id/character/sync — not-found, no-op
 *   PATCH /sessions/batch/status
 *   POST /sessions/batch/delete
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { buildApp } from "../src/app";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { accounts, clientDataDomains, clientDataManagedDomains, floors, presets, regexProfiles, worldbooks } from "../src/db/schema";
import type { DatabaseConnection } from "../src/db/client";
import { SessionStateService } from "../src/session-state";

const CLIENT_DATA_CONFIG = {
  expirationIntervalMs: 300_000,
  domainPurgeGracePeriodMs: 604_800_000,
  defaultMaxItemSizeBytes: 1_048_576,
  defaultQuotaMaxEntries: 10_000,
  defaultQuotaMaxBytes: 10_485_760,
  maxDomainsPerAccount: 64,
  maxTotalEntriesPerAccount: 100_000,
  maxTotalBytesPerAccount: 104_857_600,
};

type D<T> = { data: T };
type E={ error: { code: string; message: string } };

interface SessionData {
  id: string;
  title: string | null;
  status: string;
  character_binding: Record<string, unknown> | null;
  user_binding: Record<string, unknown> | null;
  preset_id: string | null;
  regex_profile_id: string | null;
  worldbook_profile_id: string | null;
}

interface BatchResult {
  results: Array<{ index: number; id: string; action: string }>;
  meta: Record<string, unknown>;
}

async function createSession(app: FastifyInstance, payload: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { title: "Test Session", ...payload },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<D<SessionData>>().data;
}

async function createUser(app: FastifyInstance, name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/users",
    payload: { snapshot: { name, description: "d" } },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<D<{ id: string; name: string; status: string }>>().data;
}

async function createPromptAssets(database: DatabaseConnection["db"], options: {
  accountId?: string;
  prefix?: string;
} = {}) {
  const accountId = options.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID;
  const prefix = options.prefix ?? "asset";
  const now = Date.now();

  if (accountId !== DEFAULT_ADMIN_ACCOUNT_ID) {
    await database.insert(accounts).values({
      id: accountId,
      name: accountId,
      role: "user",
      status: "active",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  const presetId = `${prefix}-preset`;
  const regexProfileId = `${prefix}-regex`;
  const worldbookProfileId = `${prefix}-worldbook`;

  await database.insert(presets).values({
    id: presetId,
    accountId,
    name: `${prefix} preset`,
    source: "test",
    dataJson: "{}",
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(regexProfiles).values({
    id: regexProfileId,
    accountId,
    name: `${prefix} regex`,
    source: "test",
    dataJson: "[]",
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(worldbooks).values({
    id: worldbookProfileId,
    accountId,
    name: `${prefix} worldbook`,
    source: "test",
    dataJson: "{}",
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  return { presetId, regexProfileId, worldbookProfileId };
}

describe("Sessions route extra branch coverage", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection["db"];

  beforeEach(async () => {
    ({ app, database } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      enableClientData: true,
      clientData: CLIENT_DATA_CONFIG,
    }));
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  async function materializeGameState(sessionId: string, floorId = `floor-${sessionId}`) {
    const service = new SessionStateService(database, { clientData: CLIENT_DATA_CONFIG });
    const now = Date.now();

    await database.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      state: "committed",
      createdAt: now,
      updatedAt: now,
    });

    service.stageCommitBoundValue({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      namespace: "game_state",
      slot: "scene",
      value: { label: "scene-state" },
    });
    service.applyStagedMutationsForFloor({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      committedAt: now + 1,
    });
  }

  async function getManagedDomainForSession(sessionId: string) {
    const [binding] = await database
      .select()
      .from(clientDataManagedDomains)
      .where(eq(clientDataManagedDomains.hostId, sessionId));
    expect(binding).toBeDefined();

    const [domain] = await database
      .select()
      .from(clientDataDomains)
      .where(eq(clientDataDomains.id, binding!.domainId));
    expect(domain).toBeDefined();

    return { binding: binding!, domain: domain! };
  }

  // ── POST /sessions snapshot-only bindings ──────────

  it("POST /sessions with character_snapshot only (no character_id)", async () => {
    const session = await createSession(app, {
      character_snapshot: {
        name: "SnapshotChar",
        primaryGreeting: "Hello!",
        alternateGreetings: ["Alt one.", "Alt two."],
        systemPrompt: "Stay in character.",
      },
    });

    expect(session.character_binding).not.toBeNull();

    const timelineRes = await app.inject({
      method: "GET",
      url: `/sessions/${session.id}/timeline`,
    });
    expect(timelineRes.statusCode, timelineRes.body).toBe(200);
    const timeline = timelineRes.json<{
      data: {
        floors: Array<{
          page_count: number;
          active_page: { messages: Array<{ content: string }> } | null;
        }>;
      };
    }>();

    expect(timeline.data.floors).toHaveLength(1);
    expect(timeline.data.floors[0]!.page_count).toBe(3);
    expect(timeline.data.floors[0]!.active_page?.messages[0]!.content).toBe("Hello!");
  });

  it("POST /sessions with user_snapshot only (no user_id)", async () => {
    const session = await createSession(app, {
      user_snapshot: { name: "SnapshotUser" },
    });
    expect(session.user_binding).not.toBeNull();
  });

  it("POST /sessions with non-existent character_id returns 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title:"Bad Char", character_id: "nonexistent" },
    });
expect(res.statusCode).toBe(404);
    expect(res.json<E>().error.code).toBe("character_not_found");
  });

  it("POST /sessions with non-existent user_id returns 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Bad User", user_id: "nonexistent" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<E>().error.code).toBe("user_not_found");
  });

  it("POST /sessions with disabled user_id returns 409", async () => {
    const user = await createUser(app, "DisabledUser");
    await app.inject({
      method: "PATCH",
      url: `/users/${user.id}`,
      payload: { status: "disabled" },
});

    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Inactive", user_id: user.id },
    });
    expect(res.statusCode).toBe(409);
expect(res.json<E>().error.code).toBe("user_not_active");
  });

  // ── GET /sessions filters ──────────────────────────

  it("GET /sessions filters by status", async ()=> {
    await createSession(app, { title: "Active One" });
    const s = await createSession(app, { title: "Archived One" });
    await app.inject({
      method: "PATCH",
      url: `/sessions/${s.id}`,
      payload: { status: "archived" },
    });

    const res = await app.inject({ method: "GET", url: "/sessions?status=archived" });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: SessionData[] }>().data;
    expect(data).toHaveLength(1);
    expect(data[0]!.status).toBe("archived");
  });

  it("GET /sessions filters by keyword", async ()=> {
    await createSession(app, { title: "Alpha Session" });
    await createSession(app, { title: "Beta Session" });

    const res = await app.inject({ method: "GET", url: "/sessions?keyword=Alpha" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: SessionData[] }>().data).toHaveLength(1);
  });

  it("GET /sessions sort_by=updated_at", async () => {
    await createSession(app, { title: "First" });
  await createSession(app, { title: "Second"});

    const res = await app.inject({ method: "GET", url: "/sessions?sort_by=updated_at&sort_order=asc" });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: SessionData[] }>().data;
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  // ── PATCH /sessions/:id ────────────────────────────

  it("PATCH/sessions/:id returns 404 for missing session", async () => {
 const res = await app.inject({
      method: "PATCH",
      url: "/sessions/nonexistent",
      payload: { title: "Ghost" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /sessions/:idupdates user binding", async () => {
  const user = await createUser(app, "PatchUser");
    const session =await createSession(app);

    const res = await app.inject({
      method: "PATCH",
      url: `/sessions/${session.id}`,
      payload: { user_id: user.id },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<D<SessionData>>().data;
    expect(updated.user_binding).not.toBeNull();
  });

  it("PATCH /sessions/:id with user_snapshot only", async () => {
    const session = await createSession(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/sessions/${session.id}`,
      payload: { user_snapshot: { name:"InlineUser" } },
    });
    expect(res.statusCode).toBe(200);
  });

  it("PATCH /sessions/:id with character_snapshot only", async () => {
    const session = await createSession(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/sessions/${session.id}`,
      payload: { character_snapshot: { name: "InlineChar" } },
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST and PATCH /sessions preserve and clear prompt asset bindings", async () => {
    const assetIds = await createPromptAssets(database, { prefix: "owned" });
    const session = await createSession(app, {
      preset_id: assetIds.presetId,
      regex_profile_id: assetIds.regexProfileId,
      worldbook_profile_id: assetIds.worldbookProfileId,
    });

    expect(session.preset_id).toBe(assetIds.presetId);
    expect(session.regex_profile_id).toBe(assetIds.regexProfileId);
    expect(session.worldbook_profile_id).toBe(assetIds.worldbookProfileId);

    const renameRes = await app.inject({
      method: "PATCH",
      url: `/sessions/${session.id}`,
      payload: { title: "Renamed without binding patch" },
    });
    expect(renameRes.statusCode, renameRes.body).toBe(200);
    const renamed = renameRes.json<D<SessionData>>().data;
    expect(renamed.preset_id).toBe(assetIds.presetId);
    expect(renamed.regex_profile_id).toBe(assetIds.regexProfileId);
    expect(renamed.worldbook_profile_id).toBe(assetIds.worldbookProfileId);

    const unbindRes = await app.inject({
      method: "PATCH",
      url: `/sessions/${session.id}`,
      payload: {
        preset_id: null,
        regex_profile_id: null,
        worldbook_profile_id: null,
      },
    });
    expect(unbindRes.statusCode, unbindRes.body).toBe(200);
    const unbound = unbindRes.json<D<SessionData>>().data;
    expect(unbound.preset_id).toBeNull();
    expect(unbound.regex_profile_id).toBeNull();
    expect(unbound.worldbook_profile_id).toBeNull();
  });

  it("rejects prompt asset bindings from another account", async () => {
    const ownedAssetIds = await createPromptAssets(database, { prefix: "owned-bind" });
    const foreignAssetIds = await createPromptAssets(database, { accountId: "foreign-account", prefix: "foreign-bind" });

    const createCases = [
      { field: "preset_id", id: foreignAssetIds.presetId, code: "preset_not_found" },
      { field: "regex_profile_id", id: foreignAssetIds.regexProfileId, code: "regex_profile_not_found" },
      { field: "worldbook_profile_id", id: foreignAssetIds.worldbookProfileId, code: "worldbook_not_found" },
    ] as const;

    for (const testCase of createCases) {
      const createRes = await app.inject({
        method: "POST",
        url: "/sessions",
        payload: {
          title: `foreign-${testCase.field}`,
          [testCase.field]: testCase.id,
        },
      });
      expect(createRes.statusCode, createRes.body).toBe(404);
      expect(createRes.json<E>().error.code).toBe(testCase.code);
    }

    const session = await createSession(app, {
      preset_id: ownedAssetIds.presetId,
      regex_profile_id: ownedAssetIds.regexProfileId,
      worldbook_profile_id: ownedAssetIds.worldbookProfileId,
    });

    const patchCases = [
      { field: "preset_id", id: foreignAssetIds.presetId, code: "preset_not_found" },
      { field: "regex_profile_id", id: foreignAssetIds.regexProfileId, code: "regex_profile_not_found" },
      { field: "worldbook_profile_id", id: foreignAssetIds.worldbookProfileId, code: "worldbook_not_found" },
    ] as const;

    for (const testCase of patchCases) {
      const patchRes = await app.inject({
        method: "PATCH",
        url: `/sessions/${session.id}`,
        payload: {
          [testCase.field]: testCase.id,
        },
      });
      expect(patchRes.statusCode, patchRes.body).toBe(404);
      expect(patchRes.json<E>().error.code).toBe(testCase.code);
    }
  });

  // ── POST /sessions/:id/character/sync ─────────────

  it("POST /sessions/:id/character/sync returns 404 for missing session", async () => {
    const res =await app.inject({
      method: "POST",
      url: "/sessions/nonexistent/character/sync",
    });
    expect(res.statusCode).toBe(404);
  });

  // ── PATCH /sessions/batch/status ───────────────────

  it("PATCH /sessions/batch/status handles mixed found/not_found", async () => {
    const s = await createSession(app, { title: "BatchSess" });

    const res = await app.inject({
      method: "PATCH",
      url: "/sessions/batch/status",
      payload: { ids: [s.id, "nonexistent"], status: "archived" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<D<BatchResult>>().data;
 expect(body.meta.updated).toBe(1);
    expect(body.meta.not_found).toBe(1);
  });

  it("PATCH /sessions/batch/status returns400 for empty ids", async () => {
    const res =await app.inject({
      method: "PATCH",
      url: "/sessions/batch/status",
      payload: { ids: [],status: "archived" },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── POST /sessions/batch/delete ───────────────────

  it("POST /sessions/batch/delete handles mixed found/not_found", async () => {
    const s = await createSession(app, { title: "DelSess" });

    const res = await app.inject({
      method: "POST",
      url: "/sessions/batch/delete",
      payload: { ids: [s.id, "nonexistent"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<D<BatchResult>>().data;
    expect(body.meta.deleted).toBe(1);
    expect(body.meta.not_found).toBe(1);
  });

  it("DELETE /sessions/:id soft-deletes managed game_state domains before removing the session", async () => {
    const session = await createSession(app, { title: "Managed Delete" });
    await materializeGameState(session.id);

    const before = await getManagedDomainForSession(session.id);
    expect(before.binding.stateNamespace).toBe("game_state");
    expect(before.domain.status).toBe("active");
    expect(before.domain.deletedAt).toBeNull();

    const response = await app.inject({
      method: "DELETE",
      url: `/sessions/${session.id}`,
    });

    expect(response.statusCode, response.body).toBe(200);

    const [deletedDomain] = await database
      .select()
      .from(clientDataDomains)
      .where(eq(clientDataDomains.id, before.domain.id));
    expect(deletedDomain).toBeDefined();
    expect(deletedDomain!.status).toBe("deleted");
    expect(deletedDomain!.deletedAt).not.toBeNull();
  });

  it("POST /sessions/batch/delete soft-deletes managed game_state domains for deleted sessions", async () => {
    const sessionA = await createSession(app, { title: "Batch Managed A" });
    const sessionB = await createSession(app, { title: "Batch Managed B" });
    await materializeGameState(sessionA.id);
    await materializeGameState(sessionB.id);

    const beforeA = await getManagedDomainForSession(sessionA.id);
    const beforeB = await getManagedDomainForSession(sessionB.id);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/batch/delete",
      payload: { ids: [sessionA.id, sessionB.id] },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<D<BatchResult>>().data;
    expect(body.meta.deleted).toBe(2);

    const deletedDomains = await database
      .select()
      .from(clientDataDomains)
      .where(eq(clientDataDomains.status, "deleted"));
    expect(deletedDomains.map((domain) => domain.id)).toEqual(expect.arrayContaining([
      beforeA.domain.id,
      beforeB.domain.id,
    ]));
  });

  it("POST /sessions/batch/delete returns 400 for empty ids", async () => {
    const res = await app.inject({
      method: "POST",
   url: "/sessions/batch/delete",
    payload: { ids: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /sessions/:id/timeline page-aware 结构 ─────

  it("GET /sessions/:id/timeline returns page-aware pages & active_pages for multi-active-page floor", async () => {
    const session = await createSession(app, { title: "Timeline Page-Aware" });

    const createFloorRes = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        session_id: session.id,
        floor_no: 10,
        branch_id: "main",
        state: "draft",
      },
    });
    expect(createFloorRes.statusCode, createFloorRes.body).toBe(201);
    const floorId = createFloorRes.json<D<{ id: string }>>().data.id;

    async function createPage(pageNo: number, pageKind: "input" | "output") {
      const res = await app.inject({
        method: "POST",
        url: "/pages",
        payload: { floor_id: floorId, page_no: pageNo, page_kind: pageKind },
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json<D<{ id: string; is_active: boolean }>>().data;
    }

    const inputPage = await createPage(0, "input");
    const outputPage = await createPage(1, "output");
    expect(inputPage.is_active).toBe(true);
    expect(outputPage.is_active).toBe(true);

    async function postMessage(pageId: string, role: string, content: string) {
      const res = await app.inject({
        method: "POST",
        url: "/messages",
        payload: { page_id: pageId, role, content, seq: 0, content_format: "text" },
      });
      expect(res.statusCode, res.body).toBe(201);
    }

    await postMessage(inputPage.id, "user", "hello");
    await postMessage(outputPage.id, "assistant", "world");

    // Phase 4 guardrails 落地后，`PATCH /floors/:id` 不再允许改 `state`。
    // 第二阶段拆分的 admin 接口（`POST /floors/:id/admin/force-state`）尚未上线，
    // 本测试仅需要一个"先 draft 加 page、再让 floor 进入 committed"的夹具位置，
    // 所以直接在测试里走 DB 层把 floor 手工置为 committed。
    await database
      .update(floors)
      .set({ state: "committed", updatedAt: Date.now() })
      .where(eq(floors.id, floorId));

    const timelineRes = await app.inject({
      method: "GET",
      url: `/sessions/${session.id}/timeline?branch_id=main`,
    });
    expect(timelineRes.statusCode, timelineRes.body).toBe(200);

    interface TimelineMessage { id: string; seq: number; role: string; content: string; content_format: string }
    interface TimelinePage { id: string; page_no: number; page_kind: string; is_active?: boolean; version: number; messages: TimelineMessage[] }
    interface TimelineFloor {
      id: string;
      floor_no: number;
      pages: TimelinePage[];
      active_pages: TimelinePage[];
      active_page: TimelinePage | null;
      messages: TimelineMessage[];
      page_count: number;
    }

    const body = timelineRes.json<{ data: { floors: TimelineFloor[] } }>();
    const floor = body.data.floors.find((f) => f.id === floorId);
    expect(floor).toBeDefined();

    // 同一 floor 下有两个 active page：pages 与 active_pages 应同时返回两条，
    // 并分别携带自己的 messages 列表（不被压扁到 floor 级）。
    expect(floor!.pages).toHaveLength(2);
    expect(floor!.active_pages).toHaveLength(2);

    const pagesByKind = Object.fromEntries(floor!.pages.map((p) => [p.page_kind, p]));
    expect(pagesByKind.input!.is_active).toBe(true);
    expect(pagesByKind.output!.is_active).toBe(true);
    expect(pagesByKind.input!.messages.map((m) => m.content)).toEqual(["hello"]);
    expect(pagesByKind.output!.messages.map((m) => m.content)).toEqual(["world"]);

    // 存在多个 active page 时，兼容字段 active_page 必须为 null，避免伪造单一真相。
    expect(floor!.active_page).toBeNull();

    // 兼容字段 messages 仍会返回所有 active page 的消息拼接；调用方应改为消费 pages。
    expect(floor!.messages.map((m) => m.content)).toEqual(["hello", "world"]);

    expect(floor!.page_count).toBe(2);
  });

  it("GET /sessions/:id/timeline keeps active_page as compatibility field when only one active page exists", async () => {
    const session = await createSession(app, {
      character_snapshot: {
        name: "GreetingOnly",
        primaryGreeting: "Greetings, traveler.",
      },
    });

    const timelineRes = await app.inject({
      method: "GET",
      url: `/sessions/${session.id}/timeline`,
    });
    expect(timelineRes.statusCode, timelineRes.body).toBe(200);

    const body = timelineRes.json<{
      data: {
        floors: Array<{
          active_page: { page_kind: string; messages: Array<{ content: string }> } | null;
          active_pages: Array<{ page_kind: string }>;
          pages: Array<{ page_kind: string; is_active: boolean }>;
        }>;
      };
    }>();

    expect(body.data.floors).toHaveLength(1);
    const floor = body.data.floors[0]!;
    expect(floor.active_pages).toHaveLength(1);
    expect(floor.active_pages[0]!.page_kind).toBe("output");
    // 单 active page 场景下兼容字段仍按旧语义返回。
    expect(floor.active_page).not.toBeNull();
    expect(floor.active_page!.page_kind).toBe("output");
    expect(floor.active_page!.messages[0]!.content).toBe("Greetings, traveler.");
  });

});

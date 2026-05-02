import type { SmokeContext, JsonObject } from "./harness.js";
import { assert, must } from "./harness.js";

export async function smokeCore(ctx: SmokeContext): Promise<void> {
  const { api, options, runId, runStep, track, addCleanup } = ctx;

  // ── Health & OpenAPI ─────────────────────────────────

  const health = await runStep("GET /health", () => api.request<JsonObject>("GET", "/health", undefined, [200]));
  assert(
    health.body?.ok === true,
    `Health endpoint returned unexpected payload: ${JSON.stringify(health.body)}`
  );

  const openApi = await runStep("GET /openapi.json", () =>
    api.request<JsonObject>("GET", "/openapi.json", undefined, [200])
  );
  assert(typeof openApi.body?.openapi === "string", "OpenAPI schema not returned");

  // ── Sessions CRUD ────────────────────────────────────

  const session = await runStep("POST /sessions", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/sessions",
      {
        title: `${runId}-session`,
        character_snapshot: { name: "Knight", primaryGreeting: "Hello there." },
      },
      [201]
    )
  );
  const sessionId = must(session.body?.data?.id, "Missing session id");
  track("sessions", sessionId);
  addCleanup(async () => {
    await api.request("DELETE", `/sessions/${sessionId}`, undefined, [200, 404]);
  });

  const disposableSession = await runStep("POST /sessions (disposable)", () =>
    api.request<{ data: { id: string } }>("POST", "/sessions", { title: `${runId}-delete-me` }, [201])
  );
  const disposableSessionId = must(disposableSession.body?.data?.id, "Missing disposable session id");
  await runStep("DELETE /sessions/:id", () =>
    api.request("DELETE", `/sessions/${disposableSessionId}`, undefined, [200])
  );
  await runStep("GET /sessions/:id (deleted => 404)", () =>
    api.request("GET", `/sessions/${disposableSessionId}`, undefined, [404])
  );

  await runStep("GET /sessions/:id", () => api.request("GET", `/sessions/${sessionId}`, undefined, [200]));
  await runStep("PATCH /sessions/:id", () =>
    api.request(
      "PATCH",
      `/sessions/${sessionId}`,
      { metadata: { smoke: runId }, prompt_mode: "compat_strict" },
      [200]
    )
  );
  await runStep("GET /sessions list", () =>
    api.request("GET", "/sessions?limit=5&offset=0&sort_by=updated_at&sort_order=desc", undefined, [200])
  );

  await runStep("POST /sessions/:id/character/sync (no binding => 409)", () =>
    api.request("POST", `/sessions/${sessionId}/character/sync`, undefined, [409])
  );

  // ── Timeline (empty) ────────────────────────────────

  const timelineEmpty = await runStep("GET /sessions/:id/timeline (empty)", () =>
    api.request<{ data: { floors: unknown[] } }>("GET", `/sessions/${sessionId}/timeline`, undefined, [200])
  );
  assert(Array.isArray(timelineEmpty.body?.data?.floors), "Timeline floors is not an array");

  // ── Floors CRUD ──────────────────────────────────────

  const floor = await runStep("POST /floors (draft content floor)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/floors",
      {
        session_id: sessionId,
        floor_no: 1,
        branch_id: "main",
        state: "draft",
      },
      [201]
    )
  );
  const floorId = must(floor.body?.data?.id, "Missing floor id");

  const committedBranchFloor = await runStep("POST /floors (committed branch source floor)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/floors",
      {
        session_id: sessionId,
        floor_no: 2,
        branch_id: "main",
        state: "committed",
      },
      [201]
    )
  );
  const committedBranchFloorId = must(committedBranchFloor.body?.data?.id, "Missing committed branch floor id");

  // 为下游需要 committed 状态的冒烟步骤（例如 Prompt Runtime compare 的 left）
  // 预留一个额外的 committed 裸 CRUD 楼层。chat-main-flow-repair 之后 PATCH
  // /floors/:id 已禁止修改 state，原先通过 PATCH 把 draft 楼层推到 committed
  // 的旧路径不再可用，改成直接创建一个 committed 楼层。
  const contentFloorCommitted = await runStep("POST /floors (committed content floor)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/floors",
      {
        session_id: sessionId,
        floor_no: 3,
        branch_id: "main",
        state: "committed",
      },
      [201]
    )
  );
  const contentFloorCommittedId = must(contentFloorCommitted.body?.data?.id, "Missing committed content floor id");

  await runStep("GET /floors/:id", () => api.request("GET", `/floors/${floorId}`, undefined, [200]));
  // `token_in` / `token_out` 由 commit 事务写入，PATCH /floors/:id 仅接受 topology
  // 字段（`floor_no` / `branch_id` / `parent_floor_id`）。冒烟在此只验证：
  // 传受限字段会被 400 `floor_patch_restricted_field` 拒绝。
  // 合法 topology 的 PATCH 涉及拓扑一致性（parent_floor_id 必须指向同分支、
  // floor_no 严格小于目标的已提交楼层），这类场景交给集成测试覆盖，
  // 冒烟脚本不在这里构造完整的父楼层前置条件。
  await runStep("PATCH /floors/:id (restricted field => 400)", () =>
    api.request("PATCH", `/floors/${floorId}`, { token_in: 7, token_out: 11 }, [400])
  );
  await runStep("GET /floors list", () =>
    api.request("GET", `/floors?session_id=${encodeURIComponent(sessionId)}&sort_by=floor_no&sort_order=asc`, undefined, [200])
  );

  const disposableFloor = await runStep("POST /floors (disposable)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/floors",
      {
        session_id: sessionId,
        floor_no: 99,
        branch_id: "main",
        state: "draft",
      },
      [201]
    )
  );
  const disposableFloorId = must(disposableFloor.body?.data?.id, "Missing disposable floor id");
  await runStep("DELETE /floors/:id", () => api.request("DELETE", `/floors/${disposableFloorId}`, undefined, [200]));

  // ── Pages & Messages ────────────────────────────────

  const pageV1 = await runStep("POST /pages (active v1)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/pages",
      {
        floor_id: floorId,
        page_no: 0,
        page_kind: "output",
        version: 1,
      },
      [201]
    )
  );
  const pageV1Id = must(pageV1.body?.data?.id, "Missing page v1 id");

  const msgV1 = await runStep("POST /messages (v1)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/messages",
      {
        page_id: pageV1Id,
        seq: 0,
        role: "user",
        content: `${runId}-v1`,
      },
      [201]
    )
  );
  must(msgV1.body?.data?.id, "Missing message v1 id");

  const pageV2 = await runStep("POST /pages (inactive v2)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/pages",
      {
        floor_id: floorId,
        page_no: 0,
        page_kind: "output",
        version: 2,
      },
      [201]
    )
  );
  const pageV2Id = must(pageV2.body?.data?.id, "Missing page v2 id");

  const msgV2 = await runStep("POST /messages (v2)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/messages",
      {
        page_id: pageV2Id,
        seq: 0,
        role: "user",
        content: `${runId}-v2`,
      },
      [201]
    )
  );
  const msgV2Id = must(msgV2.body?.data?.id, "Missing message v2 id");

  await runStep("GET /messages", () =>
    api.request("GET", `/messages?page_id=${encodeURIComponent(pageV2Id)}&sort_by=seq&sort_order=asc`, undefined, [200])
  );
  await runStep("GET /messages/:id", () => api.request("GET", `/messages/${msgV2Id}`, undefined, [200]));
  await runStep("PATCH /messages/:id", () =>
    api.request("PATCH", `/messages/${msgV2Id}`, { content: `${runId}-v2-edited` }, [200])
  );

  const disposableMessage = await runStep("POST /messages (disposable)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/messages",
      {
        page_id: pageV2Id,
        seq: 1,
        role: "user",
        content: `${runId}-temp-message`,
      },
      [201]
    )
  );
  const disposableMessageId = must(disposableMessage.body?.data?.id, "Missing disposable message id");
  await runStep("DELETE /messages/:id", () =>
    api.request("DELETE", `/messages/${disposableMessageId}`, undefined, [200])
  );

  await runStep("GET /pages", () =>
    api.request("GET", `/pages?floor_id=${encodeURIComponent(floorId)}&sort_by=version&sort_order=asc`, undefined, [200])
  );
  await runStep("GET /pages/:id", () => api.request("GET", `/pages/${pageV1Id}`, undefined, [200]));
  await runStep("PATCH /pages/:id", () =>
    api.request("PATCH", `/pages/${pageV2Id}`, { checksum: `${runId}-checksum` }, [200])
  );

  const disposablePage = await runStep("POST /pages (disposable)", () =>
    api.request<{ data: { id: string } }>(
      "POST",
      "/pages",
      {
        floor_id: floorId,
        page_no: 1,
        page_kind: "mixed",
        version: 1,
      },
      [201]
    )
  );
  const disposablePageId = must(disposablePage.body?.data?.id, "Missing disposable page id");
  await runStep("DELETE /pages/:id", () => api.request("DELETE", `/pages/${disposablePageId}`, undefined, [200]));

  // `state` 归 floor run state machine 管理，PATCH /floors/:id 不再接受直接修改。
  // 冒烟在此只验证：通过 PATCH 修改 `state` 会被 400 `floor_patch_restricted_field` 拒绝。
  await runStep("PATCH /floors/:id (state restricted => 400)", () =>
    api.request(
      "PATCH",
      `/floors/${floorId}`,
      { state: "committed" },
      [400]
    )
  );

  // ── Timeline with data ───────────────────────────────

  // timeline 在 chat-main-flow-repair 之后升级为 page-aware，且只返回 committed
  // 楼层。冒烟里做 page/message CRUD 的 `floorId` 保持在 draft（新的 PATCH
  // guardrail 已禁止通过 PATCH 修改 state），所以这里不再断言 draft 楼层出现在
  // timeline；改为断言 committedBranchFloorId 这个已 committed 的楼层出现在
  // timeline 中，用来覆盖 timeline 路由本身的基础返回结构。
  const timeline = await runStep("GET /sessions/:id/timeline (with data)", () =>
    api.request<{ data: { floors: Array<{ id: string; page_count: number; active_page: { id: string } | null }> } }>(
      "GET",
      `/sessions/${sessionId}/timeline`,
      undefined,
      [200]
    )
  );
  const timelineFloors = timeline.body?.data?.floors ?? [];
  assert(Array.isArray(timelineFloors), "Timeline floors should be an array");
  const committedEntry = timelineFloors.find((entry) => entry.id === committedBranchFloorId);
  assert(
    Boolean(committedEntry),
    "Timeline should include the committed branch source floor"
  );

  await runStep("PATCH /pages/:id/activate", () =>
    api.request("PATCH", `/pages/${pageV2Id}/activate`, undefined, [200])
  );

  const pageV1After = await runStep("GET /pages/:id (v1 inactive)", () =>
    api.request<{ data: { is_active: boolean } }>("GET", `/pages/${pageV1Id}`, undefined, [200])
  );
  assert(pageV1After.body?.data?.is_active === false, "v1 should be inactive after activate");

  const pageV2After = await runStep("GET /pages/:id (v2 active)", () =>
    api.request<{ data: { is_active: boolean } }>("GET", `/pages/${pageV2Id}`, undefined, [200])
  );
  assert(pageV2After.body?.data?.is_active === true, "v2 should be active after activate");

  // ── Branches ────────────────────────────────────────

  await runStep("POST /floors/:id/branch (auto)", () =>
    api.request("POST", `/floors/${committedBranchFloorId}/branch`, {}, [201])
  );

  const customBranchId = `${runId}-branch`;
  await runStep("POST /floors/:id/branch (custom)", () =>
    api.request("POST", `/floors/${committedBranchFloorId}/branch`, { branch_id: customBranchId }, [201])
  );

  await runStep("POST /floors/:id/branch (duplicate => 409)", () =>
    api.request("POST", `/floors/${committedBranchFloorId}/branch`, { branch_id: "main" }, [409])
  );

  await runStep("POST /floors (custom branch floor)", () =>
    api.request(
      "POST",
      "/floors",
      {
        session_id: sessionId,
        floor_no: 1,
        branch_id: customBranchId,
        parent_floor_id: committedBranchFloorId,
        state: "committed",
      },
      [201]
    )
  );

  const branches = await runStep("GET /sessions/:id/branches", () =>
    api.request<{ data: Array<{ branch_id: string }> }>(
      "GET",
      `/sessions/${sessionId}/branches?sort_by=branch_id&sort_order=asc`,
      undefined,
      [200]
    )
  );
  assert(
    branches.body?.data?.some((branch) => branch.branch_id === customBranchId) ?? false,
    "Custom branch should appear in branches list"
  );

  await runStep("GET /sessions/:id/branches/diff", () =>
    api.request(
      "GET",
      `/sessions/${sessionId}/branches/diff?base_branch_id=main&target_branch_id=${encodeURIComponent(customBranchId)}`,
      undefined,
      [200]
    )
  );

  await runStep("GET /sessions/:id/timeline (custom branch)", () =>
    api.request("GET", `/sessions/${sessionId}/timeline?branch_id=${encodeURIComponent(customBranchId)}`, undefined, [200])
  );

  await runStep("DELETE /branches/main (protected => 409)", () =>
    api.request("DELETE", "/branches/main", undefined, [409])
  );

  await runStep("DELETE /branches/:id", () =>
    api.request("DELETE", `/branches/${customBranchId}?session_id=${encodeURIComponent(sessionId)}`, undefined, [200])
  );

  const branchesAfterDelete = await runStep("GET /sessions/:id/branches (after delete)", () =>
    api.request<{ data: Array<{ branch_id: string }> }>("GET", `/sessions/${sessionId}/branches`, undefined, [200])
  );
  assert(
    !branchesAfterDelete.body?.data?.some((branch) => branch.branch_id === customBranchId),
    "Custom branch should be removed"
  );

  // ── Write shared refs for downstream modules ───────

  ctx.shared.sessionId = sessionId;
  ctx.shared.floorId = floorId;
  ctx.shared.pageV1Id = pageV1Id;
  ctx.shared.pageV2Id = pageV2Id;
  ctx.shared.committedBranchFloorId = committedBranchFloorId;
  ctx.shared.contentFloorCommittedId = contentFloorCommittedId;
}

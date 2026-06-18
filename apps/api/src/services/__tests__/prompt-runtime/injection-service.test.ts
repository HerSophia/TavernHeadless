import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../../db/client.js";
import { floors, promptRuntimeInjections, sessions } from "../../../db/schema.js";
import { PROMPT_RUNTIME_INJECTION_LIMITS } from "../../prompt-runtime/injection-governance.js";
import {
  PromptRuntimeInjectionService,
  PromptRuntimeInjectionServiceError,
} from "../../prompt-runtime/injection-service.js";

describe("PromptRuntimeInjectionService", () => {
  let database: DatabaseConnection;
  let service: PromptRuntimeInjectionService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    service = new PromptRuntimeInjectionService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("creates updates lists and deletes session scope injections with normalized fields", async () => {
    const sessionId = await insertSession(database);

    const created = service.createSessionInjection(
      sessionId,
      DEFAULT_ADMIN_ACCOUNT_ID,
      {
        sourceKind: "client_injection",
        title: "  History guard  ",
        content: "  Keep the north pass in focus.  ",
        placement: " before_history ",
      },
      DEFAULT_ADMIN_ACCOUNT_ID,
    );

    expect(created).toMatchObject({
      sessionId,
      branchId: null,
      scope: "session",
      sourceKind: "client_injection",
      title: "History guard",
      content: "Keep the north pass in focus.",
      placement: "before_history",
      order: 100,
      enabled: true,
      modeScope: null,
      ttlMs: null,
      createdBy: DEFAULT_ADMIN_ACCOUNT_ID,
    });

    expect(service.listSessionInjections(sessionId, DEFAULT_ADMIN_ACCOUNT_ID)).toEqual([created]);

    const updated = service.updateSessionInjection(
      sessionId,
      created.id,
      DEFAULT_ADMIN_ACCOUNT_ID,
      {
        enabled: false,
        modeScope: "native",
        ttlMs: 60000,
      },
      DEFAULT_ADMIN_ACCOUNT_ID,
    );

    expect(updated).toMatchObject({
      id: created.id,
      enabled: false,
      modeScope: "native",
      ttlMs: 60000,
      createdBy: DEFAULT_ADMIN_ACCOUNT_ID,
    });

    const deleted = service.deleteSessionInjection(
      sessionId,
      created.id,
      DEFAULT_ADMIN_ACCOUNT_ID,
    );

    expect(deleted.id).toBe(created.id);
    expect(service.listSessionInjections(sessionId, DEFAULT_ADMIN_ACCOUNT_ID)).toEqual([]);
  });

  it("creates branch scope injections and builds resolved summaries and prepared inputs", async () => {
    const sessionId = await insertSession(database, { branchId: "alt-branch" });

    const sessionScoped = service.createSessionInjection(
      sessionId,
      DEFAULT_ADMIN_ACCOUNT_ID,
      {
        sourceKind: "client_injection",
        title: "Session injection",
        content: "Session body",
        placement: "before_history",
      },
    );

    const branchScoped = service.createBranchInjection(
      sessionId,
      "alt-branch",
      DEFAULT_ADMIN_ACCOUNT_ID,
      {
        sourceKind: "client_injection",
        title: "Branch injection",
        content: "Branch body",
        placement: "before_history",
        enabled: false,
      },
    );

    expect(service.getResolvedStateSummary(sessionId, "alt-branch", DEFAULT_ADMIN_ACCOUNT_ID)).toEqual({
      session: { total: 1, enabled: 1 },
      branch: { total: 1, enabled: 0 },
    });

    expect(service.listPersistentInputsForPrompt(sessionId, "alt-branch", DEFAULT_ADMIN_ACCOUNT_ID)).toEqual([
      {
        sourceKind: sessionScoped.sourceKind,
        title: sessionScoped.title,
        content: sessionScoped.content,
        placement: sessionScoped.placement,
        order: sessionScoped.order,
        scope: "session",
        injectionId: sessionScoped.id,
        enabled: true,
        modeScope: null,
        ttlMs: null,
        createdAt: sessionScoped.createdAt,
      },
      {
        sourceKind: branchScoped.sourceKind,
        title: branchScoped.title,
        content: branchScoped.content,
        placement: branchScoped.placement,
        order: branchScoped.order,
        scope: "branch",
        injectionId: branchScoped.id,
        enabled: false,
        modeScope: null,
        ttlMs: null,
        createdAt: branchScoped.createdAt,
      },
    ]);
  });

  it("rejects branch scoped access when the branch is missing", async () => {
    const sessionId = await insertSession(database);

    expect(() => service.listBranchInjections(sessionId, "missing-branch", DEFAULT_ADMIN_ACCOUNT_ID)).toThrowError(
      new PromptRuntimeInjectionServiceError(404, "branch_not_found", "Branch 'missing-branch' not found in session"),
    );
  });

  it("purges expired injections and supports branch scope cleanup", async () => {
    const sessionId = await insertSession(database, { branchId: "alt-branch" });
    const createdAt = Date.now() - 10_000;

    await database.db.insert(promptRuntimeInjections).values([
      {
        id: nanoid(),
        sessionId,
        branchId: null,
        sourceKind: "client_injection",
        title: "Expired session",
        content: "Expired session body",
        placement: "before_history",
        order: 100,
        enabled: true,
        modeScope: null,
        ttlMs: 100,
        createdBy: null,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: nanoid(),
        sessionId,
        branchId: "alt-branch",
        sourceKind: "client_injection",
        title: "Branch entry",
        content: "Branch body",
        placement: "before_history",
        order: 100,
        enabled: true,
        modeScope: null,
        ttlMs: null,
        createdBy: null,
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    expect(service.deleteExpired(Date.now())).toBe(1);
    expect(service.listSessionInjections(sessionId, DEFAULT_ADMIN_ACCOUNT_ID)).toEqual([]);
    expect(service.deleteBranchScopeInjections(sessionId, "alt-branch")).toBe(1);
    expect(service.listBranchInjections(sessionId, "alt-branch", DEFAULT_ADMIN_ACCOUNT_ID)).toEqual([]);
  });

  it("persists placement_params across create patch and prepared inputs", async() => {
    const sessionId = await insertSession(database, { branchId: "alt-branch" });

    const created = service.createSessionInjection(
      sessionId,
      DEFAULT_ADMIN_ACCOUNT_ID,
      {
        sourceKind: "client_injection",
        title: "Floor guard",
        content: "Keep floor 12 in focus.",
        placement: "before_floor",
        placementParams: { floorNo: 12 },
      },
      DEFAULT_ADMIN_ACCOUNT_ID,
    );

    expect(created.placement).toBe("before_floor");
    expect(created.placementParams).toEqual({ floorNo: 12 });

    // 持久读路径回填 placement_params
    expect(service.listSessionInjections(sessionId, DEFAULT_ADMIN_ACCOUNT_ID)[0]?.placementParams).toEqual({
      floorNo: 12,
    });

    // prepared builder 输入透传 placementParams，使持久 injection 也能用高级位置
    const inputs = service.listPersistentInputsForPrompt(sessionId, "alt-branch", DEFAULT_ADMIN_ACCOUNT_ID);
    expect(inputs[0]).toMatchObject({ placement: "before_floor", placementParams: { floorNo: 12 } });

    // patch 用 null 显式清空参数
    const cleared = service.updateSessionInjection(
      sessionId,
      created.id,
      DEFAULT_ADMIN_ACCOUNT_ID,
      { placementParams: null },
      DEFAULT_ADMIN_ACCOUNT_ID,
    );
    expect(cleared.placementParams).toBeNull();
  });

  it("rejects non-negative-integer placement_params on persisted write", async () => {
    const sessionId = await insertSession(database);

    expect(() =>
      service.createSessionInjection(sessionId, DEFAULT_ADMIN_ACCOUNT_ID, {
        sourceKind: "client_injection",
        title: "Floor guard",
        content: "Keep floor 12 in focus.",
        placement: "before_floor",
        placementParams: { floorNo: -1 },
      }),
    ).toThrowError(PromptRuntimeInjectionServiceError);
  });

  it("rejects persisted writes that exceed title and content length limits", async () => {
    const sessionId = await insertSession(database);

    expect(() =>
      service.createSessionInjection(sessionId, DEFAULT_ADMIN_ACCOUNT_ID, {
        sourceKind: "client_injection",
        title: "x".repeat(PROMPT_RUNTIME_INJECTION_LIMITS.titleMaxLength + 1),
        content: "body",
        placement: "before_history",
      }),
    ).toThrowError(PromptRuntimeInjectionServiceError);

    expect(() =>
      service.createSessionInjection(sessionId, DEFAULT_ADMIN_ACCOUNT_ID, {
        sourceKind: "client_injection",
        title: "Title",
        content: "x".repeat(PROMPT_RUNTIME_INJECTION_LIMITS.contentMaxLength + 1),
        placement: "before_history",
      }),
    ).toThrowError(PromptRuntimeInjectionServiceError);
  });

  it("rejects persisted writes beyond the session scope quota", async () => {
    const sessionId = await insertSession(database);

    for (let index = 0; index < PROMPT_RUNTIME_INJECTION_LIMITS.sessionMaxCount; index += 1) {
      service.createSessionInjection(sessionId, DEFAULT_ADMIN_ACCOUNT_ID, {
        sourceKind: "client_injection",
        title: `Injection ${index}`,
        content: "Body",
        placement: "before_history",
      });
    }

    expect(() =>
      service.createSessionInjection(sessionId, DEFAULT_ADMIN_ACCOUNT_ID, {
        sourceKind: "client_injection",
        title: "Overflow",
        content: "Body",
        placement: "before_history",
      }),
    ).toThrowError(
      new PromptRuntimeInjectionServiceError(
        400,
        "injection_scope_quota_exceeded",
        `Prompt runtime injection session scope limit exceeded: max ${PROMPT_RUNTIME_INJECTION_LIMITS.sessionMaxCount}`,
      ),
    );
  });

  it("omits expired persisted injections from prepared inputs", async () => {
    const sessionId = await insertSession(database, { branchId: "alt-branch" });
    const createdAt = Date.now() - 10_000;

    await database.db.insert(promptRuntimeInjections).values({
      id: nanoid(),
      sessionId,
      branchId: null,
      sourceKind: "client_injection",
      title: "Expired session",
      content: "Expired session body",
      placement: "before_history",
      order: 100,
      enabled: true,
      modeScope: null,
      ttlMs: 100,
      createdBy: null,
      createdAt,
      updatedAt: createdAt,
    });

    expect(service.listPersistentInputsForPrompt(sessionId, "alt-branch", DEFAULT_ADMIN_ACCOUNT_ID)).toEqual([]);
  });

});

async function insertSession(
  database: DatabaseConnection,
  args: { branchId?: string } = {},
) {
  const now = Date.now();
  const sessionId = nanoid();

  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Prompt runtime session",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    characterId: null,
    characterSnapshotJson: null,
    characterSyncPolicy: "manual",
    characterVersionId: null,
    projectId: null,
    workspaceId: null,
    presetId: null,
    worldbookProfileId: null,
    regexProfileId: null,
    deepBinding: false,
    presetVersionId: null,
    worldbookVersionId: null,
    regexProfileVersionId: null,
    userId: null,
    userSnapshotJson: null,
    modelProvider: null,
    modelName: null,
    modelParamsJson: null,
    promptMode: null,
    metadataJson: null,
    createdAt: now,
    updatedAt: now,
  });

  await database.db.insert(floors).values({
    id: nanoid(),
    sessionId,
floorNo: 0,
    branchId: "main",
    parentFloorId: null,
    supersededAt: null,
    supersededByFloorId: null,
    state: "committed",
    metadataJson: null,
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now,
    updatedAt: now,
  });

  if (args.branchId) {
    await database.db.insert(floors).values({
      id: nanoid(),
      sessionId,
      floorNo: 1,
      branchId: args.branchId,
      parentFloorId: null,
      supersededAt: null,
      supersededByFloorId: null,
      state: "committed",
      metadataJson: null,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });
  }

  return sessionId;
}

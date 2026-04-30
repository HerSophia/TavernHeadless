import { effectScope, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";

import type { ResolvedVariablesSnapshot } from "@tavern/sdk";

import { resolveLatestVariableContext, useWorkspaceInspectorVariables } from "./variables";

async function flushAsyncWork(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
}

describe("resolveLatestVariableContext", () => {
  it("prefers the latest persisted floor and page context and skips local draft rows", () => {
    expect(
      resolveLatestVariableContext([
        {
          at: 1,
          floorId: "floor-1",
          id: "remote-1",
          pageId: "page-1",
          persisted: true,
          seq: 1,
        },
        {
          at: 2,
          floorId: "floor-draft",
          id: "local-1",
          pageId: undefined,
          persisted: false,
          seq: 2,
        },
      ]),
    ).toEqual({
      floorId: "floor-1",
      pageId: "page-1",
    });
  });
});

describe("useWorkspaceInspectorVariables", () => {
  it("loads resolved rows for the active session context and reuses the cache by default", async () => {
    const accountId = ref("acc-1");
    const sessionId = ref("session-1");
    const timeline = ref([
      {
        at: 1,
        floorId: "floor-1",
        id: "remote-1",
        pageId: "page-1",
        persisted: true,
        seq: 1,
      },
      {
        at: 2,
        floorId: "floor-draft",
        id: "local-1",
        pageId: undefined,
        persisted: false,
        seq: 2,
      },
    ]);
    const resolveContext = vi.fn<
      (options: {
        accountId?: string;
        floorId?: string;
        includeLayers?: boolean;
        pageId?: string;
        sessionId: string;
      }) => Promise<ResolvedVariablesSnapshot>
    >().mockResolvedValue({
      context: {
        accountId: "acc-1",
        floorId: "floor-1",
        globalScopeId: "global",
        pageId: "page-1",
        sessionId: "session-1",
      },
      resolved: [
        {
          key: "mood",
          sourceScope: "floor",
          sourceScopeId: "floor-1",
          updatedAt: 200,
          value: "focused",
        },
      ],
    });

    const scope = effectScope();
    const state = scope.run(() => useWorkspaceInspectorVariables({
      accountId,
      resource: { resolveContext },
      sessionId,
      timeline,
    }));

    expect(state).toBeTruthy();
    await flushAsyncWork();

    expect(resolveContext).toHaveBeenCalledTimes(1);
    expect(resolveContext).toHaveBeenCalledWith({
      accountId: "acc-1",
      floorId: "floor-1",
      includeLayers: true,
      pageId: "page-1",
      sessionId: "session-1",
    });
    expect(state?.rows.value).toEqual([
      {
        key: "mood",
        layers: [
          {
            isWinning: true,
            preview: '"focused"',
            scope: "floor",
            scopeId: "floor-1",
            updatedAt: 200,
            value: "focused",
          },
        ],
        preview: '"focused"',
        sourceScope: "floor",
        sourceScopeId: "floor-1",
        updatedAt: 200,
        value: "focused",
      },
    ]);

    await state?.refresh();
    expect(resolveContext).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  it("loads staged writes and promotion groups when the page inspection APIs are available", async () => {
    const accountId = ref("acc-1");
    const sessionId = ref("session-1");
    const timeline = ref([
      {
        at: 1,
        floorId: "floor-1",
        id: "remote-1",
        pageId: "page-1",
        persisted: true,
        seq: 1,
      },
    ]);
    const resolveContext = vi.fn().mockResolvedValue({
      context: {
        accountId: "acc-1",
        floorId: "floor-1",
        globalScopeId: "global",
        pageId: "page-1",
        sessionId: "session-1",
      },
      resolved: [
        {
          key: "mood",
          sourceScope: "page",
          sourceScopeId: "page-1",
          updatedAt: 200,
          value: "steady",
        },
      ],
    } satisfies ResolvedVariablesSnapshot);
    const getPageStagedWrites = vi.fn().mockResolvedValue({
      pageId: "page-1",
      floorId: "floor-1",
      sessionId: "session-1",
      branchId: "main",
      items: [
        {
          id: "staged-1",
          key: "mood",
          op: "set",
          value: "steady",
          intent: "promote_to_floor_on_accept",
          conflictPolicy: "replace",
          reason: "builtin:set_variable",
          source: { toolName: "set_variable" },
          evidence: { runId: "run-1" },
          status: "promoted",
          decisionReason: null,
          createdAt: 100,
          resolvedAt: 101,
        },
      ],
    });
    const getPagePromotions = vi.fn().mockResolvedValue({
      pageId: "page-1",
      floorId: "floor-1",
      sessionId: "session-1",
      branchId: "main",
      items: [
        {
          id: "trace-1",
          stagedWriteId: "staged-1",
          key: "mood",
          fromScope: "page",
          fromScopeId: "page-1",
          toScope: "floor",
          toScopeId: "floor-1",
          conflictPolicy: "replace",
          sourceVariableId: "var-page-1",
          targetVariableId: "var-floor-1",
          value: "steady",
          createdAt: 102,
        },
      ],
    });

    const scope = effectScope();
    const state = scope.run(() => useWorkspaceInspectorVariables({
      accountId,
      resource: { resolveContext, getPageStagedWrites, getPagePromotions },
      sessionId,
      timeline,
    }));

    await flushAsyncWork();

    expect(getPageStagedWrites).toHaveBeenCalledWith({ accountId: "acc-1", pageId: "page-1" });
    expect(getPagePromotions).toHaveBeenCalledWith({ accountId: "acc-1", pageId: "page-1" });
    expect(state?.stagedWrites.value).toEqual([
      expect.objectContaining({ id: "staged-1", key: "mood", preview: '"steady"', status: "promoted" }),
    ]);
    expect(state?.promotionGroups.value).toEqual([
      expect.objectContaining({ key: "mood", latestCreatedAt: 102 }),
    ]);

    scope.stop();
  });

  it("bypasses the cache on forced refresh and clears state when the session disappears", async () => {
    const accountId = ref("acc-1");
    const sessionId = ref<string | null>("session-1");
    const timeline = ref([
      {
        at: 1,
        floorId: "floor-1",
        id: "remote-1",
        pageId: "page-1",
        persisted: true,
        seq: 1,
      },
    ]);
    const resolveContext = vi
      .fn<
        (options: {
          accountId?: string;
          floorId?: string;
          includeLayers?: boolean;
          pageId?: string;
          sessionId: string;
        }) => Promise<ResolvedVariablesSnapshot>
      >()
      .mockResolvedValueOnce({
        context: {
          accountId: "acc-1",
          floorId: "floor-1",
          globalScopeId: "global",
          pageId: "page-1",
          sessionId: "session-1",
        },
        resolved: [
          {
            key: "hp",
            sourceScope: "page",
            sourceScopeId: "page-1",
            updatedAt: 100,
            value: 90,
          },
        ],
      })
      .mockResolvedValueOnce({
        context: {
          accountId: "acc-1",
          floorId: "floor-1",
          globalScopeId: "global",
          pageId: "page-1",
          sessionId: "session-1",
        },
        resolved: [
          {
            key: "hp",
            sourceScope: "page",
            sourceScopeId: "page-1",
            updatedAt: 101,
            value: 95,
          },
        ],
      });

    const scope = effectScope();
    const state = scope.run(() => useWorkspaceInspectorVariables({
      accountId,
      resource: { resolveContext },
      sessionId,
      timeline,
    }));

    expect(state).toBeTruthy();
    await flushAsyncWork();
    await state?.refresh(true);

    expect(resolveContext).toHaveBeenCalledTimes(2);
    expect(state?.rows.value[0]?.preview).toBe("95");

    sessionId.value = null;
    await flushAsyncWork();

    expect(state?.rawSnapshot.value).toBeNull();
    expect(state?.rows.value).toEqual([]);
    expect(state?.error.value).toBeNull();

    scope.stop();
  });
});

import { describe, expect, it, vi } from "vitest";

import { TavernApiError, type ClientDataItemRecord, type ProjectEventRecord, type TavernClient } from "@tavern/sdk";

import * as clientHelpers from "../index.js";
import { mapApiErrorToUiState } from "../errors/map-api-error-to-ui-state.js";
import { getDisplayPage } from "../selectors/get-display-page.js";
import { getActivePage } from "../selectors/get-active-page.js";
import { groupToolEventsByExecution } from "../stream/group-tool-events-by-execution.js";
import { createInitialRespondStreamState, reduceRespondStream } from "../stream/reduce-respond-stream.js";
import { buildTimelineMessages } from "../timeline/build-timeline-messages.js";
import { flattenVariableSnapshot, formatVariablePreview, sortVariableInspectorRows } from "../variables/index.js";
import { resolveUsage } from "../usage/resolve-usage.js";
import {
  applyProjectEventCursor,
  dedupeProjectEvents,
  getProjectEventCursor,
  isProjectEvent,
} from "../projects/index.js";
import { summarizeRuntimeToolCatalog } from "../tools/summarize-runtime-tool-catalog.js";
import {
  buildApplicationOwner,
  buildPluginOwner,
  groupItemsByCollection,
  organizeCollectionItems,
  resolveItemByPath,
  toClientDataMap,
} from "../client-data/index.js";

describe("client-helpers public exports", () => {
  it("exposes the expected runtime helpers", () => {
    expect(clientHelpers).toMatchObject({
      applyProjectEventCursor: expect.any(Function),
      buildApplicationOwner: expect.any(Function),
      buildPluginOwner: expect.any(Function),
      buildTimelineMessages: expect.any(Function),
      createInitialRespondStreamState: expect.any(Function),
      dedupeProjectEvents: expect.any(Function),
      getActivePage: expect.any(Function),
      getDisplayPage: expect.any(Function),
      getProjectEventCursor: expect.any(Function),
      flattenVariableSnapshot: expect.any(Function),
      formatVariablePreview: expect.any(Function),
      groupItemsByCollection: expect.any(Function),
      groupToolEventsByExecution: expect.any(Function),
      isProjectEvent: expect.any(Function),
      mapApiErrorToUiState: expect.any(Function),
      organizeCollectionItems: expect.any(Function),
      reduceRespondStream: expect.any(Function),
      resolveItemByPath: expect.any(Function),
      resolveUsage: expect.any(Function),
      summarizeRuntimeToolCatalog: expect.any(Function),
      sortVariableInspectorRows: expect.any(Function),
      toClientDataMap: expect.any(Function),
    });
  });

  it("re-exports variable snapshot helpers from the package entry", () => {
    expect(clientHelpers.flattenVariableSnapshot).toBe(flattenVariableSnapshot);
    expect(clientHelpers.formatVariablePreview).toBe(formatVariablePreview);
    expect(clientHelpers.sortVariableInspectorRows).toBe(sortVariableInspectorRows);
  });
});

describe("project event helpers", () => {
  const event: ProjectEventRecord = {
    actorAccountId: "acc-1",
    actorClientId: null,
    branchId: "main",
    causationEventId: null,
    correlationId: "corr-1",
    createdAt: 100,
    floorId: "floor-1",
    id: "evt-1",
    messageId: "msg-1",
    operationLogId: "op-1",
    pageId: "page-1",
    payload: { count: 1 },
    projectId: "proj-1",
    sequence: 3,
    sessionId: "sess-1",
    source: "api",
    type: "session.updated",
    visibility: "project",
    workspaceId: "ws-1",
  };

  it("recognizes normalized SDK project events", () => {
    expect(isProjectEvent(event)).toBe(true);
    expect(isProjectEvent({ ...event, sequence: 0 })).toBe(false);
    expect(isProjectEvent({ ...event, visibility: "private" })).toBe(false);
    expect(isProjectEvent({ ...event, source: "client" })).toBe(false);
  });

  it("reads and applies project event cursors", () => {
    expect(getProjectEventCursor(event)).toBe(3);
    expect(getProjectEventCursor({})).toBeNull();
    expect(applyProjectEventCursor(null, event)).toBe(3);
    expect(applyProjectEventCursor(10, event)).toBe(10);
    expect(applyProjectEventCursor("2", event)).toBe(3);
    expect(applyProjectEventCursor("bad", event)).toBe(3);
    expect(applyProjectEventCursor(5, {})).toBe(5);
  });

  it("deduplicates project events by project and sequence", () => {
    expect(dedupeProjectEvents([
      event,
      { ...event, id: "evt-duplicate" },
      { ...event, id: "evt-2", sequence: 4 },
      { ...event, id: "evt-other-project", projectId: "proj-2" },
      { invalid: true },
    ])).toEqual([
      event,
      { ...event, id: "evt-2", sequence: 4 },
      { ...event, id: "evt-other-project", projectId: "proj-2" },
    ]);
  });
});

describe("client data helpers", () => {
  const items: ClientDataItemRecord[] = [
    {
      id: "item-1",
      domainId: "domain-1",
      collectionId: "collection-a",
      itemKey: "theme",
      valueJson: { mode: "dark" },
      byteSize: 16,
      version: 1,
      expiresAt: null,
      createdAt: 10,
      updatedAt: 20,
    },
    {
      id: "item-2",
      domainId: "domain-1",
      collectionId: "collection-a",
      itemKey: "locale",
      valueJson: "en-US",
      byteSize: 8,
      version: 1,
      expiresAt: null,
      createdAt: 11,
      updatedAt: 21,
    },
    {
      id: "item-3",
      domainId: "domain-1",
      collectionId: "collection-b",
      itemKey: "layout",
      valueJson: "compact",
      byteSize: 10,
      version: 1,
      expiresAt: null,
      createdAt: 12,
      updatedAt: 22,
    },
  ];

  it("builds plugin and application owner descriptors", () => {
    expect(buildPluginOwner("plugin-1")).toEqual({ ownerType: "plugin", ownerId: "plugin-1" });
    expect(buildApplicationOwner("app-1")).toEqual({ ownerType: "application", ownerId: "app-1" });
  });

  it("groups items by collection id", () => {
    expect(groupItemsByCollection(items)).toEqual({
      "collection-a": [items[0], items[1]],
      "collection-b": [items[2]],
    });
  });

  it("organizes items into collection sections", () => {
    expect(organizeCollectionItems(items)).toEqual([
      { collectionId: "collection-a", items: [items[0], items[1]] },
      { collectionId: "collection-b", items: [items[2]] },
    ]);
  });

  it("converts items into a collection keyed value map", () => {
    expect(toClientDataMap(items, [
      { id: "collection-a", collectionName: "settings" },
      { id: "collection-b", collectionName: "layout" },
    ])).toEqual({
      settings: {
        theme: { mode: "dark" },
        locale: "en-US",
      },
      layout: {
        layout: "compact",
      },
    });
  });

  it("falls back to collection id when collection names are not provided", () => {
    expect(toClientDataMap(items)).toEqual({
      "collection-a": {
        theme: { mode: "dark" },
        locale: "en-US",
      },
      "collection-b": {
        layout: "compact",
      },
    });
  });

  it("resolves item by path through sdk resource", async () => {
    const expected = items[0];
    const getByKey = vi.fn().mockResolvedValue(expected);
    const client = {
      clientData: {
        items: {
          getByKey,
        },
      },
    } as unknown as Pick<TavernClient, "clientData">;

    await expect(resolveItemByPath(client, "domain-1", "settings", "theme", { accountId: "acc-1" })).resolves.toEqual(expected);
    expect(getByKey).toHaveBeenCalledWith({
      accountId: "acc-1",
      domainId: "domain-1",
      collectionName: "settings",
      itemKey: "theme",
    });
  });
});

describe("resolveUsage", () => {
  it("normalizes mixed usage fields", () => {
    expect(
      resolveUsage({
        completion_tokens: 4,
        prompt_tokens: 6,
      }),
    ).toMatchObject({
      inputTokens: 6,
      outputTokens: 4,
      totalTokens: 10,
    });
  });

  it("prefers explicit input output and total tokens when available", () => {
    expect(
      resolveUsage({
        input_tokens: 3,
        output_tokens: 2,
        total_tokens: 99,
      }),
    ).toMatchObject({
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 99,
    });
  });

  it("returns zeroed usage for nullish input", () => {
    expect(resolveUsage(null)).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });
});

describe("getActivePage", () => {
  it("returns activePage when it exists", () => {
    const activePage = { id: "active" };
    const fallbackPage = { id: "fallback" };

    expect(
      getActivePage({
        activePage,
        pages: [fallbackPage],
      }),
    ).toBe(activePage);
  });

  it("falls back to the first page when activePage is missing", () => {
    const firstPage = { id: "page-1" };
    const secondPage = { id: "page-2" };

    expect(
      getActivePage({
        pages: [firstPage, secondPage],
      }),
    ).toBe(firstPage);
  });

  it("returns null when pages are empty nullish or malformed", () => {
    expect(getActivePage({ pages: [] })).toBeNull();
    expect(getActivePage({ pages: null })).toBeNull();
    expect(getActivePage({ pages: [undefined] as unknown as Array<{ id: string }> })).toBeNull();
  });
});

describe("getDisplayPage", () => {
  it("prefers pending output over active page", () => {
    const pending = { text: "draft" };
    const activePage = { id: "page-1" };

    expect(getDisplayPage({ pendingOutput: pending, activePage })).toBe(pending);
  });

  it("falls back to active page when pending output is absent", () => {
    const activePage = { id: "page-1" };
    expect(getDisplayPage({ activePage })).toBe(activePage);
  });

  it("falls back to first page when active page is missing", () => {
    const page = { id: "page-2" };
    expect(getDisplayPage({ pages: [page] })).toBe(page);
  });

  it("returns null when nothing is available", () => {
    expect(getDisplayPage({})).toBeNull();
  });
});

describe("buildTimelineMessages", () => {
  it("builds timeline messages from active pages", () => {
    const timeline = buildTimelineMessages([
      {
        activePage: {
          id: "page-1",
          isActive: true,
          messages: [
            {
              content: "hello",
              contentFormat: "markdown",
              id: "msg-1",
              role: "assistant",
              seq: 1,
            },
          ],
          pageKind: "main",
          pageNo: 1,
          version: 1,
        },
        pages: [],
        activePages: [],
        messages: [],
        createdAt: 100,
        floorNo: 1,
        id: "floor-1",
        pageCount: 1,
        state: "completed",
        tokenIn: 5,
        tokenOut: 7,
      },
    ]);

    expect(timeline).toEqual([
      {
        at: 100,
        content: "hello",
        contentFormat: "markdown",
        floorId: "floor-1",
        floorNo: 1,
        floorState: "completed",
        id: "msg-1",
        pageId: "page-1",
        role: "assistant",
        seq: 1,
        tokenIn: 5,
        tokenOut: 7,
      },
    ]);
  });

  it("skips unsupported entries and normalizes unknown content formats", () => {
    const timeline = buildTimelineMessages([
      {
        activePage: null,
        pages: [],
        activePages: [],
        messages: [],
        createdAt: 10,
        floorNo: 1,
        id: "floor-skip",
        pageCount: 0,
        state: "completed",
        tokenIn: 0,
        tokenOut:0,
      },
      {
        activePage: {
          id: "page-2",
          isActive: true,
          messages: [
            {
              content: "skip me",
              contentFormat: "markdown",
              id: "msg-skip",
              role: "tool",
              seq: 1,
            } as unknown as {
              content: string;
              contentFormat: string;
              id: string;
              role: string;
              seq: number;
            },
            {
              content: "plain fallback",
              contentFormat: "html",
              id: "msg-2",
              role: "user",
              seq: 2,
            },
            {
              content: "{\"ok\":true}",
              contentFormat: "json",
              id: "msg-3",
              role: "system",
              seq: 3,
            },
          ],
          pageKind: "branch",
          pageNo: 2,
          version: 4,
        },
        pages: [],
        activePages: [],
        messages: [],
        createdAt: 200,
        floorNo: 2,
        id: "floor-2",
        pageCount: 1,
        state: "completed",
        tokenIn: 11,
        tokenOut: 12,
      },
    ]);

    expect(timeline).toEqual([
      {
        at: 200,
        content: "plain fallback",
        contentFormat: "text",
        floorId: "floor-2",
        floorNo: 2,
        floorState: "completed",
        id: "msg-2",
        pageId: "page-2",
        role: "user",
        seq: 2,
        tokenIn: 11,
        tokenOut: 12,
      },
      {
        at: 200,
        content: "{\"ok\":true}",
        contentFormat: "json",
        floorId: "floor-2",
        floorNo: 2,
        floorState: "completed",
        id: "msg-3",
        pageId: "page-2",
        role: "system",
        seq: 3,
        tokenIn: 11,
        tokenOut: 12,
      },
    ]);
  });
});

describe("reduceRespondStream", () => {
  it("reduces stream events into final state", () => {
    const state1 = reduceRespondStream(createInitialRespondStreamState(), {
      payload: { branchId: "branch-1", floorId: "floor-1", floorNo: 2 },
      type: "start",
    });
    const state2 = reduceRespondStream(state1, {
      payload: { chunk: "Hello" },
      type: "chunk",
    });
    const state3 = reduceRespondStream(state2, {
      payload: {
        finalState: "committed",
        floorId: "floor-1",
        floorNo: 2,
        generatedText: "Hello",
        memory: { mode: "sync", status: "applied", jobId: null },
        promptSnapshot: {
          presetId: "preset-1",
          presetUpdatedAt: 1710000000000,
          presetVersion: 3,
          worldbookId: "worldbook-1",
          worldbookUpdatedAt: 1710000001000,
          worldbookVersion: 5,
          regexProfileId: "regex-1",
          regexProfileUpdatedAt: 1710000002000,
          regexProfileVersion: 2,
          worldbookActivatedEntryUids: [7],
          regexPreRuleNames: ["pre-rule"],
          regexPostRuleNames: [],
          promptMode: "compat_strict",
          promptDigest: "digest-1",
          tokenEstimate: 42,
        },
        runtimeTrace: {
          worldbook: { hitCount: 1 },
        },
        summaries: ["summary-1"],
        totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
      type: "done",
    });

    expect(state3.branchId).toBe("branch-1");
    expect(state3.status).toBe("done");
    expect(state3.result?.finalState).toBe("committed");
    expect(state3.result?.generatedText).toBe("Hello");
    expect(state3.result?.memory).toEqual({ mode: "sync", status: "applied", jobId: null });
    expect(state3.result?.promptSnapshot).toEqual({
      presetId: "preset-1",
      presetUpdatedAt: 1710000000000,
      presetVersion: 3,
      worldbookId: "worldbook-1",
      worldbookUpdatedAt: 1710000001000,
      worldbookVersion: 5,
      regexProfileId: "regex-1",
      regexProfileUpdatedAt: 1710000002000,
      regexProfileVersion: 2,
      worldbookActivatedEntryUids: [7],
      regexPreRuleNames: ["pre-rule"],
      regexPostRuleNames: [],
      promptMode: "compat_strict",
      promptDigest: "digest-1",
      tokenEstimate: 42,
    });
    expect(state3.result?.runtimeTrace).toEqual({ worldbook: { hitCount: 1 } });
    expect(state3.result?.summaries).toEqual(["summary-1"]);
    expect(state3.result?.totalTokens).toBe(15);
  });

  it("promotes idle chunks to streaming accumulates summaries and falls back to accumulated content", () => {
    const state1 = reduceRespondStream(createInitialRespondStreamState(), {
      payload: { chunk: "Hello" },
      type: "chunk",
    });
    const state2 = reduceRespondStream(state1, {
      payload: { chunk: " world" },
      type: "chunk",
    });
    const state3 = reduceRespondStream(state2, {
      payload: { summaries: ["s1", "s2"] },
      type: "summary",
    });
    const state4 = reduceRespondStream(state3, {
      payload: {
        floorId: "floor-9",
        floorNo: 9,
        summaries: [],
        totalUsage: {},
      },
      type: "done",
    });

    expect(state1.status).toBe("streaming");
    expect(state3.summaries).toEqual(["s1", "s2"]);
    expect(state4.summaries).toEqual(["s1", "s2"]);
    expect(state4.content).toBe("Hello world");
    expect(state4.result).toMatchObject({
      floorId: "floor-9",
      floorNo: 9,
      generatedText: "Hello world",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      summaries: ["s1", "s2"],
    });
  });

  it("captures error payload and uses fallback error message", () => {
    const state = reduceRespondStream(createInitialRespondStreamState(), {
      payload: { code: "stream_failed" },
      type: "error",
    });

    expect(state).toMatchObject({
      error: {
        code: "stream_failed",
        message: "Stream request failed",
      },
      status: "error",
    });
  });

  it("stores run snapshots and prefers pending output text during streaming", () => {
    const state = reduceRespondStream(createInitialRespondStreamState(), {
      payload: {
        attemptNo: 1,
        floorId: "floor-1",
        pendingOutput: {
          attemptNo: 1,
          startedAt: 100,
          state: "streaming",
          tempId: "temp-1",
          text: "partial",
          updatedAt: 120,
        },
        phase: "page_generating",
        phaseSeq: 3,
        publicPhase: "generating",
        runId: "run-1",
        runType: "respond",
        startedAt: 90,
        status: "running",
        updatedAt: 120,
      },
      type: "run",
    });

    expect(state.run?.runId).toBe("run-1");
    expect(state.content).toBe("partial");
    expect(state.status).toBe("streaming");
  });

  it("accumulates tool events active tools and warnings", () => {
    const state1 = reduceRespondStream(createInitialRespondStreamState(), {
      payload: {
        executionId: "exec-1",
        toolName: "set_variable",
        providerId: "builtin",
        providerType: "builtin",
        sideEffectLevel: "sandbox",
        phase: "start",
        replaySafety: "uncertain",
      },
      type: "tool",
    });
    const state2 = reduceRespondStream(state1, {
      payload: {
        executionId: "exec-1",
        toolName: "set_variable",
        providerId: "builtin",
        providerType: "builtin",
        sideEffectLevel: "sandbox",
        phase: "success",
        durationMs: 7,
        replaySafety: "safe",
      },
      type: "tool",
    });
    const state3 = reduceRespondStream(state2, {
      payload: {
        executionId: "exec-2",
        toolName: "create_character",
        providerId: "mcp:studio",
        providerType: "mcp",
        sideEffectLevel: "irreversible",
        phase: "uncertain",
        message: "timeout",
        replaySafety: "uncertain",
      },
      type: "tool",
    });

    expect(state1.activeTools).toEqual({
      "exec-1": {
        executionId: "exec-1",
        toolName: "set_variable",
        providerId: "builtin",
        providerType: "builtin",
        sideEffectLevel: "sandbox",
        phase: "start",
        replaySafety: "uncertain",
      },
    });
    expect(state2.activeTools).toEqual({});
    expect(state3.toolEvents).toHaveLength(3);
    expect(state3.warnings).toEqual([
      {
        code: "tool_execution_uncertain",
        executionId: "exec-2",
        message: "timeout",
        toolName: "create_character",
      },
    ]);
  });
});

describe("tool helpers", () => {
  it("groups tool events by execution and keeps the latest terminal state", () => {
    const groups = groupToolEventsByExecution([
      { executionId: "exec-1", toolName: "set_variable", providerId: "builtin", phase: "start", replaySafety: "uncertain" },
      { executionId: "exec-1", toolName: "set_variable", providerId: "builtin", phase: "success", durationMs: 7, replaySafety: "safe" },
      { executionId: "exec-2", toolName: "create_character", providerId: "mcp:studio", phase: "blocked", replaySafety: "safe", message: "blocked" },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({ executionId: "exec-1", isTerminal: true, phases: ["start", "success"], replaySafety: "safe", durationMs: 7 }),
      expect.objectContaining({ executionId: "exec-2", isTerminal: true, message: "blocked", phases: ["blocked"] }),
    ]);
  });

  it("summarizes runtime tool catalog availability and replay warnings", () => {
    expect(summarizeRuntimeToolCatalog({
      sessionId: "session-1",
      generatedAt: 1,
      tools: [
        { name: "set_variable", providerId: "builtin", providerType: "builtin", source: "builtin", sideEffectLevel: "sandbox", allowedSlots: ["narrator"], availability: "available", availabilityReason: null, catalogSource: null, replaySafety: "safe", asyncCapability: "inline_only", defaultDeliveryMode: "inline", resultVisibility: "immediate", sideEffectLevelBasis: null, allowedSlotsBasis: null, parameterSchemaBasis: null, replaySafetyBasis: null, exposure: null, metadataBasisDetail: null },
        { name: "mcp_fetch", providerId: "mcp:mcp-1", providerType: "mcp", source: "mcp", sideEffectLevel: "irreversible", allowedSlots: ["narrator"], availability: "available", availabilityReason: null, catalogSource: "live", replaySafety: "never_auto_replay", asyncCapability: "deferred_ok", defaultDeliveryMode: "async_job", resultVisibility: "deferred_receipt", sideEffectLevelBasis: "server_default", allowedSlotsBasis: "platform_default", parameterSchemaBasis: "shallow_schema_projection", replaySafetyBasis: "inferred_from_execution_policy", exposure: null, metadataBasisDetail: null },
        { name: "conflict_tool", providerId: "mcp:mcp-2", providerType: "mcp", source: "mcp", sideEffectLevel: "sandbox", allowedSlots: ["narrator"], availability: "conflict", availabilityReason: "name_conflict", catalogSource: "cached", replaySafety: "confirm_on_replay", asyncCapability: "inline_only", defaultDeliveryMode: "inline", resultVisibility: "immediate", sideEffectLevelBasis: "server_default", allowedSlotsBasis: "platform_default", parameterSchemaBasis: "shallow_schema_projection", replaySafetyBasis: "inferred_from_execution_policy", exposure: null, metadataBasisDetail: null },
      ],
      conflicts: [{ toolName: "conflict_tool", providerIds: ["custom:acc-1", "mcp:mcp-2"], reason: "name_conflict" }],
    })).toEqual({
      availableTools: 2,
      confirmOnReplayTools: 1,
      conflictRecords: 1,
      conflictTools: 1,
      neverAutoReplayTools: 1,
      replayWarnings: 2,
      safeTools: 1,
      totalTools: 3,
      unavailableTools: 0,
      uncertainTools: 0,
    });
  });
});

describe("mapApiErrorToUiState", () => {
  it.each([
    [401, "authentication", false],
    [403, "authorization", false],
    [404, "not_found", false],
    [409, "conflict", true],
    [400, "validation", false],
    [422, "validation", false],
    [503, "server", true],
    [418, "unknown", false],
  ] as const)("maps TavernApiError status %i", (status, kind, retryable) => {
    const mapped = mapApiErrorToUiState(
      new TavernApiError({
        code: "ERR_TEST",
        message: `status-${status}`,
        status,
      }),
    );

    expect(mapped).toEqual({
      code: "ERR_TEST",
      kind,
      message: `status-${status}`,
      retryable,
      status,
    });
  });

  it.each([
    ["generation_conflict", 500, "conflict", true],
    ["generation_queue_timeout", 200, "server", true],
    ["generation_timeout", 200, "server", true],
 ["commit_busy", 200, "server", true],
    ["commit_conflict", 500, "conflict", true],
    ["preset_conflict", 409, "conflict", true],
    ["worldbook_conflict", 409, "conflict", true],
    ["regex_profile_conflict", 409, "conflict", true],
    ["tool_catalog_conflict", 409, "conflict", true],
    ["tool_replay_blocked", 409, "conflict", true],
    ["tool_replay_confirmation_required", 409, "conflict", true],
    ["session_state_replay_blocked", 409, "conflict", true],
    ["session_state_replay_confirmation_required", 409, "conflict", true],
    ["replay_confirmation_required", 409, "conflict", true],
    ["mcp_call_uncertain_timeout", 503, "server", true],
    ["generation_cancelled", 499, "network", true],
    ["resource_busy", 503, "server", true],
    ["profile_conflict", 409, "conflict", false],
    ["profile_in_use", 409, "conflict", false],
    ["profile_inactive", 409, "conflict", false],
    ["binding_not_found", 404, "not_found", false],
    ["session_scope_not_found", 404, "not_found", false],
    ["instance_slot_disabled_required", 409, "conflict", false],
    ["turn_commit_failed", 409, "server", true],
  ] as const)("prefers known api code mapping for %s", (code, status, kind, retryable) => {
    const mapped = mapApiErrorToUiState(
      new TavernApiError({
        code,
        message: code,
        status,
      }),
    );

    expect(mapped).toEqual({
      code,
      kind,
      message: code,
      retryable,
      status,
    });
  });

  it("falls back to generic status mapping for unknown api codes", () => {
    expect(
      mapApiErrorToUiState(
        new TavernApiError({
          code: "something_else",
          message: "Conflict",
          status: 409,
        }),
      ),
    ).toEqual({ code: "something_else", kind: "conflict", message: "Conflict", retryable: true, status: 409 });
  });

  it("maps TypeError to network state", () => {
    expect(mapApiErrorToUiState(new TypeError("Connection lost"))).toEqual({
      kind: "network",
      message: "Connection lost",
      retryable: true,
    });
  });

  it("maps generic Error to unknown state", () => {
    expect(mapApiErrorToUiState(new Error("Boom"))).toEqual({
      kind: "unknown",
      message: "Boom",
      retryable: false,
    });
  });

  it("maps non-error values to a generic unknown state", () => {
    expect(mapApiErrorToUiState("boom")).toEqual({
      kind: "unknown",
      message: "Unknown error",
      retryable: false,
    });
  });
});

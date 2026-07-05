import { afterEach, describe, expect, it } from "vitest";

import { buildApp, type BuildAppResult } from "../../app.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { floors, messagePages, messages, sessions, toolExecutionRecords } from "../../db/schema.js";

/**
 * NG2-11：inspect 响应 floor 序列化 tool_executions 的契约回归。
 *
 * 覆盖：
 * - 非受限（client_visible）：inspect floor 含 tool_executions，字段与 transcript 逐字段一致；无工具调用时为 []。
 * - 受限（agent-private / internal，无 include_agent_private）：args / result / error_message 为 null，结构字段保留。
 *
 * 脱敏由 service 独占，route 只做原样序列化；此测试守住「不在 route 层重复脱敏，也不丢字段」。
 */

async function buildTemporaryConversationApp(): Promise<BuildAppResult> {
  const built = await buildApp({
    databasePath: ":memory:",
    auth: { mode: "off" },
    accountMode: "single",
    // 临时对话路由仅在启用 orchestration（构造出 temporaryConversationService）时装配。
    orchestration: {
      providers: [
        {
          id: "test-provider",
          type: "openai-compatible",
          apiKey: "sk-test",
        },
      ],
      defaultModel: {
        providerId: "test-provider",
        modelId: "gpt-4o-mini",
      },
    },
  });
  await built.app.ready();
  return built;
}

type SeedOptions = {
  conversationId: string;
  visibility: "internal" | "client_visible";
  /** 是否为「无工具调用」的第二个楼层补一条空执行楼层。 */
  withEmptyFloor?: boolean;
};

const NOW = 1_736_520_000_000;

async function seedTemporaryConversationWithToolExecutions(
  built: BuildAppResult,
  { conversationId, visibility, withEmptyFloor = false }: SeedOptions,
): Promise<{ floorId: string; emptyFloorId: string | null }> {
  const floorId = `${conversationId}-floor-1`;
  const pageId = `${conversationId}-page-1`;

  await built.database.insert(sessions).values({
    id: conversationId,
    title: "Inspect tool executions",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    kind: "temporary",
    purpose: "snapshot",
    temporarySourceSessionId: `${conversationId}-source`,
    retentionPolicy: "keep_for_debug",
    visibility,
    lastActivityAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });

  await built.database.insert(floors).values({
    id: floorId,
    sessionId: conversationId,
    floorNo: 1,
    branchId: "main",
    parentFloorId: null,
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });

  await built.database.insert(messagePages).values({
    id: pageId,
    floorId,
    pageNo: 1,
    pageKind: "output",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: NOW,
    updatedAt: NOW,
  });

  await built.database.insert(messages).values({
    id: `${pageId}-msg-1`,
    pageId,
    seq: 0,
    role: "assistant",
    content: "done",
    contentFormat: "text",
    createdAt: NOW,
  });

  await built.database.insert(toolExecutionRecords).values([
    {
      id: `${conversationId}-exec-1`,
      runId: "run-1",
      floorId,
      pageId,
      callerSlot: "narrator",
      providerId: "builtin",
      toolName: "search_memory",
      providerType: "builtin",
      argsJson: JSON.stringify({ query: "topic" }),
      resultJson: JSON.stringify({ hits: 2 }),
      status: "success",
      commitOutcome: "committed",
      sideEffectLevel: "none",
      errorMessage: null,
      durationMs: 12,
      startedAt: NOW,
      finishedAt: NOW + 12,
      attemptNo: 1,
      replayParentExecutionId: null,
      generationStepNo: 1,
      createdAt: NOW,
    },
    {
      id: `${conversationId}-exec-2`,
      runId: "run-1",
      floorId,
      pageId,
      callerSlot: "narrator",
      providerId: "builtin",
      toolName: "write_note",
      providerType: "builtin",
      argsJson: JSON.stringify({ text: "note" }),
      resultJson: JSON.stringify({ ok: false }),
      status: "error",
      commitOutcome: "discarded",
      sideEffectLevel: "sandbox",
      errorMessage: "boom",
      durationMs: 5,
      startedAt: NOW + 20,
      finishedAt: NOW + 25,
      attemptNo: 2,
      replayParentExecutionId: `${conversationId}-exec-1`,
      generationStepNo: 2,
      createdAt: NOW + 20,
    },
  ]);

  let emptyFloorId: string | null = null;
  if (withEmptyFloor) {
    emptyFloorId = `${conversationId}-floor-2`;
    const emptyPageId = `${conversationId}-page-2`;
    await built.database.insert(floors).values({
      id: emptyFloorId,
      sessionId: conversationId,
      floorNo: 2,
      branchId: "main",
      parentFloorId: floorId,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: NOW + 100,
      updatedAt: NOW + 100,
    });
    await built.database.insert(messagePages).values({
      id: emptyPageId,
      floorId: emptyFloorId,
      pageNo: 1,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: NOW + 100,
      updatedAt: NOW + 100,
    });
    await built.database.insert(messages).values({
      id: `${emptyPageId}-msg-1`,
      pageId: emptyPageId,
      seq: 0,
      role: "assistant",
      content: "no tools",
      contentFormat: "text",
      createdAt: NOW + 100,
    });
  }

  return { floorId, emptyFloorId };
}

describe("temporary conversation inspect tool executions serialization", () => {
  const builtApps: BuildAppResult[] = [];

  afterEach(async () => {
    while (builtApps.length > 0) {
      const built = builtApps.pop();
      if (built) {
        await built.app.close();
      }
    }
  });

  it("serializes tool_executions on inspect floors and matches the transcript field shape", async () => {
    const built = await buildTemporaryConversationApp();
    builtApps.push(built);

    const conversationId = "temp-inspect-visible";
    const { floorId, emptyFloorId } = await seedTemporaryConversationWithToolExecutions(built, {
      conversationId,
      visibility: "client_visible",
      withEmptyFloor: true,
    });

    const inspectResponse = await built.app.inject({
      method: "GET",
      url: `/temporary-conversations/${encodeURIComponent(conversationId)}/inspect`,
    });
    expect(inspectResponse.statusCode, inspectResponse.body).toBe(200);
    const inspectBody = inspectResponse.json();
    expect(inspectBody.data.transcript_restricted).toBe(false);

    const inspectFloors: Array<Record<string, unknown>> = inspectBody.data.transcript.floors;
    const inspectFloor = inspectFloors.find((floor) => floor.id === floorId);
    expect(inspectFloor).toBeDefined();
    const inspectExecutions = inspectFloor?.tool_executions as Array<Record<string, unknown>>;

    expect(inspectExecutions).toEqual([
      {
        id: `${conversationId}-exec-1`,
        tool_name: "search_memory",
        status: "success",
        args: { query: "topic" },
        result: { hits: 2 },
        side_effect_level: "none",
        commit_outcome: "committed",
        error_message: null,
        duration_ms: 12,
        started_at: NOW,
        finished_at: NOW + 12,
        attempt_no: 1,
        replay_parent_execution_id: null,
        generation_step_no: 1,
      },
      {
        id: `${conversationId}-exec-2`,
        tool_name: "write_note",
        status: "error",
        args: { text: "note" },
        result: { ok: false },
        side_effect_level: "sandbox",
        commit_outcome: "discarded",
        error_message: "boom",
        duration_ms: 5,
        started_at: NOW + 20,
        finished_at: NOW + 25,
        attempt_no: 2,
        replay_parent_execution_id: `${conversationId}-exec-1`,
        generation_step_no: 2,
      },
    ]);

    // 无工具调用的楼层：tool_executions 恒为空数组。
    const emptyFloor = inspectFloors.find((floor) => floor.id === emptyFloorId);
    expect(emptyFloor).toBeDefined();
    expect(emptyFloor?.tool_executions).toEqual([]);

    // 与 transcript 逐字段一致：同一楼层的 tool_executions 深度相等。
    const transcriptResponse = await built.app.inject({
      method: "GET",
      url: `/temporary-conversations/${encodeURIComponent(conversationId)}/transcript`,
    });
    expect(transcriptResponse.statusCode, transcriptResponse.body).toBe(200);
    const transcriptFloors: Array<Record<string, unknown>> = transcriptResponse.json().data.floors;
    const transcriptFloor = transcriptFloors.find((floor) => floor.id === floorId);
    expect(transcriptFloor?.tool_executions).toEqual(inspectExecutions);
  });

  it("redacts args / result / error_message when the conversation is agent-private and access is not granted", async () => {
    const built = await buildTemporaryConversationApp();
    builtApps.push(built);

    const conversationId = "temp-inspect-internal";
    const { floorId } = await seedTemporaryConversationWithToolExecutions(built, {
      conversationId,
      visibility: "internal",
    });

    const inspectResponse = await built.app.inject({
      method: "GET",
      url: `/temporary-conversations/${encodeURIComponent(conversationId)}/inspect`,
    });
    expect(inspectResponse.statusCode, inspectResponse.body).toBe(200);
    const inspectBody = inspectResponse.json();
    expect(inspectBody.data.agent_private).toBe(true);
    expect(inspectBody.data.transcript_restricted).toBe(true);

    const inspectFloors: Array<Record<string, unknown>> = inspectBody.data.transcript.floors;
    const inspectFloor = inspectFloors.find((floor) => floor.id === floorId);
    const inspectExecutions = inspectFloor?.tool_executions as Array<Record<string, unknown>>;

    expect(inspectExecutions).toEqual([
      {
        id: `${conversationId}-exec-1`,
        tool_name: "search_memory",
        status: "success",
        args: null,
        result: null,
        side_effect_level: "none",
        commit_outcome: "committed",
        error_message: null,
        duration_ms: 12,
        started_at: NOW,
        finished_at: NOW + 12,
        attempt_no: 1,
        replay_parent_execution_id: null,
        generation_step_no: 1,
      },
      {
        id: `${conversationId}-exec-2`,
        tool_name: "write_note",
        status: "error",
        args: null,
        result: null,
        side_effect_level: "sandbox",
        commit_outcome: "discarded",
        error_message: null,
        duration_ms: 5,
        started_at: NOW + 20,
        finished_at: NOW + 25,
        attempt_no: 2,
        replay_parent_execution_id: `${conversationId}-exec-1`,
        generation_step_no: 2,
      },
    ]);
  });
});

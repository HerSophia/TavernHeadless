import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  SimpleTokenCounter,
  type TurnExecutionResult,
  type TurnInput,
  type TurnOrchestrator,
} from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../../accounts/constants.js";
import {
  floors,
  presets,
  regexProfiles,
  sessionBranches,
  sessions,
  worldbooks,
} from "../../../db/schema.js";
import { ChatService } from "../../chat/chat-service.js";
import { FloorRunService } from "../../floor-run-service.js";
import { TemporaryConversationService } from "../../temporary-conversation-service.js";
import { SessionBranchRegistryService } from "../../variables/host/session-branch-registry-service.js";
import { AgentExecutorRouter } from "../agent-executor-router.js";
import { TemporaryConversationAgentExecutor } from "../temporary-conversation-agent-executor.js";
import { PromptAgentRunner } from "../prompt-agent-runner.js";

const promptAssemblerMocks = vi.hoisted(() => ({
  assemblePrompt: vi.fn(),
}));

vi.mock("../../prompt-assembler.js", async () => {
  const actual = await vi.importActual<typeof import("../../prompt-assembler.js")>("../../prompt-assembler.js");
  return {
    ...actual,
    assemblePrompt: promptAssemblerMocks.assemblePrompt,
  };
});

/**
 * T3 阶段五集成测试：用真实 TemporaryConversationService + 内存数据库 + mock orchestrator，
 * 验证 PromptAgentRunner 能把 PromptAgent 真正跑在临时对话上，并保持默认非正史边界。
 */
describe("PromptAgentRunner 集成（真实临时对话服务）", () => {
  let database: DatabaseConnection;
  let chatService: ChatService;
  let temporaryConversationService: TemporaryConversationService;
  let runner: PromptAgentRunner;

  beforeEach(() => {
    database = createDatabase(":memory:");
    promptAssemblerMocks.assemblePrompt.mockReset();
    promptAssemblerMocks.assemblePrompt.mockImplementation(async (_db, _accountId,_sessionInfo, history, userMessage) => ({
      messages: [
        ...history,
        { role: "user", content: userMessage },
      ],
      sendDirectives: {},
      promptSnapshot: {
        presetId: null,
        presetUpdatedAt: null,
        presetVersion: null,
        worldbookId: null,
        worldbookUpdatedAt: null,
        worldbookVersion: null,
        regexProfileId: null,
        regexProfileUpdatedAt: null,
        regexProfileVersion: null,
        worldbookActivatedEntryUids: [],
     regexPreRuleNames: [],
        regexPostRuleNames: [],
        promptMode: "native" as const,
        promptDigest: "prompt-agent-runner-integration",
        tokenEstimate: 0,
        createdAt: 1_736_200_000_000,
      },
      tokenUsage: {
        total: 4,
        availableForReply: 96,
        byGroup: {},
        bySection: [],
        prunedByGroup: {},
      allocator: {
          trimReasons: [],
          estimatedByGroup: {},
          allocatedByGroup: {},
        },
      },
      runtimeTraceSeed: {
        worldbookHits: 0,
        macroStagedMutations: [],
      },
    }));

    chatService = new ChatService(
      database.db,
      createMockTurnOrchestrator(),
      new SimpleTokenCounter(),
      {
        resolveTurnModels: async ()=> ({
       narrator: {
            source: "env",
            generationParams: { maxOutputTokens: 128 },
          },
        }),
        floorRunService: new FloorRunService(database.db),
      },
    );

    temporaryConversationService = new TemporaryConversationService(database.db, chatService, {
      tokenCounter: new SimpleTokenCounter(),
    });

    const executor = new TemporaryConversationAgentExecutor(temporaryConversationService);
    const router = new AgentExecutorRouter(executor);
 runner = new PromptAgentRunner(router);
  });

  afterEach(() => {
    database.close();
  });

  it("draft_assistant 在临时对话上以 return_inline 真实运行并 finalize，不导出且不污染源会话", async () => {
    const source = await seedSourceSession(database, Date.now());

    const lineage = { rootRunId: "root_int_1", sourceAgentRunId: "run_int_1" };
    const result = await runner.run({
      agent: "draft_assistant",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: { kind: "session", sourceSessionId: source.sessionId },
      inputMessage: "请给这一段写个草稿",
      lineage,
    });

    // 执行结果：return_inline 不导出，临时对话被 finalize。
    expect(result.status).toBe("completed");
    expect(result.medium.deliveryTarget).toBe("return_inline");
    expect(result.result?.text).toContain("reply:请给这一段写个草稿");
    expect(result.exportResult).toBeUndefined();
    expect(result.dispatchResult).toBeUndefined();

    // 审计快照：保留 lineage、purpose、retentionPolicy 与 operation log。
    const audit = result.auditSnapshot;
    expect(audit.purpose).toBe("draft");
    expect(audit.deliveryTarget).toBe("return_inline");
    expect(audit.retentionPolicy).toBe("delete_on_finalize");
    expect(audit.lineage).toEqual(lineage);
    expect(audit.operationLog.map((entry) => entry.type)).toEqual([
      "conversation_created",
      "agent_responded",
      "finalized",
    ]);

    // 临时对话真实落库为kind=temporary，并已 finalize；lineage 进入 metadata_json.agent_origin。
    const [temporarySession] = await database.db
   .select()
      .from(sessions)
      .where(eq(sessions.id, result.conversationId));
    expect(temporarySession?.kind).toBe("temporary");
    expect(temporarySession?.status).toBe("finalized");
    expect(temporarySession?.retentionPolicy).toBe("delete_on_finalize");
    expect(temporarySession?.temporarySourceSessionId).toBe(source.sessionId);
    expect(JSON.parse(temporarySession?.metadataJson ?? "{}")).toMatchObject({
      agent_origin: {
        root_run_id: "root_int_1",
        source_agent_run_id: "run_int_1",
      },
    });

    // 默认非正史边界：源会话本身没有新增任何楼层，主叙事不被临时对话污染。
    const sourceFloors = await database.db
      .select()
      .from(floors)
      .where(eq(floors.sessionId, source.sessionId));
    expect(sourceFloors).toHaveLength(0);

    // 临时对话的楼层挂在临时 session 上，与源会话隔离。
    const temporaryFloors = await database.db
   .select()
      .from(floors)
      .where(eq(floors.sessionId, result.conversationId));
    expect(temporaryFloors.length).toBeGreaterThan(0);
  });

  it("qa_assistant 惯用名称 qa 也能在临时对话上真实运行", async () => {
    const source = await seedSourceSession(database, Date.now());

    const result = await runner.run({
      agent: "qa",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: { kind: "session", sourceSessionId: source.sessionId },
      inputMessage: "这个设定里主角多大年龄",
    });

    expect(result.status).toBe("completed");
    expect(result.medium.deliveryTarget).toBe("return_inline");
    expect(result.result?.text).toContain("reply:这个设定里主角多大年龄");

    const [temporarySession] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, result.conversationId));
    expect(temporarySession?.kind).toBe("temporary");
    expect(temporarySession?.status).toBe("finalized");
  });
});

function createMockTurnOrchestrator(): TurnOrchestrator {
  return {
    executeTurn: vi.fn(async (input: TurnInput) =>
      createTurnExecution(input.floorId, input.messages[input.messages.length - 1]?.content ?? ""),
    ),
  } as unknown as TurnOrchestrator;
}

function createTurnExecution(floorId: string, userMessage: string): TurnExecutionResult {
  return {
    floorId,
    finalState: "generating",
    generatedText: `reply:${userMessage}`,
    rawText: `reply:${userMessage}`,
    summaries: [],
    totalUsage: {
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    },
 };
}

async function seedSourceSession(
  database: DatabaseConnection,
  now: number,
): Promise<{ sessionId: string; presetId: string }> {
  const sessionId = nanoid();
  const presetId = `preset-${sessionId}`;
  const regexProfileId = `regex-${sessionId}`;
  const worldbookProfileId = `world-${sessionId}`;
  const branchBinding = {
    presetId: `branch-preset-${sessionId}`,
    worldbookProfileId: `branch-world-${sessionId}`,
  regexProfileId: `branch-regex-${sessionId}`,
  };

  await database.db.insert(presets).values([
    {
      id: presetId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `preset ${sessionId}`,
      source: "test",
      dataJson: "{}",
version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: branchBinding.presetId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `branch preset ${sessionId}`,
      source: "test",
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await database.db.insert(regexProfiles).values([
    {
      id: regexProfileId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `regex ${sessionId}`,
      source: "test",
      dataJson: "[]",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: branchBinding.regexProfileId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `branch regex ${sessionId}`,
      source: "test",
      dataJson: "[]",
      version: 1,
      createdAt: now,
      updatedAt:now,
    },
  ]);
  await database.db.insert(worldbooks).values([
    {
   id: worldbookProfileId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `world ${sessionId}`,
      source: "test",
      dataJson: "{}",
      version: 1,
      createdAt:now,
      updatedAt: now,
    },
    {
      id: branchBinding.worldbookProfileId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `branch world ${sessionId}`,
      source: "test",
      dataJson: "{}",
      version:1,
      createdAt: now,
 updatedAt: now,
    },
  ]);

  await database.db.insert(sessions).values({
    id:sessionId,
    title: "Narrative Session",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    presetId,
    regexProfileId,
    worldbookProfileId,
    deepBinding: false,
    promptMode: "native",
    metadataJson: JSON.stringify({
      tool_permissions: {
        allow_irreversible: true,
      },
      prompt_runtime_policy: {
        sourceSelection: {
          history: {
            maxMessages: 12,
          },
        },
      },
    }),
  createdAt: now,
    updatedAt: now,
  });

  new SessionBranchRegistryService(database.db).ensure({
    accountId:DEFAULT_ADMIN_ACCOUNT_ID,
    sessionId,
    branchId: "main",
    assetBinding: {
      presetId: branchBinding.presetId,
      presetVersionId: null,
      worldbookProfileId: branchBinding.worldbookProfileId,
      worldbookVersionId: null,
      regexProfileId: branchBinding.regexProfileId,
      regexProfileVersionId: null,
      deepBinding: true,
    },
    createdAt: now,
    updatedAt: now,
  });

  return { sessionId, presetId };
}

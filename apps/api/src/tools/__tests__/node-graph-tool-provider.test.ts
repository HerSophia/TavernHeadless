import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NodeGraphDocument, ToolExecutionContext } from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { operationLogs, projectInboxItems } from "../../db/schema.js";
import {
  createTestProject,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { NodeGraphDefinitionService } from "../../services/node-graph-definition-service.js";
import { ProjectInboxService } from "../../services/project-inbox-service.js";
import { OperationLogService } from "../../services/operation-log-service.js";
import type { ProjectActorInput } from "../../services/project-access-service.js";
import { NodeGraphToolProvider } from "../node-graph-tool-provider.js";

const ACCOUNT_ID = "nodegraph-tool-owner";
const WORKSPACE_ID = "ws_nodegraph_tool";
const PROJECT_ID = "proj_nodegraph_tool";

function createDocument(): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId: "ngraph_tool_mvp",
    name: "Tool MVP",
    mode: "native_graph",
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: "input", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
    ],
    edges: [],
  };
}

function makeContext(): ToolExecutionContext {
  return {
    sessionId: "sess_tool",
    floorId: "floor_tool",
    pageId: "page_tool",
    callerSlot: "director",
    variableContext: {
      sessionId: "sess_tool",
      floorId: "floor_tool",
      pageId: "page_tool",
    },
  };
}

describe("NodeGraphToolProvider", () => {
  let database: DatabaseConnection;
  let service: NodeGraphDefinitionService;
  let provider: NodeGraphToolProvider;
  let actor: ProjectActorInput;

  beforeEach(() => {
    database = createDatabase(":memory:");
    ensureTestAccount(database.db, ACCOUNT_ID);
    createTestProject(database.db, {
      accountId: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      id: PROJECT_ID,
    });
    actor = {
      actorType: "account",
      actorAccountId: ACCOUNT_ID,
      actorClientId: null,
    };
    service = new NodeGraphDefinitionService(database.db);
    service.create({
      actor,
      projectId: PROJECT_ID,
      document: createDocument(),
      now: 1,
    });
    provider = new NodeGraphToolProvider({
      service,
      projectInbox: new ProjectInboxService(database.db),
      operationLog: new OperationLogService(database.db),
      actor,
      projectId: PROJECT_ID,
    });
  });

  afterEach(() => {
    database.close();
  });

  it("creates a brand-new graph via nodegraph.graph.create", async () => {
    const tools = await provider.listTools();
    expect(tools.map((tool) => tool.name)).toContain("nodegraph.graph.create");

    const newDocument: NodeGraphDocument = {
      schemaVersion: 1,
      graphId: "ngraph_tool_created",
      name: "Created By Assistant",
      mode: "native_graph",
      policies: {},
      permissions: { required: [] },
      nodes: [
        { id: "input", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
      ],
      edges: [],
    };

    const result = await provider.executeTool(
      "nodegraph.graph.create",
      { name: "Created By Assistant", document: newDocument },
      makeContext(),
    );

    const data = result.data as {
      definition: { id: string; name: string };
      version: { versionNo: number};
      validation: { isExecutable: boolean };
    };
    expect(data.definition.id).toBeTruthy();
    expect(data.definition.name).toBe("Created By Assistant");
    expect(data.version.versionNo).toBe(1);
    expect(data.validation.isExecutable).toBe(true);

    // 新建图真实持久化：可被定义服务读回。
    const created = service.get({ actor, projectId: PROJECT_ID, graphId: data.definition.id });
    expect(created.name).toBe("Created By Assistant");
  });

  it("surfaces an error when nodegraph.graph.create receives an invalid document", async () => {
    const invalidDocument = {
      schemaVersion: 1,
      graphId: "ngraph_tool_invalid",
      name: "Invalid",
      mode: "native_graph",
      policies: {},
      permissions: { required: [] },
      // 缺少必须的 source 节点 + 含有未连边的 agent 节点，触发校验失败。
      nodes: [
        { id: "bad-agent", type: "agent.director_plan", typeVersion: "1", phase: "pre_response" },
      ],
      edges: [],
    } as unknown as NodeGraphDocument;

  const result = await provider.executeTool(
      "nodegraph.graph.create",
      { document: invalidDocument },
      makeContext(),
    );
    expect(result.executionStatus).toBe("error");
   expect(result.executionReasonCode).toBe("nodegraph_tool_failed");
  });

  it("patches drafts without applying a live version", async ()=> {
    const tools = await provider.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain("nodegraph.version.apply_live");
    expect(tools.map((tool) => tool.name)).toContain("nodegraph.node.add");

    const current = service.getCurrentVersion({ actor, projectId: PROJECT_ID, graphId: "ngraph_tool_mvp" });
    const draftResult = await provider.executeTool(
      "nodegraph.draft.create_from_version",
      { graph_id: "ngraph_tool_mvp", version_id: current.id },
      makeContext(),
    );
    const draftId = (draftResult.data as { id: string }).id;

    await provider.executeTool(
      "nodegraph.node.add",
      {
        draft_id: draftId,
        node: {
          id: "template",
          type: "compose.template_render",
          typeVersion: "1",
          phase: "pre_response",
          config: { template: "Hello {{name}}" },
        },
      },
      makeContext(),
    );
    await provider.executeTool(
      "nodegraph.edge.add",
      {
        draft_id: draftId,
        edge: {
          id: "e_input_template",
          kind: "data",
          from: { nodeId: "input", port: "text" },
          to: { nodeId: "template", port: "data" },
        },
      },
      makeContext(),
    );

    const validation = await provider.executeTool(
      "nodegraph.patch.validate",
      { draft_id: draftId },
      makeContext(),
    );
    expect((validation.data as { is_executable: boolean }).is_executable).toBe(true);

    const proposal = await provider.executeTool(
      "nodegraph.patch.submit_proposal",
      { draft_id: draftId, note: "Add template node" },
      makeContext(),
    );
    expect(proposal.data).toMatchObject({
      kind: "nodegraph_patch_proposal",
      graph_id: "ngraph_tool_mvp",
      note: "Add template node",
      project_inbox_item_id: expect.any(String),
    });
    expect(database.db.select().from(projectInboxItems).all()).toHaveLength(1);

    // R6-1（缺口 1）：提案写 node_graph.proposal.submit 审计 action。
    const logs = database.db.select().from(operationLogs).all();
    const proposalLog = logs.find((log) => log.action === "node_graph.proposal.submit");
    expect(proposalLog).toBeDefined();
    expect(proposalLog?.status).toBe("succeeded");
    expect(proposalLog?.targetId).toBe("ngraph_tool_mvp");

    const versions = service.listVersions({ actor, projectId: PROJECT_ID, graphId: "ngraph_tool_mvp" });
    expect(versions).toHaveLength(1);
  });

  it("rejects invalid drafts before submitting proposals", async () => {
    const current = service.getCurrentVersion({ actor, projectId: PROJECT_ID, graphId: "ngraph_tool_mvp" });
    const draftResult = await provider.executeTool(
      "nodegraph.draft.create_from_version",
      { graph_id: "ngraph_tool_mvp", version_id: current.id },
      makeContext(),
    );
    const draftId = (draftResult.data as { id: string }).id;

    await provider.executeTool(
      "nodegraph.node.add",
      {
        draft_id: draftId,
        node: {
          id: "bad-agent",
          type: "agent.director_plan",
          typeVersion: "1",
          phase: "pre_response",
        },
      },
      makeContext(),
    );

    const proposal = await provider.executeTool(
      "nodegraph.patch.submit_proposal",
      { draft_id: draftId },
      makeContext(),
    );

    expect(proposal.executionStatus).toBe("error");
    expect(database.db.select().from(projectInboxItems).all()).toHaveLength(0);
  });

  it("denies forbidden live-apply tools", async () => {
    const result = await provider.executeTool(
      "nodegraph.version.apply_live",
      { graph_id: "ngraph_tool_mvp" },
      makeContext(),
    );

    expect(result.executionStatus).toBe("denied");
    expect(result.executionReasonCode).toBe("nodegraph_tool_not_allowed");
  });

  it("evicts non-persistent drafts after their TTL", async () => {
    let now = 1_000;
    const ttlProvider = new NodeGraphToolProvider({
      service,
      projectInbox: new ProjectInboxService(database.db),
      operationLog: new OperationLogService(database.db),
      actor,
      projectId: PROJECT_ID,
      draftTtlMs: 1_000,
      clock: () => now,
    });
    const current = service.getCurrentVersion({ actor, projectId: PROJECT_ID, graphId: "ngraph_tool_mvp" });
    const draftResult = await ttlProvider.executeTool(
      "nodegraph.draft.create_from_version",
      { graph_id: "ngraph_tool_mvp", version_id: current.id },
      makeContext(),
    );
    const draft = draftResult.data as { id: string; persistent: boolean; expires_at?: number; expiresAt?: number };
    expect(draft.persistent).toBe(false);
    const draftId = draft.id;

    // Still valid within TTL.
    now = 1_500;
    const validation = await ttlProvider.executeTool("nodegraph.patch.validate", { draft_id: draftId }, makeContext());
    expect((validation.data as { is_executable: boolean }).is_executable).toBe(true);

    // Access slides the TTL forward; jump beyond the original expiry but within the refreshed window.
    now = 2_400;
    const stillValid = await ttlProvider.executeTool("nodegraph.patch.validate", { draft_id: draftId }, makeContext());
    expect(stillValid.executionStatus).not.toBe("error");

    // Past TTL with no access -> evicted, surfaced as a non-persistent error.
    now = 5_000;
    const expired = await ttlProvider.executeTool("nodegraph.patch.validate", { draft_id: draftId }, makeContext());
    expect(expired.executionStatus).toBe("error");
    expect(expired.error).toContain("non-persistent");
  });

  it("enforces a max draft cap by evicting the oldest draft", async () => {
    let now = 10_000;
    const capProvider = new NodeGraphToolProvider({
      service,
      projectInbox: new ProjectInboxService(database.db),
      operationLog: new OperationLogService(database.db),
      actor,
      projectId: PROJECT_ID,
      draftTtlMs: 1_000_000,
      maxDrafts: 2,
      clock: () => now,
    });
    const current = service.getCurrentVersion({ actor, projectId: PROJECT_ID, graphId: "ngraph_tool_mvp" });

    const first = (await capProvider.executeTool("nodegraph.draft.create_from_version", { graph_id: "ngraph_tool_mvp", version_id: current.id }, makeContext())).data as { id: string };
    now = 10_100;
    await capProvider.executeTool("nodegraph.draft.create_from_version", { graph_id: "ngraph_tool_mvp", version_id: current.id }, makeContext());
    now = 10_200;
    await capProvider.executeTool("nodegraph.draft.create_from_version", { graph_id: "ngraph_tool_mvp", version_id: current.id }, makeContext());

    // The first (oldest) draft was evicted to keep within the cap of 2.
    const evicted = await capProvider.executeTool("nodegraph.patch.validate", { draft_id: first.id }, makeContext());
    expect(evicted.executionStatus).toBe("error");
  });
});

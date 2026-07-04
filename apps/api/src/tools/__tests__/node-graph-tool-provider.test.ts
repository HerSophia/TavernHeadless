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

/**
 * 构造一张「从酒馆预设导入」形态的图：带 subgraph 节点组、block 节点 config.identifier
 * 与 metadata.presetSource，用于验证 graph.get 分层结构、node.get 展开组、preset.get 对照表。
 * 单 source 节点可执行（与 createDocument 同理）；给该节点挂 config.identifier 以便对照分组归属。
 */
function createPresetDocument(): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: "ngraph_preset",
    name: "Imported Narrator",
    mode: "native_graph",
    policies: {},
    permissions: { required:[] },
    nodes: [
      {
        id: "input",
        type: "source.user_input",
        typeVersion: "1",
        phase: "pre_response",
        config: { identifier: "main" },
      },
],
    edges: [],
    groups: [
      { id: "g_system", name: "系统与越狱", kind: "subgraph", nodeIds: ["input"], collapsed: true },
    ],
    metadata: {
      systemGraph: false,
      importedFrom: "sillytavern_openai_preset",
      presetName: "My Preset",
      clusterMode: "loose",
      presetSource: {
        name: "My Preset",
        temperature: 0.9,
        top_p: 0.95,
        prompts: [
          { identifier: "main", name: "Main", role: "system", content: "You are a narrator." },
          { identifier: "jailbreak", name: "JB", role: "system", content: "jb body" },
        ],
        prompt_order: [
          {
            character_id: 100,
            order: [
              { identifier: "main", enabled: true },
              { identifier: "jailbreak", enabled: false },
            ],
          },
        ],
        extensions: { regex_scripts: [{ scriptName: "r1" }] },
      },
    },
  } as unknown as NodeGraphDocument;
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

  it("lists graphs via nodegraph.graph.list", async () => {
    const tools = await provider.listTools();
    expect(tools.map((tool) => tool.name)).toContain("nodegraph.graph.list");

    const result = await provider.executeTool("nodegraph.graph.list", {}, makeContext());
    const data = result.data as {
      graphs: Array<{ id: string; name: string; status: string }>;
    };
    expect(data.graphs.some((graph) => graph.id === "ngraph_tool_mvp" && graph.name === "Tool MVP")).toBe(true);
  });

  it("resolves a graph id by name via nodegraph.graph.find_by_name", async () => {
    const tools = await provider.listTools();
    expect(tools.map((tool) => tool.name)).toContain("nodegraph.graph.find_by_name");

    const result = await provider.executeTool(
      "nodegraph.graph.find_by_name",
      { name: "Tool MVP" },
      makeContext(),
    );
    const data = result.data as {
      name: string;
      matches: Array<{ id: string; name: string }>;
      graph_id: string | null;
    };
    expect(data.graph_id).toBe("ngraph_tool_mvp");
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0]?.id).toBe("ngraph_tool_mvp");
  });

  it("returns no graph id when find_by_name has no match", async () => {
    const result = await provider.executeTool(
      "nodegraph.graph.find_by_name",
      { name: "does-not-exist" },
      makeContext(),
    );
    const data = result.data as { matches: unknown[]; graph_id: string | null };
    expect(data.matches).toHaveLength(0);
    expect(data.graph_id).toBeNull();
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

  it("returns node type knowledge through list and describe tools", async () => {
    const listed = await provider.executeTool("nodegraph.node_type.list", {}, makeContext());
    const listData = listed.data as Array<{
      type: string;
      category: string;
      summary: string;
      outputPortNames: string[];
      sideEffects?: string;
      permissionsRequired?: string[];
    }>;
    const agentCall = listData.find((entry) => entry.type === "agent.call");
    expect(agentCall).toMatchObject({
      category: "agent",
      sideEffects: "llm",
      permissionsRequired: ["project.agent.run"],
    });
    expect(agentCall?.summary).toContain("Agent");
    expect(agentCall?.outputPortNames).toEqual(expect.arrayContaining(["result", "brief", "diagnostics"]));

    const described = await provider.executeTool(
      "nodegraph.node_type.describe",
      { type: "agent.call" },
      makeContext(),
    );
    const detail = described.data as {
      type: string;
      category: string;
      usage?: string;
      config?: { fields?: Array<{ path: string }> };
      examples?: unknown[];
      pitfalls?: string[];
      relatedNodeTypes?: string[];
    };
    expect(detail).toMatchObject({ type: "agent.call", category: "agent" });
    expect(detail.config?.fields?.map((field) => field.path)).toContain("medium.kind");
    expect(detail.examples?.length).toBeGreaterThan(0);
    expect(detail.pitfalls?.some((pitfall) => pitfall.includes("project.agent.run"))).toBe(true);
    expect(detail.relatedNodeTypes).toContain("output.project_inbox");
  });

  it("returns a clear error for unknown node type descriptions", async () => {
    const result = await provider.executeTool(
      "nodegraph.node_type.describe",
      { type: "missing.node" },
      makeContext(),
    );
    expect(result.executionStatus).toBe("error");
    expect(result.error).toContain("Node type not registered: missing.node@1");
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

  it("exposes groups as first-class and preset source in nodegraph.graph.get", async () => {
    const created = service.create({
      actor,
      projectId: PROJECT_ID,
      document: createPresetDocument(),
      now: 2,
    });
    const result = await provider.executeTool(
      "nodegraph.graph.get",
      { graph_id: created.definition.id },
      makeContext(),
    );
    const data = result.data as {
      graph: {
        source: { imported_from_preset: boolean; preset_name?: string };
        groups: Array<{ id: string; kind: string; member_count: number; members: Array<{ id: string }> }>;
        ungrouped_nodes: Array<{ id: string }>;
      };
    };
    expect(data.graph.source.imported_from_preset).toBe(true);
    expect(data.graph.source.preset_name).toBe("My Preset");
    expect(data.graph.groups).toHaveLength(1);
    expect(data.graph.groups[0]?.kind).toBe("subgraph");
    expect(data.graph.groups[0]?.member_count).toBe(1);
    expect(data.graph.groups[0]?.members.map((node) => node.id)).toContain("input");
    expect(data.graph.ungrouped_nodes).toHaveLength(0);
  });

  it("expands a group's members via nodegraph.node.get and resolves a plain node", async () => {
    const created = service.create({
      actor,
      projectId: PROJECT_ID,
      document: createPresetDocument(),
      now: 2,
    });

    const groupResult = await provider.executeTool(
      "nodegraph.node.get",
      { graph_id: created.definition.id, node_id: "g_system" },
      makeContext(),
    );
    const groupData = groupResult.data as {
      resolved_as: string;
      nodes: Array<{ id: string; config?: { identifier?: string } }>;
    };
    expect(groupData.resolved_as).toBe("group");
    expect(groupData.nodes.map((node) => node.id)).toContain("input");
    // 成员是完整节点（含 config），而非摘要。
    expect(groupData.nodes[0]?.config?.identifier).toBe("main");

    const nodeResult = await provider.executeTool(
      "nodegraph.node.get",
      { graph_id: created.definition.id, node_id: "input" },
      makeContext(),
    );
    const nodeData = nodeResult.data as {
      resolved_as: string;
      node: { id: string };
      group: { id: string } | null;
    };
    expect(nodeData.resolved_as).toBe("node");
    expect(nodeData.node.id).toBe("input");
    expect(nodeData.group?.id).toBe("g_system");
  });

  it("reads the original preset via nodegraph.preset.get (overview + mapping and single entry)", async () => {
    const created = service.create({
      actor,
      projectId: PROJECT_ID,
      document: createPresetDocument(),
      now: 2,
    });

    const overview = await provider.executeTool(
      "nodegraph.preset.get",
      { graph_id: created.definition.id },
      makeContext(),
    );
    const overviewData = overview.data as {
      imported_from_preset: boolean;
      overview: { preset_name: string; sampling?: Record<string, number>; regex_count: number };
      prompt_order: Array<{
        identifier: string;
        enabled: boolean;
        current_node_id: string | null;
        current_group: { id: string } | null;
      }>;
    };
    expect(overviewData.imported_from_preset).toBe(true);
    expect(overviewData.overview.preset_name).toBe("My Preset");
    expect(overviewData.overview.sampling?.temperature).toBe(0.9);
    expect(overviewData.overview.regex_count).toBe(1);
    const main = overviewData.prompt_order.find((entry) => entry.identifier === "main");
    expect(main?.current_node_id).toBe("input");
    expect(main?.current_group?.id).toBe("g_system");
    const jailbreak = overviewData.prompt_order.find((entry) => entry.identifier === "jailbreak");
    expect(jailbreak?.enabled).toBe(false);

    const detail = await provider.executeTool(
      "nodegraph.preset.get",
      { graph_id: created.definition.id, identifier: "main" },
      makeContext(),
    );
    const detailData = detail.data as {
      entry: {
        identifier: string;
        original: { content: string };
        current_group: { id: string } | null;
      };
    };
    expect(detailData.entry.identifier).toBe("main");
    expect(detailData.entry.original.content).toBe("You are a narrator.");
    expect(detailData.entry.current_group?.id).toBe("g_system");
  });

  it("returns imported_from_preset=false for non-preset graphs in nodegraph.preset.get", async () => {
    const result = await provider.executeTool(
      "nodegraph.preset.get",
      { graph_id: "ngraph_tool_mvp" },
      makeContext(),
    );
    const data = result.data as { imported_from_preset: boolean };
    expect(data.imported_from_preset).toBe(false);
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

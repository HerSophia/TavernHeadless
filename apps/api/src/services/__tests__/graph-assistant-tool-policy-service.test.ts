import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  createTestProject,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import {
  deriveDefaultGraphAssistantToolDecision,
  GraphAssistantToolPolicyService,
  GraphAssistantToolPolicyServiceError,
} from "../graph-assistant-tool-policy-service.js";

const ACCOUNT_ID = "gatp-owner";
const WORKSPACE_ID = "ws_gatp";
const PROJECT_ID = "proj_gatp";

describe("GraphAssistantToolPolicyService", () => {
  let database: DatabaseConnection;
  let service: GraphAssistantToolPolicyService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    ensureTestAccount(database.db, ACCOUNT_ID);
    createTestProject(database.db, {
      accountId: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      id: PROJECT_ID,
    });
    service = new GraphAssistantToolPolicyService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("derives confirm defaults for live writes and auto for everythingelse", () => {
    expect(deriveDefaultGraphAssistantToolDecision({ name: "nodegraph.graph.create", sideEffectLevel: "sandbox" })).toBe("confirm");
    expect(deriveDefaultGraphAssistantToolDecision({ name:"nodegraph.patch.submit_proposal", sideEffectLevel: "sandbox" })).toBe("confirm");
    expect(deriveDefaultGraphAssistantToolDecision({ name: "nodegraph.graph.get", sideEffectLevel: "none" })).toBe("auto");
    expect(deriveDefaultGraphAssistantToolDecision({ name: "nodegraph.node.add", sideEffectLevel: "sandbox" })).toBe("auto");
    expect(deriveDefaultGraphAssistantToolDecision({ name: "future.tool", sideEffectLevel: "irreversible" })).toBe("confirm");
  });

  it("resolves effective defaults across the full tool catalog", () => {
    const effective = service.resolveEffective({ projectId: PROJECT_ID });
    expect(effective.length).toBeGreaterThan(0);

    const create = effective.find((entry) => entry.toolName === "nodegraph.graph.create");
    expect(create).toMatchObject({ decision: "confirm", defaultDecision: "confirm", source: "default" });

    const get = effective.find((entry) => entry.toolName === "nodegraph.graph.get");
    expect(get).toMatchObject({ decision:"auto", defaultDecision: "auto", source: "default" });
  });

  it("upserts overrides and reflects them in effective resolution", () => {
    service.upsert({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      policies: [
        { toolName: "nodegraph.node.add", decision: "confirm" },
        { toolName: "nodegraph.graph.create", decision: "auto" },
      ],
    });

    const effective = service.resolveEffective({ projectId: PROJECT_ID });
    const nodeAdd = effective.find((entry) => entry.toolName === "nodegraph.node.add");
    expect(nodeAdd).toMatchObject({ decision: "confirm", defaultDecision:"auto", source: "override" });
    const create = effective.find((entry) => entry.toolName === "nodegraph.graph.create");
    expect(create).toMatchObject({ decision: "auto", defaultDecision: "confirm", source: "override" });

    // 二次 upsert 同一工具应更新而非重复插入。
    service.upsert({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      policies: [{ toolName:"nodegraph.node.add", decision: "auto" }],
    });
    expect(service.listByProject({ projectId: PROJECT_ID }).filter((row) => row.toolName === "nodegraph.node.add")).toHaveLength(1);
  });

  it("resolves auto tool names excluding confirm tools", () => {
    const autoNames = service.resolveAutoToolNames({ projectId: PROJECT_ID });
    // 默认下 graph.create 与 submit_proposal 为 confirm，不在 auto 集合内。
    expect(autoNames.has("nodegraph.graph.create")).toBe(false);
    expect(autoNames.has("nodegraph.patch.submit_proposal")).toBe(false);
    expect(autoNames.has("nodegraph.graph.get")).toBe(true);
    expect(autoNames.has("nodegraph.node.add")).toBe(true);
  });

  it("rejects unknown tool names on upsert", () => {
    expect(() => service.upsert({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      policies: [{ toolName: "nodegraph.not_a_real_tool", decision: "auto" }],
    })).toThrow(GraphAssistantToolPolicyServiceError);
  });
});

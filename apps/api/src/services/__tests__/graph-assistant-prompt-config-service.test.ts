import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
 createTestProject,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import {
  GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT,
  GraphAssistantPromptConfigService,
  GraphAssistantPromptConfigServiceError,
} from "../graph-assistant-prompt-config-service.js";

const ACCOUNT_ID = "gapc-owner";
const WORKSPACE_ID = "ws_gapc";
const PROJECT_ID = "proj_gapc";

describe("GraphAssistantPromptConfigService", () => {
  let database: DatabaseConnection;
  let service: GraphAssistantPromptConfigService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    ensureTestAccount(database.db, ACCOUNT_ID);
    createTestProject(database.db, {
      accountId: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      id: PROJECT_ID,
    });
    service = new GraphAssistantPromptConfigService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("returns built-in defaults when no record exists", () => {
    const config = service.getByProject({ projectId: PROJECT_ID });
    expect(config).toMatchObject({
      staticMode: "append",
      staticText: "",
      dynamicTemplate: "",
      contextConfig: null,
      builtinDefault: GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT,
    });
  });

  it("resolves built-in default when no record exists", () => {
    expect(service.resolveStaticPrompt({ projectId: PROJECT_ID })).toBe(
      GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT,
    );
  });

  it("resolves built-in default when projectId is missing", () => {
expect(service.resolveStaticPrompt({ projectId: null })).toBe(
      GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT,
    );
  });

  it("appends custom text after the built-in default in append mode", () => {
    service.upsert({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      staticMode: "append",
      staticText: "额外约束：只读不要改图。",
    });

    const resolved = service.resolveStaticPrompt({ projectId: PROJECT_ID });
    expect(resolved.startsWith(GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT)).toBe(true);
    expect(resolved.endsWith("额外约束：只读不要改图。")).toBe(true);
    expect(resolved).toContain("\n\n");
  });

  it("falls back to built-in default in append mode when custom text is empty", () => {
    service.upsert({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      staticMode: "append",
      staticText: "   ",
    });
    expect(service.resolveStaticPrompt({ projectId: PROJECT_ID })).toBe(
      GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT,
    );
  });

  it("replaces the built-in default in override mode", () => {
    service.upsert({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
     accountId: ACCOUNT_ID,
      staticMode: "override",
      staticText: "你是一个只读的图查看助手。",
    });
    expect(service.resolveStaticPrompt({ projectId: PROJECT_ID })).toBe(
      "你是一个只读的图查看助手。",
    );
  });

  it("falls back to built-indefault in override mode when custom text is empty", () => {
    service.upsert({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      staticMode: "override",
      staticText: "",
    });
    expect(service.resolveStaticPrompt({ projectId: PROJECT_ID })).toBe(
      GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT,
    );
  });

  it("upserts a single row per project (update, not duplicate insert)", () => {
    service.upsert({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      staticMode: "append",
      staticText: "first",
    });
    service.upsert({
      workspaceId:WORKSPACE_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      staticMode: "override",
      staticText: "second",
    });

    const config = service.getByProject({ projectId: PROJECT_ID});
    expect(config.staticMode).toBe("override");
    expect(config.staticText).toBe("second");
  });

  it("persists and parses context config json", () => {
    service.upsert({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      staticMode: "append",
      staticText: "",
      contextConfig: { graphSummary: { enabled: true } },
    });
    const config = service.getByProject({ projectId: PROJECT_ID });
    expect(config.contextConfig).toEqual({ graphSummary: { enabled: true } });
  });

  it("rejects invalid static mode",() => {
    expect(() =>
      service.upsert({
  workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        accountId: ACCOUNT_ID,
        // @ts-expect-error 故意传非法 mode
        staticMode: "merge",
        staticText: "x",
      }),
    ).toThrow(GraphAssistantPromptConfigServiceError);
  });
});

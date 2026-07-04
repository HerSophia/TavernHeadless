import {
  buildCompatPromptFloorTemplate,
  buildNativePromptFloorTemplate,
  type NodeGraphDocument,
} from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  createTestProject,
  createTestSessionWithScope,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { NodeGraphDefinitionService } from "../node-graph-definition-service.js";
import {
  ProjectFloorGraphBindingService,
  ProjectFloorGraphBindingServiceError,
  floorGraphBindingKindForPromptMode,
} from "../project-floor-graph-binding-service.js";

const ACCOUNT_ID = "floor-graph-binding-owner";
const OTHER_ACCOUNT_ID = "floor-graph-binding-other";

const ACTOR = {
  actorType: "account" as const,
  actorAccountId: ACCOUNT_ID,
  actorClientId: null,
};

function withGraphId(document: NodeGraphDocument, graphId: string, name: string): NodeGraphDocument {
  return {
    ...document,
    graphId,
    name,
  };
}

describe("ProjectFloorGraphBindingService", () => {
  let database: DatabaseConnection;
  let nodeGraphService: NodeGraphDefinitionService;
  let bindingService: ProjectFloorGraphBindingService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    ensureTestAccount(database.db, ACCOUNT_ID);
    ensureTestAccount(database.db, OTHER_ACCOUNT_ID);
    nodeGraphService = new NodeGraphDefinitionService(database.db);
    bindingService = new ProjectFloorGraphBindingService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("creates, lists, resolves and clears a native binding", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-fgb-native" });
    const session = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT_ID,
      projectId: project.projectId,
      id: "sess-fgb-native",
      values: { promptMode: "native" },
    });
    const created = nodeGraphService.create({
      actor: ACTOR,
      projectId: project.projectId,
      document: withGraphId(buildNativePromptFloorTemplate(), "ngraph_fgb_native", "Native Floor"),
      now: 1_000,
    });

    const binding = bindingService.setActive({
      actor: ACTOR,
      projectId: project.projectId,
      kind: "native",
      graphId: created.definition.id,
      graphVersionId: created.version.id,
      now: 2_000,
    });

    expect(binding).toMatchObject({
      kind: "native",
      graphId: created.definition.id,
      graphVersionId: created.version.id,
      graphName: "Native Floor",
      graphVersionNo: 1,
      status: "active",
    });
    expect(bindingService.listActive({ actor: ACTOR, projectId: project.projectId })).toHaveLength(1);

    const resolved = bindingService.resolveForSession({
      sessionId: session.sessionId,
      accountId: ACCOUNT_ID,
      promptMode: "native",
    });
    expect(resolved).toMatchObject({
      source: "project",
      kind: "native",
      graphId: created.definition.id,
      graphVersionId: created.version.id,
    });
    expect(resolved?.document.graphId).toBe(created.definition.id);

    const cleared = bindingService.clearActive({
      actor: ACTOR,
      projectId: project.projectId,
      kind: "native",
      now: 3_000,
    });
    expect(cleared.cleared).toBe(true);
    expect(cleared.previous?.id).toBe(binding.id);
    expect(bindingService.getActive({ actor: ACTOR, projectId: project.projectId, kind: "native" })).toBeNull();
  });

  it("creates and resolves a compat binding for compat prompt modes", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-fgb-compat" });
    const session = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT_ID,
      projectId: project.projectId,
      id: "sess-fgb-compat",
      values: { promptMode: "compat_plus" },
    });
    const created = nodeGraphService.create({
      actor: ACTOR,
      projectId: project.projectId,
      document: withGraphId(buildCompatPromptFloorTemplate(), "ngraph_fgb_compat", "Compat Floor"),
    });

    bindingService.setActive({
      actor: ACTOR,
      projectId: project.projectId,
      kind: "compat",
      graphId: created.definition.id,
      graphVersionId: created.version.id,
    });

    expect(floorGraphBindingKindForPromptMode("compat_strict")).toBe("compat");
    expect(floorGraphBindingKindForPromptMode("compat_plus")).toBe("compat");
    expect(floorGraphBindingKindForPromptMode("native")).toBe("native");
    expect(bindingService.resolveForSession({
      sessionId: session.sessionId,
      accountId: ACCOUNT_ID,
      promptMode: "compat_plus",
    })?.kind).toBe("compat");
  });

  it("archives the previous active binding when a kind is rebound", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-fgb-rebind" });
    const first = nodeGraphService.create({
      actor: ACTOR,
      projectId: project.projectId,
      document: withGraphId(buildNativePromptFloorTemplate(), "ngraph_fgb_rebind_1", "Native One"),
    });
    const second = nodeGraphService.create({
      actor: ACTOR,
      projectId: project.projectId,
      document: withGraphId(buildNativePromptFloorTemplate(), "ngraph_fgb_rebind_2", "Native Two"),
    });

    const firstBinding = bindingService.setActive({
      actor: ACTOR,
      projectId: project.projectId,
      kind: "native",
      graphId: first.definition.id,
      graphVersionId: first.version.id,
    });
    const secondBinding = bindingService.setActive({
      actor: ACTOR,
      projectId: project.projectId,
      kind: "native",
      graphId: second.definition.id,
      graphVersionId: second.version.id,
    });

    expect(secondBinding.graphId).toBe(second.definition.id);
    expect(bindingService.listActive({ actor: ACTOR, projectId: project.projectId })).toHaveLength(1);
    expect(bindingService.getActive({ actor: ACTOR, projectId: project.projectId, kind: "native" })?.id)
      .toBe(secondBinding.id);
    expect(firstBinding.id).not.toBe(secondBinding.id);
  });

  it("rejects missing graph, missing version, archived graph and cross-project graph", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-fgb-errors" });
    const otherProject = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-fgb-other-project" });
    const created = nodeGraphService.create({
      actor: ACTOR,
      projectId: project.projectId,
      document: withGraphId(buildNativePromptFloorTemplate(), "ngraph_fgb_errors", "Native Errors"),
    });
    const otherCreated = nodeGraphService.create({
      actor: ACTOR,
      projectId: otherProject.projectId,
      document: withGraphId(buildNativePromptFloorTemplate(), "ngraph_fgb_other_project", "Native Other"),
    });

    expect(() => bindingService.setActive({
      actor: ACTOR,
      projectId: project.projectId,
      kind: "native",
      graphId: "missing_graph",
      graphVersionId: "missing_version",
    })).toThrow(ProjectFloorGraphBindingServiceError);

    expect(() => bindingService.setActive({
      actor: ACTOR,
      projectId: project.projectId,
      kind: "native",
      graphId: created.definition.id,
      graphVersionId: "missing_version",
    })).toThrow(/graph version not found/i);

    expect(() => bindingService.setActive({
      actor: ACTOR,
      projectId: project.projectId,
      kind: "native",
      graphId: otherCreated.definition.id,
      graphVersionId: otherCreated.version.id,
    })).toThrow(/another project/i);

    expect(() => bindingService.setActive({
      actor: ACTOR,
      projectId: project.projectId,
      kind: "native",
      graphId: created.definition.id,
      graphVersionId: otherCreated.version.id,
    })).toThrow(/graph version not found/i);
  });

  it("rejects archived graphs and invalid compat documents", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-fgb-invalid" });
    const archived = nodeGraphService.create({
      actor: ACTOR,
      projectId: project.projectId,
      document: withGraphId(buildNativePromptFloorTemplate(), "ngraph_fgb_archived", "Archived Native"),
    });
    nodeGraphService.archive({ actor: ACTOR, projectId: project.projectId, graphId: archived.definition.id });

    expect(() => bindingService.setActive({
      actor: ACTOR,
      projectId: project.projectId,
      kind: "native",
      graphId: archived.definition.id,
      graphVersionId: archived.version.id,
    })).toThrow(/archived/i);

    const invalidCompat = nodeGraphService.create({
      actor: ACTOR,
      projectId: project.projectId,
      document: withGraphId(buildNativePromptFloorTemplate(), "ngraph_fgb_invalid_compat", "Invalid Compat"),
    });

    expect(() => bindingService.setActive({
      actor: ACTOR,
      projectId: project.projectId,
      kind: "compat",
      graphId: invalidCompat.definition.id,
      graphVersionId: invalidCompat.version.id,
    })).toThrow(/agent or verify/i);
  });

  it("returns null when the session has no project scope or no active binding", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-fgb-unbound" });
    const session = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT_ID,
      projectId: project.projectId,
      id: "sess-fgb-unbound",
      values: { promptMode: "native" },
    });

    expect(bindingService.resolveForSession({
      sessionId: session.sessionId,
      accountId: ACCOUNT_ID,
      promptMode: "native",
    })).toBeNull();
  });
});

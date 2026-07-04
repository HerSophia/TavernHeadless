import type { NodeGraphDocument, NodeGraphPackage } from "@tavern/core";
import { exportNodeGraphPackage } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { nodeGraphDefinitions, operationLogs } from "../../db/schema.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import { NodeGraphDefinitionService } from "../node-graph-definition-service.js";
import {
  NodeGraphPackageService,
  NodeGraphPackageServiceError,
} from "../node-graph-package-service.js";

const ACTOR = {
  actorType: "account" as const,
  actorAccountId: "default-admin",
  actorClientId: null,
};

function mvpDocument(graphId = "ngraph_pkg_svc"): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId,
    name: "Package Service MVP",
    mode: "native_graph",
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: "history", type: "source.chat_history", typeVersion: "1", phase: "pre_response" },
      { id: "user_input", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
      { id: "messages", type: "compose.final_messages", typeVersion: "1", phase: "response" },
      { id: "narrator", type: "narration.narrator", typeVersion: "1", phase: "response" },
      { id: "commit", type: "output.commit_gate", typeVersion: "1", phase: "commit" },
    ],
    edges: [
      { id: "e_hm", kind: "data", from: { nodeId: "history", port: "messages" }, to: { nodeId: "messages", port: "messages" } },
      { id: "e_mn", kind: "data", from: { nodeId: "messages", port: "messages" }, to: { nodeId: "narrator", port: "messages" } },
      { id: "e_un", kind: "data", from: { nodeId: "user_input", port: "text" }, to: { nodeId: "narrator", port: "user_input" } },
      { id: "e_nc", kind: "data", from: { nodeId: "narrator", port: "text" }, to: { nodeId: "commit", port: "text" } },
    ],
  };
}

describe("NodeGraphPackageService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
    createTestProject(database.db, { accountId: "default-admin", workspaceId: "ws_1", id: "proj_1" });
  });

  afterEach(() => {
    database?.close();
  });

  function seedGraph(graphId = "ngraph_pkg_svc"): string {
    const created = new NodeGraphDefinitionService(database.db).create({
      actor: ACTOR,
      projectId: "proj_1",
      document: mvpDocument(graphId),
    });
    return created.definition.id;
  }

  it("exports a graph version as a package and writes an export audit", () => {
    const graphId = seedGraph();
    const service = new NodeGraphPackageService(database.db);
    const result = service.exportPackage({ actor: ACTOR, projectId: "proj_1", graphId });

    expect(result.package.kind).toBe("tavernheadless.nodegraph");
    expect(result.package.metadata.id).toBe(graphId);
    expect(result.package.graph.schemaVersion).toBe(2);
    expect(result.package.integrity?.contentHash).toMatch(/^sha256:/);
    expect(result.securitySummary.longTermDataReads).toContain("chat_history");

    const exportLogs = database.db.select().from(operationLogs).all()
      .filter((log) => log.action === "node_graph.export");
    expect(exportLogs).toHaveLength(1);
    // 审计只写摘要与 hash，不写完整图正文。
    expect(JSON.stringify(exportLogs[0]!.metadataJson ?? "")).not.toContain("source.chat_history");
  });

  it("preflights an exported package as installable with no diagnostics", () => {
    const graphId = seedGraph();
    const service = new NodeGraphPackageService(database.db);
    const exported = service.exportPackage({ actor: ACTOR, projectId: "proj_1", graphId });

    const preflight = service.preflightImport({ actor: ACTOR, projectId: "proj_1", package: exported.package });
    expect(preflight.installable).toBe(true);
    expect(preflight.diagnostics).toEqual([]);
    expect(preflight.contentHash).toBe(exported.package.integrity?.contentHash);
  });

  it("requires confirmation before installing", () => {
    const graphId = seedGraph();
    const service = new NodeGraphPackageService(database.db);
    const exported = service.exportPackage({ actor: ACTOR, projectId: "proj_1", graphId });

    const before = database.db.select().from(nodeGraphDefinitions).all().length;
    const result = service.importPackage({ actor: ACTOR, projectId: "proj_1", package: exported.package });
    expect(result.confirmed).toBe(false);
    if (result.confirmed === false) {
      expect(result.requiresConfirmation).toBe(true);
    }
    const after = database.db.select().from(nodeGraphDefinitions).all().length;
    expect(after).toBe(before);
  });

  it("installs a new graph definition when confirmed and writes an import audit", () => {
    const graphId = seedGraph();
    const service = new NodeGraphPackageService(database.db);
    const exported = service.exportPackage({ actor: ACTOR, projectId: "proj_1", graphId });

    const result = service.importPackage({
      actor: ACTOR,
      projectId: "proj_1",
      package: exported.package,
      confirm: true,
      name: "Imported Graph",
    });
    expect(result.confirmed).toBe(true);
    if (result.confirmed === true) {
      // 安装为新图：id 与源图不同，避免冲突。
      expect(result.definition.id).not.toBe(graphId);
      expect(result.definition.name).toBe("Imported Graph");
      expect(result.validation.isExecutable).toBe(true);
    }

    const importLogs = database.db.select().from(operationLogs).all()
      .filter((log) => log.action === "node_graph.import");
    expect(importLogs).toHaveLength(1);

    const definitions = database.db.select().from(nodeGraphDefinitions).all();
    expect(definitions).toHaveLength(2);
  });

  it("rejects an import that targets a newer graph API as not installable", () => {
    const graphId = seedGraph();
    const service = new NodeGraphPackageService(database.db);
    const exported = service.exportPackage({ actor: ACTOR, projectId: "proj_1", graphId });
    const future: NodeGraphPackage = {
      ...exported.package,
      compatibility: { ...exported.package.compatibility, graphApiVersion: "3" },
    };

    expect(() => service.importPackage({ actor: ACTOR, projectId: "proj_1", package: future, confirm: true }))
      .toThrowError(NodeGraphPackageServiceError);
  });

  it("flags an unknown node type as a blocking error", () => {
    const doc = mvpDocument("ngraph_pkg_unknown");
    doc.nodes.push({ id: "mystery", type: "custom.mystery", typeVersion: "1", phase: "pre_response" });
    const pkg = exportNodeGraphPackage({ document: doc, metadata: { id: "pkg.unknown", name: "Unknown", version: "1.0.0" } });

    const service = new NodeGraphPackageService(database.db);
    const preflight = service.preflightImport({ actor: ACTOR, projectId: "proj_1", package: pkg });
    const diag = preflight.diagnostics.find((d) => d.dependencyId === "custom.mystery@1");
    expect(diag?.code).toBe("NODE_TYPE_MISSING");
    expect(diag?.severity).toBe("error");
    expect(preflight.installable).toBe(false);
  });

  it("rejects a malformed package payload", () => {
    const service = new NodeGraphPackageService(database.db);
    expect(() => service.preflightImport({ actor: ACTOR, projectId: "proj_1", package: { kind: "nope" } }))
      .toThrowError(NodeGraphPackageServiceError);
  });
});

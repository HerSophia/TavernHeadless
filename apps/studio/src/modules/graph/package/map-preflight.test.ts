import { describe, expect, it } from "vitest";

import type { NodeGraphImportPreflightResponse } from "../../../lib/nodegraph-api/types";
import { mapPreflight } from "./map-preflight";

function response(overrides: Partial<NodeGraphImportPreflightResponse>): NodeGraphImportPreflightResponse {
  return {
    package_id: "pkg1",
    content_hash: "hash1",
    installable: true,
    migration_available: false,
    migration_required: false,
    counts: { error: 0, warning: 0, info: 0 },
    diagnostics: [],
    required_node_types: [],
    missing_node_types: [],
    degradable_node_types: [],
    security_summary: {},
    ...overrides,
  };
}

describe("mapPreflight", () => {
  it("marks node-type status from required/missing/degradable sets", () => {
    const view = mapPreflight(
      response({
        required_node_types: ["narration.narrator", "agent.call", "verify.continuity"],
        missing_node_types: ["agent.call", "verify.continuity"],
        degradable_node_types: ["verify.continuity"],
      }),
    );
    expect(view.nodeTypes).toEqual([
      { type: "narration.narrator", title: "narration.narrator", status: "available" },
      { type: "agent.call", title: "agent.call", status: "missing" },
      { type: "verify.continuity", title: "verify.continuity", status: "degradable" },
    ]);
  });

  it("resolves titles via the resolver when provided", () => {
    const view = mapPreflight(
      response({ required_node_types: ["narration.narrator"] }),
      (type) => (type === "narration.narrator" ? "Narrator" : undefined),
    );
    expect(view.nodeTypes[0]?.title).toBe("Narrator");
  });

  it("splits diagnostics into blocking and advisory groups", () => {
    const view = mapPreflight(
      response({
        diagnostics: [
          { severity: "error", code: "NODE_TYPE_MISSING", message: "missing" },
          { severity: "warning", code: "CAPABILITY_MISSING", message: "cap", degradable: true },
          { severity: "info", code: "MIGRATION_AVAILABLE", message: "migrate" },
        ],
      }),
    );
    expect(view.blockingDiagnostics).toHaveLength(1);
    expect(view.advisoryDiagnostics).toHaveLength(2);
  });

  it("derives migration state", () => {
    expect(mapPreflight(response({})).migration).toBe("none");
    expect(mapPreflight(response({ migration_available: true })).migration).toBe("available");
    expect(mapPreflight(response({ migration_available: true, migration_required: true })).migration).toBe("required");
  });

  it("passes through installability, hash, counts and security", () => {
    const view = mapPreflight(
      response({
        installable: false,
        content_hash: "abc",
        counts: { error: 2, warning: 1, info: 0 },
        security_summary: { requests_network_access: true, required_permissions: ["project.write"] },
      }),
    );
    expect(view.installable).toBe(false);
    expect(view.contentHash).toBe("abc");
    expect(view.counts).toEqual({ error: 2, warning: 1, info: 0 });
    expect(view.security.requests_network_access).toBe(true);
    expect(view.security.required_permissions).toEqual(["project.write"]);
  });
});

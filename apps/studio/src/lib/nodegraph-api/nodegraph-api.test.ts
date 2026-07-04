import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { API_BASE, nodeGraphHandlers, sampleDocument } from "../../test/msw/handlers";
import { NodeGraphApiError, nodeGraphApi } from "./index";

const server = setupServer(...nodeGraphHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers(...nodeGraphHandlers));
afterAll(() => server.close());

describe("nodeGraphApi (msw)", () => {
  it("lists project graphs", async () => {
    const result = await nodeGraphApi.list("p1");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe("g1");
  });

  it("gets a graph with its current version document", async () => {
    const result = await nodeGraphApi.get("p1", "g1");
    expect(result.definition.id).toBe("g1");
    expect(result.current_version?.document.graphId).toBe("g1");
  });

  it("validates a document and returns diagnostics", async () => {
    const result = await nodeGraphApi.validate("p1", "g1", sampleDocument);
    expect(result.diagnostics).toEqual([]);
    expect((result as { isExecutable?: boolean }).isExecutable).toBe(true);
  });

  it("previews a node via the backend", async () => {
    const result = (await nodeGraphApi.preview("p1", "g1", { node_id: "n1" })) as {
      status?: string;
      nodeOutputs?: { n1?: { preview?: { value?: unknown } } };
    };
    expect(result.status).toBe("succeeded");
    expect(result.nodeOutputs?.n1?.preview?.value).toBe("hello");
  });

  it("creates a new version", async () => {
    const result = await nodeGraphApi.createVersion("p1", "g1", sampleDocument, "v1");
    expect(result.version.id).toBe("v2");
    expect(result.definition.current_version_id).toBe("v2");
  });

  it("sets the current version", async () => {
    const result = await nodeGraphApi.setCurrentVersion("p1", "g1", "v2");
    expect(result.definition.current_version_id).toBe("v2");
  });

  it("creates a new graph", async () => {
    const result = await nodeGraphApi.create("p1", sampleDocument, "G1");
    expect(result.definition.id).toBe("g1");
    expect(result.version.id).toBe("v1");
  });

  it("lists versions", async () => {
    const result = await nodeGraphApi.listVersions("p1", "g1");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.version_no).toBe(1);
  });

  it("enqueues a run", async () => {
    const result = await nodeGraphApi.run("p1", "g1", { intent: "dry_run" });
    expect(result.job_id).toBe("j1");
    expect(result.created).toBe(true);
    expect(result.worker_enabled).toBe(false);
  });

  it("archives and unarchives", async () => {
    expect((await nodeGraphApi.archive("p1", "g1")).definition.status).toBe("archived");
    expect((await nodeGraphApi.unarchive("p1", "g1")).definition.status).toBe("active");
  });

  it("lists floor graph bindings", async () => {
    const result = await nodeGraphApi.listFloorGraphBindings("p1");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.kind).toBe("native");
    expect(result.items[0]?.graph_id).toBe("g1");
  });

  it("sets a floor graph binding with the expected body", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.put(`${API_BASE}/projects/p1/settings/floor-graph-bindings/compat`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          item: {
            id: "fgb2",
            account_id: "a1",
            workspace_id: "w1",
            project_id: "p1",
            kind: "compat",
            graph_id: "g2",
            graph_version_id: "v3",
            graph_name: "G2",
            graph_version_no: 3,
            status: "active",
            created_at: 0,
            updated_at: 1,
          },
        });
      }),
    );

    const result = await nodeGraphApi.setFloorGraphBinding("p1", "compat", {
      graph_id: "g2",
      graph_version_id: "v3",
    });

    expect(capturedBody).toEqual({ graph_id: "g2", graph_version_id: "v3" });
    expect(result.item.kind).toBe("compat");
    expect(result.item.graph_version_id).toBe("v3");
  });

  it("clears a floor graph binding", async () => {
    const result = await nodeGraphApi.clearFloorGraphBinding("p1", "native");
    expect(result.cleared).toBe(true);
    expect(result.previous?.kind).toBe("native");
  });

  it("throws a NodeGraphApiError with status on non-2xx", async () => {
    server.use(
      http.get(`${API_BASE}/projects/p1/node-graphs/missing`, () =>
        HttpResponse.json({ message: "not found" }, { status: 404 }),
      ),
    );
    await expect(nodeGraphApi.get("p1", "missing")).rejects.toBeInstanceOf(NodeGraphApiError);
    await expect(nodeGraphApi.get("p1", "missing")).rejects.toMatchObject({ status: 404 });
  });
});

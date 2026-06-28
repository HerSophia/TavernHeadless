import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { API_BASE, graphAssistantToolPolicyHandlers } from "../../test/msw/handlers";
import { GraphAssistantToolPolicyApiError, graphAssistantToolPolicyApi } from "./index";

const server = setupServer(...graphAssistantToolPolicyHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers(...graphAssistantToolPolicyHandlers));
afterAll(() => server.close());

describe("graphAssistantToolPolicyApi (msw)", () => {
  it("gets effective policy for a project", async () => {
    const result = await graphAssistantToolPolicyApi.get("p1");
    expect(result.items.length).toBeGreaterThan(0);
    const create = result.items.find((item) => item.tool_name === "nodegraph.graph.create");
    expect(create?.decision).toBe("confirm");
  });

  it("updates policy and reflects override in response", async () => {
    const result = await graphAssistantToolPolicyApi.update("p1", [
      { tool_name: "nodegraph.node.add", decision: "confirm" },
    ]);
    const nodeAdd = result.items.find((item) => item.tool_name === "nodegraph.node.add");
    expect(nodeAdd).toMatchObject({ decision: "confirm", source: "override" });
});

  it("throws a typed error on non-2xx", async () => {
    server.use(
      http.get(`${API_BASE}/projects/missing/graph-assistant/tool-policy`, () =>
        HttpResponse.json({ message: "denied" }, { status: 403 }),
      ),
    );
    await expect(graphAssistantToolPolicyApi.get("missing")).rejects.toBeInstanceOf(
      GraphAssistantToolPolicyApiError,
    );
    await expect(graphAssistantToolPolicyApi.get("missing")).rejects.toMatchObject({ status: 403 });
  });
});

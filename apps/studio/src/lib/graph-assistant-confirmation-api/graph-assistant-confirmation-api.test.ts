import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { API_BASE, graphAssistantConfirmationHandlers } from "../../test/msw/handlers";
import { GraphAssistantConfirmationApiError, graphAssistantConfirmationApi } from "./index";

const server = setupServer(...graphAssistantConfirmationHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers(...graphAssistantConfirmationHandlers));
afterAll(() => server.close());

describe("graphAssistantConfirmationApi (msw)", () => {
  it("lists pending tool calls for a conversation", async () => {
    const result = await graphAssistantConfirmationApi.listPending("c1");
    expect(result.items.length).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: "ptc1",
      tool_name: "nodegraph.graph.create",
      side_effect_level: "irreversible",
      status: "pending",
    });
  });

  it("approves a pending call and returns the resumed result", async () => {
    const response = await graphAssistantConfirmationApi.resolve("c1", "ptc1", "approve");
    expect(response.data.decision).toBe("approved");
    if (response.data.decision === "approved") {
      expect(response.data.pending_tool_call.status).toBe("approved");
      expect(response.data.result.final_state).toBe("assistant_message_committed");
    }
  });

  it("rejects a pending call without a result payload", async () => {
    const response = await graphAssistantConfirmationApi.resolve("c1", "ptc1", "reject");
    expect(response.data.decision).toBe("rejected");
    if (response.data.decision === "rejected") {
      expect(response.data.pending_tool_call.status).toBe("rejected");
    }
  });

  it("throws a typed error on non-2xx", async () => {
    server.use(
      http.get(`${API_BASE}/temporary-conversations/missing/pending-tool-calls`, () =>
        HttpResponse.json({ message: "denied" }, { status: 403 }),
      ),
    );
    await expect(graphAssistantConfirmationApi.listPending("missing")).rejects.toBeInstanceOf(
      GraphAssistantConfirmationApiError,
    );
    await expect(graphAssistantConfirmationApi.listPending("missing")).rejects.toMatchObject({
      status: 403,
    });
  });
});

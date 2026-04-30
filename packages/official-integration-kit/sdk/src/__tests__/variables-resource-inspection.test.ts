import { describe, expect, it, vi } from "vitest";

import { createTransportClient } from "../client/transport.js";
import { createVariablesResource } from "../resources/variables.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk variables inspection resource", () => {
  it("maps page staged writes and promotion traces into camelCase snapshots", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          page_id: "page-1",
          floor_id: "floor-1",
          session_id: "session-1",
          branch_id: "main",
          items: [
            {
              id: "staged-1",
              key: "mood",
              op: "set",
              value: "steady",
              intent: "page_only",
              conflict_policy: "replace",
              reason: "builtin:set_variable",
              source: { toolName: "set_variable", providerId: "builtin" },
              evidence: { runId: "run-1", generationAttemptNo: 1 },
              status: "accepted_page_only",
              decision_reason: null,
              created_at: 100,
              resolved_at: 101,
            },
          ],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          page_id: "page-1",
          floor_id: "floor-1",
          session_id: "session-1",
          branch_id: "main",
          items: [
            {
              id: "trace-1",
              staged_write_id: "staged-1",
              key: "mood",
              from_scope: "page",
              from_scope_id: "page-1",
              to_scope: "floor",
              to_scope_id: "floor-1",
              conflict_policy: "replace",
              source_variable_id: "var-page-1",
              target_variable_id: "var-floor-1",
              value: "steady",
              created_at: 102,
            },
          ],
        },
      }));

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const variables = createVariablesResource(transport);

    await expect(variables.getPageStagedWrites({ accountId: "acc-1", pageId: "page-1" })).resolves.toEqual({
      pageId: "page-1",
      floorId: "floor-1",
      sessionId: "session-1",
      branchId: "main",
      items: [
        {
          id: "staged-1",
          key: "mood",
          op: "set",
          value: "steady",
          intent: "page_only",
          conflictPolicy: "replace",
          reason: "builtin:set_variable",
          source: { toolName: "set_variable", providerId: "builtin" },
          evidence: { runId: "run-1", generationAttemptNo: 1 },
          status: "accepted_page_only",
          decisionReason: null,
          createdAt: 100,
          resolvedAt: 101,
        },
      ],
    });

    await expect(variables.getPagePromotions({ accountId: "acc-1", pageId: "page-1" })).resolves.toEqual({
      pageId: "page-1",
      floorId: "floor-1",
      sessionId: "session-1",
      branchId: "main",
      items: [
        {
          id: "trace-1",
          stagedWriteId: "staged-1",
          key: "mood",
          fromScope: "page",
          fromScopeId: "page-1",
          toScope: "floor",
          toScopeId: "floor-1",
          conflictPolicy: "replace",
          sourceVariableId: "var-page-1",
          targetVariableId: "var-floor-1",
          value: "steady",
          createdAt: 102,
        },
      ],
    });

    const [stagedUrl, stagedInit] = fetchImpl.mock.calls[0]!;
    const [traceUrl, traceInit] = fetchImpl.mock.calls[1]!;

    expect(stagedUrl).toBe("http://localhost:3000/pages/page-1/variables/staged");
    expect((stagedInit?.headers as Headers).get("x-account-id")).toBe("acc-1");
    expect(traceUrl).toBe("http://localhost:3000/pages/page-1/variables/promotions");
    expect((traceInit?.headers as Headers).get("x-account-id")).toBe("acc-1");
  });
});

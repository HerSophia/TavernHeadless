import { describe, expect, it } from "vitest";

import { flattenPageStagedVariableWrites, groupVariablePromotionTrace } from "./page-variable-inspection.js";

describe("flattenPageStagedVariableWrites", () => {
  it("formats staged writes for inspector display and keeps newest writes first", () => {
    const rows = flattenPageStagedVariableWrites({
      items: [
        {
          id: "staged-1",
          key: "mood",
          op: "set",
          value: "steady",
          intent: "page_only",
          conflictPolicy: "replace",
          reason: "builtin:set_variable",
          source: { toolName: "set_variable" },
          evidence: { runId: "run-1" },
          status: "accepted_page_only",
          decisionReason: null,
          createdAt: 100,
          resolvedAt: 101,
        },
        {
          id: "staged-2",
          key: "hp",
          op: "set",
          value: 95,
          intent: "promote_to_floor_on_accept",
          conflictPolicy: "replace",
          reason: "builtin:set_variable",
          source: {},
          evidence: { runId: "run-2" },
          status: "promoted",
          decisionReason: null,
          createdAt: 200,
          resolvedAt: 201,
        },
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({ id: "staged-2", key: "hp", preview: "95", status: "promoted" }),
      expect.objectContaining({ id: "staged-1", key: "mood", preview: '"steady"', status: "accepted_page_only" }),
    ]);
  });
});

describe("groupVariablePromotionTrace", () => {
  it("groups promotion traces by key and keeps the latest group first", () => {
    const groups = groupVariablePromotionTrace({
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
          createdAt: 100,
        },
        {
          id: "trace-2",
          stagedWriteId: "staged-2",
          key: "hp",
          fromScope: "page",
          fromScopeId: "page-1",
          toScope: "floor",
          toScopeId: "floor-1",
          conflictPolicy: "replace",
          sourceVariableId: "var-page-2",
          targetVariableId: "var-floor-2",
          value: 95,
          createdAt: 200,
        },
        {
          id: "trace-3",
          stagedWriteId: "staged-3",
          key: "mood",
          fromScope: "page",
          fromScopeId: "page-2",
          toScope: "floor",
          toScopeId: "floor-2",
          conflictPolicy: "replace",
          sourceVariableId: "var-page-3",
          targetVariableId: "var-floor-3",
          value: "tense",
          createdAt: 150,
        },
      ],
    });

    expect(groups).toEqual([
      {
        key: "hp",
        latestCreatedAt: 200,
        items: [
          expect.objectContaining({ id: "trace-2", key: "hp" }),
        ],
      },
      {
        key: "mood",
        latestCreatedAt: 150,
        items: [
          expect.objectContaining({ id: "trace-3", key: "mood" }),
          expect.objectContaining({ id: "trace-1", key: "mood" }),
        ],
      },
    ]);
  });
});

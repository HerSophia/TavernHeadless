import { describe, expect, it } from "vitest";

import type { ResolvedVariablesSnapshot } from "@tavern/sdk";

import { flattenVariableSnapshot, formatVariablePreview, sortVariableInspectorRows } from "./flatten-variable-snapshot.js";

describe("formatVariablePreview", () => {
  it("formats scalar, object, and array values for inspector previews", () => {
    expect(formatVariablePreview("Museum")).toBe('"Museum"');
    expect(formatVariablePreview(85)).toBe("85");
    expect(formatVariablePreview(true)).toBe("true");
    expect(formatVariablePreview(null)).toBe("null");
    expect(formatVariablePreview([1, 2, 3])).toBe("[Array(3)]");
    expect(formatVariablePreview({ atk: 3 })).toBe('{"atk":3}');
  });
});

describe("flattenVariableSnapshot", () => {
  it("flattens resolved snapshot rows and keeps layer order aligned with scope priority", () => {
    const snapshot: ResolvedVariablesSnapshot = {
      context: {
        accountId: "acc-1",
        floorId: "floor-1",
        globalScopeId: "global",
        pageId: "page-1",
        sessionId: "session-1",
      },
      resolved: [
        {
          key: "mood",
          sourceScope: "floor",
          sourceScopeId: "floor-1",
          updatedAt: 200,
          value: "grim",
        },
        {
          key: "theme",
          sourceScope: "global",
          sourceScopeId: "global",
          updatedAt: 100,
          value: "midnight",
        },
        {
          key: "hp",
          sourceScope: "page",
          sourceScopeId: "page-1",
          updatedAt: 300,
          value: 95,
        },
      ],
      layers: {
        global: {
          items: [
            {
              id: "var-theme-global",
              key: "theme",
              scope: "global",
              scopeId: "global",
              updatedAt: 100,
              value: "midnight",
            },
            {
              id: "var-mood-global",
              key: "mood",
              scope: "global",
              scopeId: "global",
              updatedAt: 90,
              value: "calm",
            },
          ],
          scope: "global",
          scopeId: "global",
        },
        chat: {
          items: [
            {
              id: "var-mood-chat",
              key: "mood",
              scope: "chat",
              scopeId: "session-1",
              updatedAt: 150,
              value: "wary",
            },
          ],
          scope: "chat",
          scopeId: "session-1",
        },
        floor: {
          items: [
            {
              id: "var-mood-floor",
              key: "mood",
              scope: "floor",
              scopeId: "floor-1",
              updatedAt: 200,
              value: "grim",
            },
          ],
          scope: "floor",
          scopeId: "floor-1",
        },
        page: {
          items: [
            {
              id: "var-hp-page",
              key: "hp",
              scope: "page",
              scopeId: "page-1",
              updatedAt: 300,
              value: 95,
            },
          ],
          scope: "page",
          scopeId: "page-1",
        },
      },
    };

    const rows = sortVariableInspectorRows(flattenVariableSnapshot(snapshot));

    expect(rows.map((row) => row.key)).toEqual(["hp", "mood", "theme"]);
    expect(rows[1]).toMatchObject({
      key: "mood",
      preview: '"grim"',
      sourceScope: "floor",
      sourceScopeId: "floor-1",
    });
    expect(rows[1]?.layers.map((layer) => [layer.scope, layer.isWinning, layer.preview])).toEqual([
      ["floor", true, '"grim"'],
      ["chat", false, '"wary"'],
      ["global", false, '"calm"'],
    ]);
  });

  it("falls back to the resolved winner when layer snapshots are absent", () => {
    const rows = flattenVariableSnapshot({
      resolved: [
        {
          key: "inventory",
          sourceScope: "page",
          sourceScopeId: "page-1",
          updatedAt: 400,
          value: ["torch", "map"],
        },
      ],
    });

    expect(rows).toEqual([
      {
        key: "inventory",
        layers: [
          {
            isWinning: true,
            preview: "[Array(2)]",
            scope: "page",
            scopeId: "page-1",
            updatedAt: 400,
            value: ["torch", "map"],
          },
        ],
        preview: "[Array(2)]",
        sourceScope: "page",
        sourceScopeId: "page-1",
        updatedAt: 400,
        value: ["torch", "map"],
      },
    ]);
  });
});

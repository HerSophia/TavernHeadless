import { describe, expect, it } from "vitest";

import {
  buildNativeToolNameMapping,
  isValidNativeToolName,
} from "../../transport/native-tool-name-mapping.js";

describe("native tool name mapping", () => {
  describe("isValidNativeToolName", () => {
    it("accepts names with only letters, digits, underscores and hyphens", () => {
      expect(isValidNativeToolName("get_variable")).toBe(true);
      expect(isValidNativeToolName("roll-dice")).toBe(true);
      expect(isValidNativeToolName("Tool_123")).toBe(true);
    });

    it("rejects names with dots or other invalid characters", () => {
   expect(isValidNativeToolName("nodegraph.graph.create")).toBe(false);
      expect(isValidNativeToolName("tool name")).toBe(false);
      expect(isValidNativeToolName("a.b")).toBe(false);
    });

    it("rejects empty names and names longer than 64 chars", () => {
      expect(isValidNativeToolName("")).toBe(false);
      expect(isValidNativeToolName("a".repeat(65))).toBe(false);
      expect(isValidNativeToolName("a".repeat(64))).toBe(true);
    });
  });

  describe("buildNativeToolNameMapping", () => {
    it("keeps valid names unchanged", () => {
      const mapping = buildNativeToolNameMapping(["get_variable", "roll_dice"]);
      expect(mapping.toSchemaName("get_variable")).toBe("get_variable");
      expect(mapping.toOriginalName("get_variable")).toBe("get_variable");
      expect(mapping.hasRewrites).toBe(false);
    });

    it("sanitizes dotted names and supports round-trip recovery", () => {
      const mapping = buildNativeToolNameMapping([
       "nodegraph.graph.create",
     "nodegraph.node.add",
      ]);

      const schemaCreate = mapping.toSchemaName("nodegraph.graph.create");
      expect(schemaCreate).toBe("nodegraph_graph_create");
      expect(isValidNativeToolName(schemaCreate)).toBe(true);
      // 还原回原始点号名，保证下游执行/transcript 一致。
      expect(mapping.toOriginalName(schemaCreate)).toBe("nodegraph.graph.create");
      expect(mapping.toOriginalName("nodegraph_node_add")).toBe("nodegraph.node.add");
      expect(mapping.hasRewrites).toBe(true);
    });

    it("disambiguates names that sanitize to the same schema name", () => {
      const mapping = buildNativeToolNameMapping(["a.b", "a_b"]);

      const first = mapping.toSchemaName("a.b");
      const second = mapping.toSchemaName("a_b");
      expect(first).not.toBe(second);
      expect(isValidNativeToolName(first)).toBe(true);
      expect(isValidNativeToolName(second)).toBe(true);
      // 两个原始名都能从各自 schema 名还原。
      expect(mapping.toOriginalName(first)).toBe("a.b");
      expect(mapping.toOriginalName(second)).toBe("a_b");
      expect(mapping.hasRewrites).toBe(true);
    });

    it("returns the input itself for unknown names", () => {
      const mapping = buildNativeToolNameMapping(["get_variable"]);
      expect(mapping.toSchemaName("unknown.tool")).toBe("unknown.tool");
      expect(mapping.toOriginalName("unknown_tool")).toBe("unknown_tool");
    });

    it("handles an empty tool list", () => {
      const mapping = buildNativeToolNameMapping([]);
      expect(mapping.hasRewrites).toBe(false);
      expect(mapping.toSchemaName("x")).toBe("x");
    });

    it("keeps sanitized names within the 64 char limit", () => {
      const longDotted = `${"a".repeat(40)}.${"b".repeat(40)}`;
      const mapping = buildNativeToolNameMapping([longDotted]);
      const schemaName = mapping.toSchemaName(longDotted);
      expect(schemaName.length).toBeLessThanOrEqual(64);
      expect(isValidNativeToolName(schemaName)).toBe(true);
    });
  });
});

import { describe, it, expect } from "vitest";

import { applyStructuredTextHunks } from "../apply-structured-text-hunks.js";

describe("applyStructuredTextHunks", () => {
  describe("精确唯一匹配", () => {
    it("oldContent 全文唯一时直接替换并标记为 exact", () => {
      const result = applyStructuredTextHunks("hello world", [
        { oldContent: "world", newContent: "there" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.newText).toBe("hello there");
      expect(result.hunks).toHaveLength(1);
      expect(result.hunks[0]).toMatchObject({
        index: 0,
        matched: true,
        matchKind: "exact",
      });
    });

    it("oldContent 唯一时忽略 startLine，即使 startLine 指向别处也成功", () => {
      const text = "line1\nline2\ntarget\nline4";
      const result = applyStructuredTextHunks(text, [
        { oldContent: "target", newContent: "changed", startLine: 999 },
      ]);

      expect(result.ok).toBe(true);
      expect(result.newText).toBe("line1\nline2\nchanged\nline4");
      expect(result.hunks[0]?.matchKind).toBe("exact");
    });

    it("替换跨多行内容", () => {
      const text = "a\nb\nc\nd";
      const result = applyStructuredTextHunks(text, [
        { oldContent: "b\nc", newContent: "X" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.newText).toBe("a\nX\nd");
    });
  });

  describe("匹配失败", () => {
    it("oldContent 不存在时整体失败且不产出 newText", () => {
      const result = applyStructuredTextHunks("hello world", [
        { oldContent: "missing", newContent: "x" },
      ]);

      expect(result.ok).toBe(false);
      expect(result.newText).toBeUndefined();
      expect(result.hunks[0]?.matched).toBe(false);
      expect(result.hunks[0]?.reason).toContain("not found");
    });

    it("oldContent 为空时失败", () => {
      const result = applyStructuredTextHunks("hello", [
        { oldContent: "", newContent: "x" },
      ]);

      expect(result.ok).toBe(false);
      expect(result.hunks[0]?.matched).toBe(false);
      expect(result.hunks[0]?.reason).toContain("must not be empty");
    });
  });

  describe("重复匹配", () => {
    it("重复且未提供 startLine 时失败并返回候选行号", () => {
      const text = "dup\nmiddle\ndup\nend";
      const result = applyStructuredTextHunks(text, [
        { oldContent: "dup", newContent: "x" },
      ]);

      expect(result.ok).toBe(false);
      expect(result.hunks[0]?.matched).toBe(false);
      expect(result.hunks[0]?.reason).toContain("multiple");
      // "dup"出现在第 1 行和第 3 行
      expect(result.hunks[0]?.candidateLines).toEqual([1, 3]);
    });

    it("重复且提供 startLine 时命中最接近的一处", () => {
      const text = "dup\nmiddle\ndup\nend";
      const result = applyStructuredTextHunks(text, [
        { oldContent: "dup", newContent: "x", startLine: 3 },
      ]);

      expect(result.ok).toBe(true);
      // 只替换第 3 行的 dup，第 1 行保留
      expect(result.newText).toBe("dup\nmiddle\nx\nend");
      expect(result.hunks[0]?.matchKind).toBe("line_anchored");
    });

    it("startLine 指向第一处时命中第一处", () => {
      const text = "dup\nmiddle\ndup\nend";
      const result = applyStructuredTextHunks(text, [
        { oldContent: "dup", newContent: "x", startLine: 1 },
      ]);

      expect(result.ok).toBe(true);
      expect(result.newText).toBe("x\nmiddle\ndup\nend");
    });
  });

  describe("多 hunk与 lineDelta", () => {
    it("顺序应用多个独立 hunk", () => {
      const text = "alpha\nbeta\ngamma";
      const result = applyStructuredTextHunks(text, [
        { oldContent: "alpha", newContent: "A" },
        { oldContent: "gamma", newContent: "G" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.newText).toBe("A\nbeta\nG");
      expect(result.hunks.every((h) => h.matched)).toBe(true);
    });

    it("前序 hunk 插入多行后，后序 hunk 基于原始 startLine 仍能定位重复内容", () => {
      // 原始文本：dup 出现在第 1 行与第 5 行
      const text = "dup\nb\nc\nd\ndup\nf";
      const result = applyStructuredTextHunks(text, [
        // 第一个 hunk 在第 1 行前面插入两行，使后续行号整体下移 2
        { oldContent: "dup\nb", newContent: "x1\nx2\nx3\nb", startLine: 1 },
        // 第二个 hunk 的 startLine 仍按原始文本给出（第 5 行的 dup）
        { oldContent: "dup", newContent: "DUP2", startLine: 5 },
      ]);

      expect(result.ok).toBe(true);
      // 第一处 dup 已被第一个 hunk 吸收，第二处 dup 被正确替换
      expect(result.newText).toBe("x1\nx2\nx3\nb\nc\nd\nDUP2\nf");
    });

    it("前序 hunk 删除整行后，后序 hunk 基于原始 startLine 仍能定位", () => {
      // 原始：dup 在第 2 行与第 5 行
      const text = "head\ndup\nmid\ntail\ndup\nfoot";
      const result = applyStructuredTextHunks(text, [
        // 删除第 1 行 "head\n"，使后续行号整体上移 1
        { oldContent: "head\n", newContent: "" },
        // startLine 仍按原始文本第 5 行给出
        { oldContent: "dup", newContent: "DUP2", startLine: 5 },
      ]);

      expect(result.ok).toBe(true);
      expect(result.newText).toBe("dup\nmid\ntail\nDUP2\nfoot");
    });
  });

  describe("原子性", () => {
    it("多个 hunk 中任一失败则整体不产出 newText", () => {
      const text = "alpha\nbeta\ngamma";
      const result = applyStructuredTextHunks(text, [
        { oldContent: "alpha", newContent: "A" },
        { oldContent: "missing", newContent: "M" },
      ]);

      expect(result.ok).toBe(false);
      expect(result.newText).toBeUndefined();
      expect(result.hunks[0]?.matched).toBe(true);
      expect(result.hunks[1]?.matched).toBe(false);
    });

    it("逐项返回每个 hunk 的诊断", () => {
      const text = "x\ny";
      const result = applyStructuredTextHunks(text, [
        { oldContent: "nope1", newContent: "a" },
        { oldContent: "nope2", newContent: "b" },
      ]);

      expect(result.ok).toBe(false);
      expect(result.hunks).toHaveLength(2);
      expect(result.hunks[0]?.matched).toBe(false);
      expect(result.hunks[1]?.matched).toBe(false);
    });
  });

  describe("空输入", () => {
    it("没有 hunk 时返回原文本", () => {
      const result = applyStructuredTextHunks("unchanged", []);

      expect(result.ok).toBe(true);
      expect(result.newText).toBe("unchanged");
      expect(result.hunks).toHaveLength(0);
    });
  });
});

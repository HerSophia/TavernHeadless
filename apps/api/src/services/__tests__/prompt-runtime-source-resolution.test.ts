import { describe, it, expect } from "vitest";

import {
  resolvePromptSourceGates,
  applyMemorySourceGate,
  applyHistoryWindow,
} from "../prompt-runtime-source-resolution.js";

describe("resolvePromptSourceGates", () => {
  it("全部 source 默认 enabled（sourceSelection 未提供）", () => {
    const result = resolvePromptSourceGates(undefined);
    expect(result.gates.worldbook.enabled).toBe(true);
    expect(result.gates.examples.enabled).toBe(true);
    expect(result.gates.memory.enabled).toBe(true);
    expect(result.gates.history.enabled).toBe(true);
    expect(result.historyWindow.mode).toBe("full");
    expect(result.historyWindow.maxMessages).toBeUndefined();
  });

  it("全部 source 默认 enabled（sourceSelection 为空对象）", () => {
    const result = resolvePromptSourceGates({});
    expect(result.gates.worldbook.enabled).toBe(true);
    expect(result.gates.examples.enabled).toBe(true);
    expect(result.gates.memory.enabled).toBe(true);
  });

  it("worldbook.enabled = false 时 gate 标记 disabled_by_policy", () => {
    const result = resolvePromptSourceGates({ worldbook: { enabled: false } });
    expect(result.gates.worldbook.enabled).toBe(false);
    expect(result.gates.worldbook.reason).toBe("disabled_by_policy");
    // 其他 source 不受影响
    expect(result.gates.examples.enabled).toBe(true);
    expect(result.gates.memory.enabled).toBe(true);
  });

  it("examples.enabled = false 时 gate 标记 disabled_by_policy", () => {
    const result = resolvePromptSourceGates({ examples: { enabled: false } });
    expect(result.gates.examples.enabled).toBe(false);
    expect(result.gates.examples.reason).toBe("disabled_by_policy");
    expect(result.gates.worldbook.enabled).toBe(true);
  });

  it("memory.enabled = false 时 gate 标记 disabled_by_policy", () => {
    const result = resolvePromptSourceGates({ memory: { enabled: false } });
    expect(result.gates.memory.enabled).toBe(false);
    expect(result.gates.memory.reason).toBe("disabled_by_policy");
  });

  it("history.mode = windowed 且 maxMessages > 0 时正确解析", () => {
    const result = resolvePromptSourceGates({
      history: { mode: "windowed", maxMessages: 20 },
    });
    expect(result.historyWindow.mode).toBe("windowed");
    expect(result.historyWindow.maxMessages).toBe(20);
  });

  it("history.mode = windowed 但 maxMessages 未提供时 maxMessages 为 undefined", () => {
    const result = resolvePromptSourceGates({
      history: { mode: "windowed" },
    });
    expect(result.historyWindow.mode).toBe("windowed");
    expect(result.historyWindow.maxMessages).toBeUndefined();
  });

  it("history.mode = full 时忽略 maxMessages", () => {
    const result = resolvePromptSourceGates({
      history: { mode: "full", maxMessages: 10 },
    });
    expect(result.historyWindow.mode).toBe("full");
    expect(result.historyWindow.maxMessages).toBeUndefined();
  });

  it("全部 source 同时禁用", () => {
    const result = resolvePromptSourceGates({
      worldbook: { enabled: false },
      examples: { enabled: false },
      memory: { enabled: false },
    });
    expect(result.gates.worldbook.enabled).toBe(false);
    expect(result.gates.examples.enabled).toBe(false);
    expect(result.gates.memory.enabled).toBe(false);
  });
});

describe("applyMemorySourceGate", () => {
  it("gate enabled 时原样返回 memorySummary", () => {
    expect(applyMemorySourceGate("summary text", { enabled: true })).toBe("summary text");
  });

  it("gate disabled 时返回 undefined", () => {
    expect(applyMemorySourceGate("summary text", { enabled: false, reason: "disabled_by_policy" })).toBeUndefined();
  });

  it("memorySummary 本身为 undefined 时 gate enabled 也返回 undefined", () => {
    expect(applyMemorySourceGate(undefined, { enabled: true })).toBeUndefined();
  });
});

describe("applyHistoryWindow", () => {
  const messages = ["a", "b", "c", "d", "e"];

  it("full 模式原样返回", () => {
    expect(applyHistoryWindow(messages, { mode: "full" })).toEqual(messages);
  });

  it("windowed 模式截断保留最近 N 条", () => {
    expect(applyHistoryWindow(messages, { mode: "windowed", maxMessages: 3 })).toEqual(["c", "d", "e"]);
  });

  it("windowed 模式 maxMessages 大于数组长度时原样返回", () => {
    expect(applyHistoryWindow(messages, { mode: "windowed", maxMessages: 10 })).toEqual(messages);
  });

  it("windowed 模式 maxMessages 为 undefined 时原样返回", () => {
    expect(applyHistoryWindow(messages, { mode: "windowed" })).toEqual(messages);
  });
});

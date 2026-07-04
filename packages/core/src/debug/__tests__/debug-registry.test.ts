import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DebugRecord, DebugSink } from "../debug-sink.js";
import {
  configureDebugSink,
  emitDebug,
  getDebugSink,
  isDebugEnabled,
} from "../debug-registry.js";

/**
 * 内存 fake sink：记录所有写入，按显式开关集合判定域是否启用（`*` 表示全开）。
 * 仅供本测试文件使用，不导出。
 */
class MemorySink implements DebugSink {
  public readonly records: DebugRecord[] = [];
  private readonly enabled: Set<string>;

  constructor(domains: string[] = []) {
    this.enabled = new Set(domains);
  }

  isEnabled(domain: string): boolean {
    return this.enabled.has("*") || this.enabled.has(domain);
  }

  write(record: DebugRecord): void {
    this.records.push(record);
  }
}

describe("debug registry", () => {
  beforeEach(() => {
    configureDebugSink(undefined);
  });

  afterEach(() => {
    configureDebugSink(undefined);
  });

  it("未注册 sink 时 isDebugEnabled 恒为 false", () => {
    expect(isDebugEnabled("native-tool")).toBe(false);
    expect(isDebugEnabled("anything")).toBe(false);
  });

  it("未注册 sink 时 emitDebug 无副作用、不抛错", () => {
    expect(() => emitDebug("native-tool", "info", "msg", { a: 1 })).not.toThrow();
    expect(getDebugSink()).toBeUndefined();
  });

  it("注册 sink 后按域过滤：开 native-tool、未开 prompt", () => {
    const sink = new MemorySink(["native-tool"]);
    configureDebugSink(sink);

    expect(isDebugEnabled("native-tool")).toBe(true);
    expect(isDebugEnabled("prompt")).toBe(false);

    emitDebug("native-tool", "info", "loop-enter", { count: 3 });
    emitDebug("prompt", "info", "render", { tokens: 10 });

    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({
      domain: "native-tool",
      level: "info",
      message: "loop-enter",
      payload: { count: 3 },
    });
  });

  it("payload 透传、timestamp 为正整数", () => {
    const sink = new MemorySink(["native-tool"]);
    configureDebugSink(sink);
    const before = Date.now();

    emitDebug("native-tool", "warn", "leak", { blocks: ["tool_call"] });

    const record = sink.records[0]!;
    expect(record.payload).toEqual({ blocks: ["tool_call"] });
    expect(record.timestamp).toBeGreaterThanOrEqual(before);
    expect(typeof record.timestamp).toBe("number");
  });

  it("省略 level 时默认 info", () => {
    const sink = new MemorySink(["native-tool"]);
    configureDebugSink(sink);

    emitDebug("native-tool", "quick", { x: 1 });

    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({ level: "info", message: "quick", payload: { x: 1 } });
  });

  it("configureDebugSink 可替换已注册的 sink", () => {
    const first = new MemorySink(["native-tool"]);
    const second = new MemorySink(["prompt"]);
    configureDebugSink(first);
    expect(getDebugSink()).toBe(first);

    configureDebugSink(second);
    expect(getDebugSink()).toBe(second);
    expect(isDebugEnabled("native-tool")).toBe(false);
    expect(isDebugEnabled("prompt")).toBe(true);
  });

  it("configureDebugSink(undefined) 清除注册", () => {
    const sink = new MemorySink(["native-tool"]);
    configureDebugSink(sink);
    expect(isDebugEnabled("native-tool")).toBe(true);

    configureDebugSink(undefined);
    expect(getDebugSink()).toBeUndefined();
    expect(isDebugEnabled("native-tool")).toBe(false);
  });

  it("通配 *：sink 启用所有域", () => {
    const sink = new MemorySink(["*"]);
    configureDebugSink(sink);

    emitDebug("a", "info", "1");
    emitDebug("b", "info", "2");
    emitDebug("c", "warn", "3");

    expect(sink.records.map((r) => r.domain)).toEqual(["a", "b", "c"]);
  });
});

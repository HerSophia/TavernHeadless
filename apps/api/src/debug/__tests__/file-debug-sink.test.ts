import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileDebugSink, safeStringify } from "../file-debug-sink.js";
import type { DebugRecord } from "@tavern/core";

function mkRecord(over: Partial<DebugRecord> = {}): DebugRecord {
  return {
    domain: "native-tool",
    level: "info",
    message: "test",
    payload: undefined,
    timestamp: Date.now(),
    ...over,
  };
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tavern-debug-"));
}

describe("FileDebugSink", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("isEnabled：精确匹配与未开域", () => {
    const sink = new FileDebugSink(["native-tool", "memory"], dir);
    expect(sink.isEnabled("native-tool")).toBe(true);
    expect(sink.isEnabled("memory")).toBe(true);
    expect(sink.isEnabled("prompt")).toBe(false);
  });

  it("isEnabled：* 通配全开", () => {
    const sink = new FileDebugSink(["*"], dir);
    expect(sink.isEnabled("anything")).toBe(true);
    expect(sink.isEnabled("native-tool")).toBe(true);
  });

  it("写入对应域文件 debug-<domain>.log，内容含域名与 message", () => {
    const sink = new FileDebugSink(["native-tool"], dir);
    sink.write(mkRecord({ message: "loop-enter", payload: { count: 3 } }));

    const file = join(dir, "debug-native-tool.log");
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, "utf8");
    expect(content).toContain("[native-tool]");
    expect(content).toContain("loop-enter");
    expect(content).toContain('"count":3');
  });

  it("未开启的域不产生文件", () => {
    const sink = new FileDebugSink(["native-tool"], dir);
    sink.write(mkRecord({ domain: "prompt" }));
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("不同域写入各自文件，互不混杂", () => {
    const sink = new FileDebugSink(["a", "b"], dir);
    sink.write(mkRecord({ domain: "a", message: "first" }));
    sink.write(mkRecord({ domain: "b", message: "second" }));

    const aContent = readFileSync(join(dir, "debug-a.log"), "utf8");
    const bContent = readFileSync(join(dir, "debug-b.log"), "utf8");
    expect(aContent).toContain("first");
    expect(aContent).not.toContain("second");
    expect(bContent).toContain("second");
    expect(bContent).not.toContain("first");
  });

  it("目录不存在时自动创建", () => {
    const nested = join(dir, "nested", "deep");
    const sink = new FileDebugSink(["native-tool"], nested);
    sink.write(mkRecord());
    expect(existsSync(join(nested, "debug-native-tool.log"))).toBe(true);
  });

  it("payload 为 undefined 时行尾不带多余空格的 payload 段", () => {
    const sink = new FileDebugSink(["native-tool"], dir);
    sink.write(mkRecord({ payload: undefined }));
    const content = readFileSync(join(dir, "debug-native-tool.log"), "utf8");
    // 消息后不应附带 JSON 段（只有消息本身）
    expect(content.trim().endsWith("test")).toBe(true);
  });
});

describe("safeStringify", () => {
  it("普通对象序列化", () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
  });

  it("循环引用降级为 [Circular] 而不抛错", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const json = safeStringify(obj);
    expect(json).toContain("[Circular]");
    expect(json).toContain('"a":1');
  });

  it("BigInt 降级为字符串", () => {
    expect(safeStringify({ big: 9007199254740993n })).toContain('"big"');
  });
});

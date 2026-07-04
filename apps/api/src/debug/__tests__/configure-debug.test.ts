import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configureDebugSink, getDebugSink } from "@tavern/core";

import {
  configureDebugFromEnv,
  parseDebugDomains,
  TAVERN_DEBUG_ENV,
} from "../configure-debug.js";

describe("parseDebugDomains", () => {
  it("空字符串返回空数组", () => {
    expect(parseDebugDomains("")).toEqual([]);
    expect(parseDebugDomains(undefined)).toEqual([]);
  });

  it("单域", () => {
    expect(parseDebugDomains("native-tool")).toEqual(["native-tool"]);
  });

  it("多域逗号分隔，去空白", () => {
    expect(parseDebugDomains("native-tool, prompt , memory")).toEqual([
      "native-tool",
      "prompt",
      "memory",
    ]);
  });

  it("丢弃纯空白段", () => {
    expect(parseDebugDomains("native-tool, , prompt,,")).toEqual([
      "native-tool",
      "prompt",
    ]);
  });

  it("保留 * 通配", () => {
    expect(parseDebugDomains("*")).toEqual(["*"]);
  });
});

describe("configureDebugFromEnv", () => {
  beforeEach(() => {
    configureDebugSink(undefined);
    delete process.env[TAVERN_DEBUG_ENV];
  });

  afterEach(() => {
    configureDebugSink(undefined);
    delete process.env[TAVERN_DEBUG_ENV];
  });

  it("环境变量未设时不注册 sink", () => {
    configureDebugFromEnv({ logDir: "logs" });
    expect(getDebugSink()).toBeUndefined();
  });

  it("环境变量为空字符串时不注册 sink", () => {
    process.env[TAVERN_DEBUG_ENV] = "";
    configureDebugFromEnv({ logDir: "logs" });
    expect(getDebugSink()).toBeUndefined();
  });

  it("设置域名后注册 FileDebugSink", () => {
    process.env[TAVERN_DEBUG_ENV] = "native-tool,memory";
    configureDebugFromEnv({ logDir: "logs" });
    const sink = getDebugSink();
    expect(sink).toBeDefined();
    expect(sink!.isEnabled("native-tool")).toBe(true);
    expect(sink!.isEnabled("memory")).toBe(true);
    expect(sink!.isEnabled("prompt")).toBe(false);
  });

  it("* 全开", () => {
    process.env[TAVERN_DEBUG_ENV] = "*";
    configureDebugFromEnv({ logDir: "logs" });
    const sink = getDebugSink();
    expect(sink).toBeDefined();
    expect(sink!.isEnabled("anything")).toBe(true);
  });
});

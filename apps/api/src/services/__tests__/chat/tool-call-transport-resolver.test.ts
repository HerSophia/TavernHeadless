import { describe, expect, it } from "vitest";

import {
  ToolCallTransportResolver,
  normalizeToolCallTransportKind,
  readToolCallTransportOverride,
} from "../../chat/tool-call-transport-resolver.js";

describe("ToolCallTransportResolver", () => {
  it("normalizes known transport names and ignores unknown values", () => {
    expect(normalizeToolCallTransportKind("text_protocol")).toBe("text_protocol");
    expect(normalizeToolCallTransportKind("native_function_call")).toBe("native_function_call");
    expect(normalizeToolCallTransportKind("bad")).toBeUndefined();
  });

  it("reads an internal transport override from session metadata", () => {
    expect(readToolCallTransportOverride(JSON.stringify({ tool_transport_override: "text_protocol" }))).toBe("text_protocol");
    expect(readToolCallTransportOverride(JSON.stringify({ toolTransport: "none" }))).toBe("none");
    expect(readToolCallTransportOverride(null)).toBeUndefined();
  });

  it("prioritizes tools_disabled before any override", () => {
    const resolver = new ToolCallTransportResolver();

    expect(resolver.resolve({
      sessionId: "session-1",
      promptMode: "native",
      toolsEnabled: false,
      explicitTransport: "text_protocol",
    })).toEqual(expect.objectContaining({
      transport: "none",
      reasonCode: "tools_disabled",
    }));
  });

  it("returns explicit overrides when tools are enabled", () => {
    const resolver = new ToolCallTransportResolver();

    expect(resolver.resolve({
      sessionId: "session-1",
      promptMode: "compat_plus",
      toolsEnabled: true,
      explicitTransport: "text_protocol",
    })).toEqual(expect.objectContaining({
      transport: "text_protocol",
      reasonCode: "explicit_override",
    }));
  });

  it("falls back to text_protocol when the narrator instance declares no function call support", () => {
    const resolver = new ToolCallTransportResolver();

    expect(resolver.resolve({
      sessionId: "session-1",
      promptMode: "native",
      toolsEnabled: true,
      llmInstanceSupportsFunctionCall: false,
    })).toEqual(expect.objectContaining({
      transport: "text_protocol",
      reasonCode: "instance_not_supports_function_call",
    }));
  });

  it("keeps native_function_call as the default path", () => {
    const resolver = new ToolCallTransportResolver();

    expect(resolver.resolve({
      sessionId: "session-1",
      promptMode: "compat_plus",
      toolsEnabled: true,
    })).toEqual(expect.objectContaining({
      transport: "native_function_call",
      reasonCode: "default_native_function_call",
    }));
  });
});

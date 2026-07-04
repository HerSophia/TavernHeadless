import { describe, expect, it } from "vitest";

import {
  ToolCallTransportResolver,
  isToolCallTransportAllowedInPromptMode,
  listToolCallTransportsForPromptMode,
  normalizeToolCallTransportKind,
  normalizeToolTransportPreference,
  readToolCallTransportOverride,
  resolveGraphAssistantToolTransport,
} from "../../chat/tool-call-transport-resolver.js";

describe("ToolCallTransportResolver", () => {
  it("normalizes known transport names and ignores unknown values", () => {
    expect(normalizeToolCallTransportKind("text_protocol")).toBe("text_protocol");
    expect(normalizeToolCallTransportKind("native_function_call")).toBe("native_function_call");
    expect(normalizeToolCallTransportKind("bad")).toBeUndefined();
  });

  it("lists the currently allowed transports for every prompt mode", () => {
    expect(listToolCallTransportsForPromptMode("compat_strict")).toEqual(["native_function_call", "text_protocol"]);
    expect(listToolCallTransportsForPromptMode("compat_plus")).toEqual(["native_function_call", "text_protocol"]);
    expect(listToolCallTransportsForPromptMode("native")).toEqual(["native_function_call", "text_protocol"]);
    expect(isToolCallTransportAllowedInPromptMode("compat_strict", "native_function_call")).toBe(true);
    expect(isToolCallTransportAllowedInPromptMode("compat_plus", "text_protocol")).toBe(true);
    expect(isToolCallTransportAllowedInPromptMode("native", "none")).toBe(false);
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
      capabilities: {
        supportsFunctionCall: false,
        supportsToolChoice: false,
        supportsStreamingToolCall: false,
        unsupportedGenerationParams: [],
      },
    })).toEqual(expect.objectContaining({
      transport: "text_protocol",
      reasonCode: "instance_not_supports_function_call",
    }));
  });

  it("prefers structured capabilities when choosing the default transport", () => {
    const resolver = new ToolCallTransportResolver();

    expect(resolver.resolve({
      sessionId: "session-1",
      promptMode: "native",
      toolsEnabled: true,
      capabilities: {
        supportsFunctionCall: false,
        supportsToolChoice: false,
        supportsStreamingToolCall: false,
        unsupportedGenerationParams: [],
      },
    })).toEqual(expect.objectContaining({
      transport: "text_protocol",
      reasonCode: "instance_not_supports_function_call",
    }));
  });

  it("rejects explicit overrides that the current prompt mode does not allow", () => {
    const resolver = new ToolCallTransportResolver((_mode, transport) => transport === "native_function_call");

    expect(resolver.resolve({
      sessionId: "session-1",
      promptMode: "compat_plus",
      toolsEnabled: true,
      explicitTransport: "text_protocol",
    })).toEqual(expect.objectContaining({
      transport: "none",
      reasonCode: "override_rejected_by_mode",
    }));
  });

  it("falls back to none when the capability-driven candidate is not allowed in the current prompt mode", () => {
    const resolver = new ToolCallTransportResolver((_mode, transport) => transport === "native_function_call");

    expect(resolver.resolve({
      sessionId: "session-1",
      promptMode: "compat_plus",
      toolsEnabled: true,
      capabilities: {
        supportsFunctionCall: false,
        supportsToolChoice: false,
        supportsStreamingToolCall: false,
        unsupportedGenerationParams: [],
      },
    })).toEqual(expect.objectContaining({
      transport: "none",
      reasonCode: "mode_disallows_transport",
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

describe("normalizeToolTransportPreference", () => {
  it("keeps the three valid preferences", () => {
    expect(normalizeToolTransportPreference("auto")).toBe("auto");
    expect(normalizeToolTransportPreference("native")).toBe("native");
    expect(normalizeToolTransportPreference("text_protocol")).toBe("text_protocol");
  });

  it("falls back to auto for unknown or missing values", () => {
    expect(normalizeToolTransportPreference(undefined)).toBe("auto");
    expect(normalizeToolTransportPreference("bad")).toBe("auto");
    expect(normalizeToolTransportPreference(null)).toBe("auto");
  });
});

describe("resolveGraphAssistantToolTransport", () => {
  it("auto picks native when capability is unknownor supported", () => {
    expect(resolveGraphAssistantToolTransport("auto", undefined)).toEqual({
      transport: "native_function_call",
      nativeFellBack: false,
    });
    expect(resolveGraphAssistantToolTransport("auto", true)).toEqual({
      transport: "native_function_call",
      nativeFellBack: false,
    });
  });

  it("auto falls back to text_protocol when capability is explicitly false", () => {
    expect(resolveGraphAssistantToolTransport("auto", false)).toEqual({
      transport: "text_protocol",
      nativeFellBack: false,
});
  });

  it("native forces native when supported and falls back safely when unsupported", () => {
    expect(resolveGraphAssistantToolTransport("native", true)).toEqual({
      transport: "native_function_call",
      nativeFellBack: false,
    });
    expect(resolveGraphAssistantToolTransport("native", undefined)).toEqual({
      transport: "native_function_call",
      nativeFellBack: false,
    });
    expect(resolveGraphAssistantToolTransport("native", false)).toEqual({
      transport: "text_protocol",
      nativeFellBack: true,
    });
  });

  it("text_protocol always forces the text protocol", () => {
    expect(resolveGraphAssistantToolTransport("text_protocol", true)).toEqual({
    transport: "text_protocol",
      nativeFellBack: false,
    });
    expect(resolveGraphAssistantToolTransport("text_protocol", false)).toEqual({
      transport: "text_protocol",
      nativeFellBack: false,
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  DEFAULT_LLM_INSTANCE_CAPABILITIES,
  normalizeLlmInstanceCapabilities,
  resolveLlmInstanceCapabilities,
} from "./llm-capabilities.js";

describe("llm-capabilities", () => {
  it("returns undefined for missing declarations and resolves conservative defaults", () => {
    expect(normalizeLlmInstanceCapabilities(undefined)).toBeUndefined();
    expect(resolveLlmInstanceCapabilities(undefined)).toEqual({
      supportsFunctionCall: true,
      supportsToolChoice: false,
      supportsStreamingToolCall: false,
      unsupportedGenerationParams: [],
    });
    expect(DEFAULT_LLM_INSTANCE_CAPABILITIES).toEqual({
      supportsFunctionCall: true,
      supportsToolChoice: false,
      supportsStreamingToolCall: false,
      unsupportedGenerationParams: [],
    });
  });

  it("normalizes valid declarations and ignores unknown unsupported params", () => {
    const warnings: string[] = [];

    expect(normalizeLlmInstanceCapabilities({
      supportsFunctionCall: false,
      supportsToolChoice: true,
      unsupportedGenerationParams: [" stopSequences ", "unknown_param", 12],
    }, {
      warn: (message) => warnings.push(message),
    })).toEqual({
      supportsFunctionCall: false,
      supportsToolChoice: true,
      supportsStreamingToolCall: false,
      unsupportedGenerationParams: ["stopSequences"],
    });

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("unknown generation param");
    expect(warnings[1]).toContain("non-string value");
  });

  it("falls back to defaults for invalid scalar fields", () => {
    const warnings: string[] = [];

    expect(normalizeLlmInstanceCapabilities({
      supportsFunctionCall: "no",
      supportsToolChoice: 1,
      supportsStreamingToolCall: null,
      unsupportedGenerationParams: "stopSequences",
    }, {
      warn: (message) => warnings.push(message),
    })).toEqual({
      supportsFunctionCall: true,
      supportsToolChoice: false,
      supportsStreamingToolCall: false,
      unsupportedGenerationParams: [],
    });

    expect(warnings).toHaveLength(4);
  });
});

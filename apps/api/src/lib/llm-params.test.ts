import { describe, expect, it } from "vitest";

import {
  mergeGenerationParamInputs,
  normalizeBindingParams,
  LlmParamsValidationError,
  stripNullGenerationParams,
} from "./llm-params.js";

describe("llm-params", () => {
  it("preserves explicit null fields when normalizing binding params", () => {
    expect(
      normalizeBindingParams(
        {
          temperature: null,
          maxOutputTokens: 256,
          timeoutMs: null,
        },
        true,
      ),
    ).toEqual({
      temperature: null,
      maxOutputTokens: 256,
      timeoutMs: null,
    });
  });

  it("drops invalid values in non-strict mode", () => {
    expect(
      normalizeBindingParams(
        {
          temperature: "bad",
          topK: 32,
        },
        false,
      ),
    ).toEqual({
      topK: 32,
    });
  });

  it("throws on invalid values in strict mode", () => {
    expect(() =>
      normalizeBindingParams(
        {
          temperature: "bad",
        },
        true,
      ),
    ).toThrow(LlmParamsValidationError);
  });

  it("merges generation param inputs while keeping explicit cancellations", () => {
    expect(
      mergeGenerationParamInputs(
        { temperature: 0.7, topP: 0.9 },
        { temperature: null, topK: 40 },
      ),
    ).toEqual({
      temperature: null,
      topP: 0.9,
      topK: 40,
    });
  });

  it("strips null values from generation params before final runtime use", () => {
    expect(
      stripNullGenerationParams({
        temperature: null,
        topP: 0.95,
        maxRetries: null,
      }),
    ).toEqual({
      topP: 0.95,
    });
  });
});

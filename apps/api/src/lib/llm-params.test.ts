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

  it("normalizes and preserves stopSequences when binding params are valid", () => {
    expect(
      normalizeBindingParams(
        {
          stopSequences: [" DONE ", "HALT"],
        },
        true,
      ),
    ).toEqual({
      stopSequences: ["DONE", "HALT"],
    });
  });

  it("rejects invalid stopSequences in strict mode and drops them in non-strict mode", () => {
    expect(() =>
      normalizeBindingParams(
        {
          stopSequences: ["", "HALT"],
        },
        true,
      ),
    ).toThrow(LlmParamsValidationError);

    expect(
      normalizeBindingParams(
        {
          stopSequences: ["", "HALT"],
          temperature: 0.7,
        },
        false,
      ),
    ).toEqual({
      temperature: 0.7,
    });
  });

  it("normalizes new generation params fields in strict mode", () => {
    expect(
      normalizeBindingParams(
        {
          seed: 42,
          repetitionPenalty: 1.1,
          minP: 0.05,
          logitBias: { "42": -5, "43": 10 },
          responseFormat: {
            type: "json_schema",
            jsonSchema: { type: "object" },
          },
        },
        true,
      ),
    ).toEqual({
      seed: 42,
      repetitionPenalty: 1.1,
      minP: 0.05,
      logitBias: { "42": -5, "43": 10 },
      responseFormat: {
        type: "json_schema",
        jsonSchema: { type: "object" },
      },
    });
  });

  it("drops invalid new generation params fields in non-strict mode", () => {
    expect(
      normalizeBindingParams(
        {
          seed: 42.5,
          repetitionPenalty: 0,
          minP: 2,
          logitBias: { "42": 120 },
          responseFormat: { type: "json_schema" },
          temperature: 0.7,
        },
        false,
      ),
    ).toEqual({
      temperature: 0.7,
    });
  });

  it("throws on invalid new generation params fields in strict mode", () => {
    expect(() =>
      normalizeBindingParams(
        {
          responseFormat: { type: "json_schema" },
        },
        true,
      ),
    ).toThrow(LlmParamsValidationError);
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

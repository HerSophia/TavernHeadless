/**
 * Shared LLM generation parameter utilities.
 *
 * Extracted from llm-profile-service to be reused by both
 * LlmProfileService and LlmInstanceService.
 */

import type { GenerationParams } from "@tavern/core";

export type LlmBindingGenerationParams = Partial<Pick<GenerationParams,
  | "maxContextTokens"
  | "maxOutputTokens"
  | "temperature"
  | "topP"
  | "topK"
  | "frequencyPenalty"
  | "presencePenalty"
  | "stream"
  | "timeoutMs"
  | "maxRetries"
  | "reasoningEffort"
>>;

export class LlmParamsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmParamsValidationError";
  }
}

export function parseBindingParamsJson(value: string | null): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function normalizeBindingParams(input: unknown, strict: boolean): LlmBindingGenerationParams | undefined {
  if (input === null || input === undefined) {
    return undefined;
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    if (strict) {
      throw new LlmParamsValidationError("params must be an object");
    }
    return undefined;
  }

  const raw = input as Record<string, unknown>;
  const normalized: LlmBindingGenerationParams = {};

  const readNumber = (
    key: string,
    options: { int?: boolean; min?: number; max?: number } = {}
  ): number | undefined => {
    const value = raw[key];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      if (strict) throw new LlmParamsValidationError(`params.${key} must be a number`);
      return undefined;
    }
    if (options.int && !Number.isInteger(value)) {
      if (strict) throw new LlmParamsValidationError(`params.${key} must be an integer`);
      return undefined;
    }
    if (options.min !== undefined && value < options.min) {
      if (strict) throw new LlmParamsValidationError(`params.${key} must be >= ${options.min}`);
      return undefined;
    }
    if (options.max !== undefined && value > options.max) {
      if (strict) throw new LlmParamsValidationError(`params.${key} must be <= ${options.max}`);
      return undefined;
    }
    return options.int ? Math.trunc(value) : value;
  };

  const maxContextTokens = readNumber("maxContextTokens", { int: true, min: 1 });
  if (maxContextTokens !== undefined) normalized.maxContextTokens = maxContextTokens;

  const maxOutputTokens = readNumber("maxOutputTokens", { int: true, min: 1 });
  if (maxOutputTokens !== undefined) normalized.maxOutputTokens = maxOutputTokens;

  const temperature = readNumber("temperature", { min: 0, max: 2 });
  if (temperature !== undefined) normalized.temperature = temperature;

  const topP = readNumber("topP", { min: 0, max: 1 });
  if (topP !== undefined) normalized.topP = topP;

  const topK = readNumber("topK", { int: true, min: 0 });
  if (topK !== undefined) normalized.topK = topK;

  const frequencyPenalty = readNumber("frequencyPenalty", { min: -2, max: 2 });
  if (frequencyPenalty !== undefined) normalized.frequencyPenalty = frequencyPenalty;

  const presencePenalty = readNumber("presencePenalty", { min: -2, max: 2 });
  if (presencePenalty !== undefined) normalized.presencePenalty = presencePenalty;

  const timeoutMs = readNumber("timeoutMs", { int: true, min: 1 });
  if (timeoutMs !== undefined) normalized.timeoutMs = timeoutMs;

  const maxRetries = readNumber("maxRetries", { int: true, min: 0, max: 10 });
  if (maxRetries !== undefined) normalized.maxRetries = maxRetries;

  const reasoningEffort = raw.reasoningEffort;
  if (reasoningEffort !== undefined && reasoningEffort !== null) {
    if (reasoningEffort !== "low" && reasoningEffort !== "medium" && reasoningEffort !== "high") {
      if (strict) {
        throw new LlmParamsValidationError("params.reasoningEffort must be one of low, medium, high");
      }
    } else {
      normalized.reasoningEffort = reasoningEffort;
    }
  }

  const stream = raw.stream;
  if (stream !== undefined && stream !== null) {
    if (typeof stream !== "boolean") {
      if (strict) throw new LlmParamsValidationError("params.stream must be boolean");
    } else {
      normalized.stream = stream;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

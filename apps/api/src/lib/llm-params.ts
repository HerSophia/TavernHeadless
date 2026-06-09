/**
 * Shared LLM generation parameter utilities.
 *
 * Extracted from llm-profile-service to be reused by both
 * LlmProfileService and LlmInstanceService.
 */

import type { GenerationParams } from "@tavern/core";

export type GenerationParamsInput = Partial<{
  [K in keyof GenerationParams]: GenerationParams[K] | null;
}>;

export type LlmBindingGenerationParams = Partial<Pick<GenerationParamsInput,
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

export const GENERATION_PARAM_KEYS = [
  "maxContextTokens",
  "maxOutputTokens",
  "temperature",
  "topP",
  "topK",
  "frequencyPenalty",
  "presencePenalty",
  "stopSequences",
  "stream",
  "timeoutMs",
  "maxRetries",
  "reasoningEffort",
] as const satisfies ReadonlyArray<keyof GenerationParams>;

export type GenerationParamKey = (typeof GENERATION_PARAM_KEYS)[number];

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

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

export function mergeGenerationParamInputs(
  ...layers: Array<GenerationParamsInput | null | undefined>
): GenerationParamsInput | undefined {
  const merged: GenerationParamsInput = {};
  const mergedRecord = merged as Record<GenerationParamKey, GenerationParamsInput[GenerationParamKey]>;

  for (const layer of layers) {
    if (!layer) {
      continue;
    }

    const layerRecord = layer as Record<GenerationParamKey, GenerationParamsInput[GenerationParamKey]>;
    for (const key of GENERATION_PARAM_KEYS) {
      if (!hasOwn(layer, key)) {
        continue;
      }

      mergedRecord[key] = layerRecord[key];
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function stripNullGenerationParams(
  params?: GenerationParamsInput | null,
): Partial<GenerationParams> | undefined {
  if (!params) {
    return undefined;
  }

  const stripped: Partial<GenerationParams> = {};
  const strippedRecord = stripped as Record<GenerationParamKey, GenerationParams[GenerationParamKey]>;
  const paramsRecord = params as Record<GenerationParamKey, GenerationParamsInput[GenerationParamKey]>;

  for (const key of GENERATION_PARAM_KEYS) {
    if (!hasOwn(params, key)) {
      continue;
    }

    const value = paramsRecord[key];
    if (value !== undefined && value !== null) {
      strippedRecord[key] = value as GenerationParams[GenerationParamKey];
    }
  }

  return Object.keys(stripped).length > 0 ? stripped : undefined;
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
    key: keyof LlmBindingGenerationParams,
    options: { int?: boolean; min?: number; max?: number } = {},
  ): number | null | undefined => {
    if (!hasOwn(raw, key)) {
      return undefined;
    }

    const value = raw[key];
    if (value === null) {
      return null;
    }
    if (value === undefined){
      return undefined;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      if (strict) {
        throw new LlmParamsValidationError(`params.${String(key)} must be a number`);
      }
      return undefined;
    }
    if (options.int && !Number.isInteger(value)) {
      if (strict) {
        throw new LlmParamsValidationError(`params.${String(key)} must be an integer`);
      }
      return undefined;
    }
    if (options.min !== undefined && value < options.min) {
      if (strict) {
        throw new LlmParamsValidationError(`params.${String(key)} must be >= ${options.min}`);
      }
      return undefined;
    }
    if (options.max !== undefined && value > options.max) {
      if (strict) {
        throw new LlmParamsValidationError(`params.${String(key)} must be <= ${options.max}`);
      }
      return undefined;
    }
    return options.int ? Math.trunc(value) : value;
  };

  const readBoolean = (key: keyof LlmBindingGenerationParams): boolean | null | undefined => {
    if (!hasOwn(raw, key)) {
      return undefined;
    }

    const value = raw[key];
    if (value === null) {
      return null;
    }
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "boolean") {
      if (strict) {
        throw new LlmParamsValidationError(`params.${String(key)} must be boolean`);
      }
      return undefined;
    }
    return value;
  };

  const readReasoningEffort = (): GenerationParams["reasoningEffort"] | null | undefined => {
    if (!hasOwn(raw, "reasoningEffort")) {
      return undefined;
    }

    const value = raw.reasoningEffort;
    if (value === null) {
      return null;
    }
    if (value === undefined) {
      return undefined;
    }
    if (value !== "low" && value !== "medium" && value !== "high") {
      if (strict) {
        throw new LlmParamsValidationError("params.reasoningEffort must be one of low, medium, high");
      }
      return undefined;
    }
    return value;
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

  const reasoningEffort = readReasoningEffort();
  if (reasoningEffort !== undefined) normalized.reasoningEffort = reasoningEffort;

  const stream = readBoolean("stream");
  if (stream !== undefined) normalized.stream = stream;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

import type { GenerationParams } from "@tavern/core";

import { GENERATION_PARAM_KEYS, type GenerationParamKey } from "./llm-params.js";

export interface LlmInstanceCapabilities {
  supportsFunctionCall: boolean;
  supportsToolChoice: boolean;
  supportsStreamingToolCall: boolean;
  unsupportedGenerationParams: GenerationParamKey[];
}

export interface LlmInstanceCapabilitiesInput {
  supportsFunctionCall?: boolean;
  supportsToolChoice?: boolean;
  supportsStreamingToolCall?: boolean;
  unsupportedGenerationParams?: ReadonlyArray<keyof GenerationParams | string>;
}

export const DEFAULT_LLM_INSTANCE_CAPABILITIES: Readonly<LlmInstanceCapabilities> = Object.freeze({
  supportsFunctionCall: true,
  supportsToolChoice: false,
  supportsStreamingToolCall: false,
  unsupportedGenerationParams: [] as GenerationParamKey[],
});

const VALID_GENERATION_PARAM_KEYS = new Set<string>(GENERATION_PARAM_KEYS);

type CapabilitiesWarningReporter = (message: string) => void;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createDefaultCapabilities(): LlmInstanceCapabilities {
  return {
    supportsFunctionCall: DEFAULT_LLM_INSTANCE_CAPABILITIES.supportsFunctionCall,
    supportsToolChoice: DEFAULT_LLM_INSTANCE_CAPABILITIES.supportsToolChoice,
    supportsStreamingToolCall: DEFAULT_LLM_INSTANCE_CAPABILITIES.supportsStreamingToolCall,
    unsupportedGenerationParams: [],
  };
}

function warnInvalidCapability(message: string, reporter?: CapabilitiesWarningReporter): void {
  if (reporter) {
    reporter(message);
    return;
  }

  if (process.env.NODE_ENV !== "test") {
    console.warn(message);
  }
}

export function parseLlmInstanceCapabilitiesJson(value: string | null): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function normalizeLlmInstanceCapabilities(
  input: unknown,
  options: { warn?: CapabilitiesWarningReporter } = {},
): LlmInstanceCapabilities | undefined {
  if (input === null || input === undefined) {
    return undefined;
  }

  if (!isPlainObject(input)) {
    warnInvalidCapability("LLM instance capabilities must be an object; ignoring invalid value.", options.warn);
    return undefined;
  }

  const raw = input as Record<string, unknown>;
  const normalized = createDefaultCapabilities();

  if (raw.supportsFunctionCall !== undefined) {
    if (typeof raw.supportsFunctionCall === "boolean") {
      normalized.supportsFunctionCall = raw.supportsFunctionCall;
    } else {
      warnInvalidCapability(
        "LLM instance capability 'supportsFunctionCall' must be boolean; using default true.",
        options.warn,
      );
    }
  }

  if (raw.supportsToolChoice !== undefined) {
    if (typeof raw.supportsToolChoice === "boolean") {
      normalized.supportsToolChoice = raw.supportsToolChoice;
    } else {
      warnInvalidCapability(
        "LLM instance capability 'supportsToolChoice' must be boolean; using default false.",
        options.warn,
      );
    }
  }

  if (raw.supportsStreamingToolCall !== undefined) {
    if (typeof raw.supportsStreamingToolCall === "boolean") {
      normalized.supportsStreamingToolCall = raw.supportsStreamingToolCall;
    } else {
      warnInvalidCapability(
        "LLM instance capability 'supportsStreamingToolCall' must be boolean; using default false.",
        options.warn,
      );
    }
  }

  if (raw.unsupportedGenerationParams !== undefined){
    if (!Array.isArray(raw.unsupportedGenerationParams)) {
      warnInvalidCapability(
        "LLM instance capability 'unsupportedGenerationParams' must be an array of generation param names; using an empty list.",
        options.warn,
      );
    } else {
      const unsupported: GenerationParamKey[] = [];
      for (const value of raw.unsupportedGenerationParams) {
        if (typeof value !== "string") {
          warnInvalidCapability(
            "LLM instance capability 'unsupportedGenerationParams' contains a non-string value; ignoring it.",
            options.warn,
          );
          continue;
        }

        const normalizedKey = value.trim();
        if (!VALID_GENERATION_PARAM_KEYS.has(normalizedKey)) {
          warnInvalidCapability(
            `LLM instance capability references unknown generation param '${normalizedKey}'; ignoring it.`,
            options.warn,
          );
          continue;
        }

        unsupported.push(normalizedKey as GenerationParamKey);
      }

      normalized.unsupportedGenerationParams = unsupported;
    }
  }

  return normalized;
}

export function resolveLlmInstanceCapabilities(
  input: unknown,
  options: { warn?: CapabilitiesWarningReporter } = {},
): LlmInstanceCapabilities {
  return normalizeLlmInstanceCapabilities(input, options) ?? createDefaultCapabilities();
}

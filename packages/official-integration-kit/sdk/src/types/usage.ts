export type ApiUsage = {
  completionTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
};

export type UsageLike = ApiUsage & {
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
};

export function toApiUsage(usage: unknown): ApiUsage {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return {};
  }

  const record = usage as UsageLike;

  return {
    completionTokens: readNumber(record.completionTokens ?? record.completion_tokens),
    inputTokens: readNumber(record.inputTokens ?? record.input_tokens),
    outputTokens: readNumber(record.outputTokens ?? record.output_tokens),
    promptTokens: readNumber(record.promptTokens ?? record.prompt_tokens),
    totalTokens: readNumber(record.totalTokens ?? record.total_tokens),
  };
}

export function resolveInputTokens(usage: unknown): number {
  const normalized = toApiUsage(usage);
  return normalized.inputTokens ?? normalized.promptTokens ?? 0;
}

export function resolveOutputTokens(usage: unknown): number {
  const normalized = toApiUsage(usage);
  return normalized.outputTokens ?? normalized.completionTokens ?? 0;
}

export function resolveTotalTokens(usage: unknown): number {
  const normalized = toApiUsage(usage);
  return normalized.totalTokens ?? resolveInputTokens(normalized) + resolveOutputTokens(normalized);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

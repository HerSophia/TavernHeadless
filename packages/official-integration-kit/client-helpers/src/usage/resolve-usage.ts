import { toApiUsage, type ApiUsage, type UsageLike } from "@tavern/sdk";

export type NormalizedUsage = {
  completionTokens?: number;
  inputTokens: number;
  outputTokens: number;
  promptTokens?: number;
  totalTokens: number;
  usage: ApiUsage;
};

export function resolveUsage(usage: UsageLike | null | undefined): NormalizedUsage {
  const normalized = toApiUsage(usage);
  const inputTokens = normalized.inputTokens ?? normalized.promptTokens ?? 0;
  const outputTokens = normalized.outputTokens ?? normalized.completionTokens ?? 0;
  const totalTokens = normalized.totalTokens ?? inputTokens + outputTokens;

  return {
    completionTokens: normalized.completionTokens,
    inputTokens,
    outputTokens,
    promptTokens: normalized.promptTokens,
    totalTokens,
    usage: normalized,
  };
}

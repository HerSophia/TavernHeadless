import type { TurnSessionStateWriteRequest } from "../../chat/contracts.js";

import type {
  PromptRuntimeSessionStateWriteSummary,
  PromptRuntimeSessionStateWritesSummary,
} from "../types.js";

export function mapPromptRuntimeSessionStateWritesSummary(
  writes: TurnSessionStateWriteRequest[] | undefined,
): PromptRuntimeSessionStateWritesSummary {
  const normalizedWrites: PromptRuntimeSessionStateWriteSummary[] = (writes ?? []).map((write) => ({
    namespace: write.namespace,
    slot: write.slot,
    operation: write.delete === true ? "delete" : "set",
  }));

  return {
    total: normalizedWrites.length,
    writes: normalizedWrites,
  };
}

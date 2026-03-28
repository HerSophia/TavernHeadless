import type { SessionRuntimeToolCatalog } from "@tavern/sdk";

export type RuntimeToolCatalogSummary = {
  availableTools: number;
  confirmOnReplayTools: number;
  conflictRecords: number;
  conflictTools: number;
  neverAutoReplayTools: number;
  replayWarnings: number;
  safeTools: number;
  totalTools: number;
  unavailableTools: number;
  uncertainTools: number;
};

export function summarizeRuntimeToolCatalog(
  catalog: SessionRuntimeToolCatalog,
): RuntimeToolCatalogSummary {
  const tools = catalog.tools;

  return {
    availableTools: tools.filter((tool) => tool.availability === "available").length,
    confirmOnReplayTools: tools.filter((tool) => tool.replaySafety === "confirm_on_replay").length,
    conflictRecords: catalog.conflicts.length,
    conflictTools: tools.filter((tool) => tool.availability === "conflict").length,
    neverAutoReplayTools: tools.filter((tool) => tool.replaySafety === "never_auto_replay").length,
    replayWarnings: tools.filter((tool) => tool.replaySafety !== "safe").length,
    safeTools: tools.filter((tool) => tool.replaySafety === "safe").length,
    totalTools: tools.length,
    unavailableTools: tools.filter((tool) => tool.availability === "unavailable").length,
    uncertainTools: tools.filter((tool) => tool.replaySafety === "uncertain").length,
  };
}

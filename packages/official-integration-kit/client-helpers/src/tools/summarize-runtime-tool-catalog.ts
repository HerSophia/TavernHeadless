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

/**
 * 汇总会话级运行时工具目录快照。
 * 它只基于 `/sessions/:id/tools/runtime` 的 session 级目录做统计，不展开未来 run/node/step overlay。
 */
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

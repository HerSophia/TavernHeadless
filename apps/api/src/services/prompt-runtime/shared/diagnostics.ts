import type { PromptRuntimeDiagnostic } from "../control-service.js";

export function createUnmaterializedBranchInspectDiagnostic(
  branchId: string,
): PromptRuntimeDiagnostic {
  return {
    code: "unmaterialized_branch_inspect",
    message: `Inspect targeted unmaterialized branch '${branchId}'. Branch policy overlay is unavailable until the branch is materialized.`,
    severity: "info",
    source: "branch",
    phase: "assemble",
  };
}

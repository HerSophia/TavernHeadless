import type {
  PromptRuntimeGovernanceSeedEntry,
  PromptRuntimeGovernanceRetention,
  PromptRuntimeSourceGovernanceLevel,
} from "@tavern/core";

import type { AssembleResult } from "../prompt-assembler.js";

import type {
  PromptRuntimeGovernanceEntry,
  PromptRuntimeGovernanceMismatch,
  PromptRuntimeGovernanceMismatchCode,
  PromptRuntimeGovernanceView,
} from "./types.js";

function resolveEffectiveGovernance(entry: PromptRuntimeGovernanceSeedEntry): {
  effectiveRetention: PromptRuntimeGovernanceRetention;
  pinned: boolean | null;
  prunable: boolean | null;
} {
  const pinnedValues = [...new Set(entry.pinnedValues)];
  const prunableValues = [...new Set(entry.prunableValues)];
  if (pinnedValues.length > 1 || prunableValues.length > 1) {
    return {
      effectiveRetention: "mixed",
      pinned: null,
      prunable: null,
    };
  }

  const pinned = pinnedValues[0] ?? false;
  const prunable = prunableValues[0] ?? false;
  if (pinned) {
    return {
      effectiveRetention: "fixed",
      pinned,
      prunable,
    };
  }

  if (prunable) {
    return {
      effectiveRetention: "budget_prunable",
      pinned,
      prunable,
    };
  }

  return {
    effectiveRetention: "soft_required",
    pinned,
    prunable,
  };
}

function createMismatch(entry: PromptRuntimeGovernanceEntry): PromptRuntimeGovernanceMismatch[] {
  const mismatches: PromptRuntimeGovernanceMismatch[] = [];
  if (!entry.registered) {
    mismatches.push({
      code: "unregistered_governed_source",
      sourceKind: entry.sourceKind,
      declaredLevel: entry.declaredLevel,
      effectiveRetention: entry.effectiveRetention,
      budgetGroups: entry.budgetGroups,
      message: `Governed source '${entry.sourceKind}' has no runtime registry descriptor.`,
    });
  }

  if (entry.effectiveRetention === "mixed") {
    mismatches.push({
      code: "mixed_effective_retention",
      sourceKind: entry.sourceKind,
      declaredLevel: entry.declaredLevel,
      effectiveRetention: entry.effectiveRetention,
      budgetGroups: entry.budgetGroups,
      message: `Governed source '${entry.sourceKind}' resolved to mixed effective retention across sections.`,
    });
    return mismatches;
  }

  if (entry.declaredLevel === "budget_prunable" && entry.effectiveRetention === "fixed") {
    mismatches.push({
      code: "declared_budget_prunable_but_effectively_fixed",
      sourceKind: entry.sourceKind,
      declaredLevel: entry.declaredLevel,
      effectiveRetention: entry.effectiveRetention,
      budgetGroups: entry.budgetGroups,
      message: `Source '${entry.sourceKind}' is declared budget_prunable but is effectively fixed in prompt assembly.`,
    });
  }

  if (entry.declaredLevel === "soft_required" && entry.effectiveRetention === "budget_prunable") {
    mismatches.push({
      code: "declared_soft_required_but_effectively_budget_prunable",
      sourceKind: entry.sourceKind,
      declaredLevel: entry.declaredLevel,
      effectiveRetention: entry.effectiveRetention,
      budgetGroups: entry.budgetGroups,
      message: `Source '${entry.sourceKind}' is declared soft_required but remains budget-prunable in prompt assembly.`,
    });
  }

  return mismatches;
}

function mapGovernanceEntry(entry: PromptRuntimeGovernanceSeedEntry): PromptRuntimeGovernanceEntry {
  const effective = resolveEffectiveGovernance(entry);
  return {
    sourceKind: entry.sourceKind,
    declaredLevel: entry.declaredLevel,
    registered: entry.registered,
    effectiveRetention: effective.effectiveRetention,
    pinned: effective.pinned,
    prunable: effective.prunable,
    budgetGroups: entry.budgetGroups,
    sectionNames: entry.sectionNames,
    tokenCount: entry.tokenCount,
    retainedTokenCount: entry.retainedTokenCount,
    prunedTokenCount: entry.prunedTokenCount,
  };
}

export function buildPromptRuntimeGovernanceView(args: {
  assembled?: AssembleResult;
  fallbackLimitations?: string[];
}): PromptRuntimeGovernanceView {
  const limitations = [...(args.fallbackLimitations ?? [])];
  const entries = args.assembled?.governance?.entries?.map(mapGovernanceEntry) ?? [];
  if (!args.assembled?.governance) {
    limitations.push(
      "Governance view is unavailable for this prompt assembly because no governance seed data was recorded.",
    );
  }

  const mismatches = entries.flatMap((entry) => createMismatch(entry));
  return {
    entries,
    mismatches,
    limitations,
  };
}

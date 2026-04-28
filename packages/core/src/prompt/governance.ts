import {
  buildPromptRuntimeSectionBudgetGroup,
  resolvePromptRuntimeSourceDescriptor,
  resolvePromptRuntimeSourceGovernanceLevel,
  type PromptRuntimeSourceGovernanceLevel,
} from "./runtime-registry.js";
import type {
  IRSection,
  PromptRuntimeGovernancePolicy,
  PromptRuntimeGovernanceRetention,
  PromptRuntimeGovernanceSeed,
  PromptRuntimeGovernanceSeedEntry,
} from "./types.js";

interface PromptRuntimeGovernanceFallback {
  budgetGroup?: string;
  pinned: boolean;
  prunable: boolean;
}

function mapGovernanceLevelToRetention(level: PromptRuntimeSourceGovernanceLevel): PromptRuntimeGovernanceRetention {
  switch (level) {
    case "hard_required":
      return "fixed";
    case "soft_required":
      return "soft_required";
    case "budget_prunable":
      return "budget_prunable";
  }
}

function mapGovernanceLevelToPolicy(level: PromptRuntimeSourceGovernanceLevel): Pick<
  PromptRuntimeGovernancePolicy,
  "pinned" | "prunable" | "effectiveRetention"
> {
  switch (level) {
    case "hard_required":
      return {
        pinned: true,
        prunable: false,
        effectiveRetention: "fixed",
      };
    case "soft_required":
      return {
        pinned: false,
        prunable: false,
        effectiveRetention: "soft_required",
      };
    case "budget_prunable":
      return {
        pinned: false,
        prunable: true,
        effectiveRetention: "budget_prunable",
      };
  }
}

function resolveEffectiveRetentionFromFlags(
  pinned: boolean,
  prunable: boolean,
): PromptRuntimeGovernanceRetention {
  if (pinned) {
    return "fixed";
  }

  if (prunable) {
    return "budget_prunable";
  }

  return "soft_required";
}

function resolveSectionBudgetGroup(section: IRSection): string {
  const budgetGroup = typeof section.budgetGroup === "string"
    ? section.budgetGroup.trim()
    : "";

  return budgetGroup.length > 0
    ? budgetGroup
    : buildPromptRuntimeSectionBudgetGroup(section.name);
}

export function resolvePromptRuntimeGovernancePolicy(args: {
  sourceKind: string;
  budgetGroup?: string;
  fallback: PromptRuntimeGovernanceFallback;
}): PromptRuntimeGovernancePolicy {
  const descriptor = resolvePromptRuntimeSourceDescriptor(args.sourceKind);
  const declaredLevel = resolvePromptRuntimeSourceGovernanceLevel(args.sourceKind);
  const budgetGroup = args.budgetGroup
    ?? descriptor?.defaultBudgetGroup
    ?? args.fallback.budgetGroup
    ?? args.sourceKind;

  if (declaredLevel) {
    return {
      sourceKind: args.sourceKind,
      budgetGroup,
      declaredLevel,
      ...mapGovernanceLevelToPolicy(declaredLevel),
    };
  }

  return {
    sourceKind: args.sourceKind,
    budgetGroup,
    pinned: args.fallback.pinned,
    prunable: args.fallback.prunable,
    effectiveRetention: resolveEffectiveRetentionFromFlags(
      args.fallback.pinned,
      args.fallback.prunable,
    ),
  };
}

export function inferPromptRuntimeGovernanceSourceKind(
  section: IRSection,
): string | undefined {
  const budgetGroup = resolveSectionBudgetGroup(section);
  if (budgetGroup === "history" || section.semantic === "chat_history") {
    return "history";
  }

  if (budgetGroup === "memory" || section.name === "memory") {
    return "memory";
  }

  if (budgetGroup === "worldbook" || section.name.startsWith("worldbook")) {
    return "worldbook";
  }

  if (budgetGroup === "examples" || section.name.toLowerCase().includes("example")) {
    return "examples";
  }

  if (budgetGroup === "section:nativeSystem" || section.name === "nativeSystem") {
    return "native_system";
  }

  return undefined;
}

export function buildPromptRuntimeGovernanceSeed(args: {
  sections: IRSection[];
  retainedByGroup?: Record<string, number>;
  prunedByGroup?: Record<string, number>;
}): PromptRuntimeGovernanceSeed {
  type MutableEntry = {
    sourceKind: string;
    declaredLevel?: PromptRuntimeSourceGovernanceLevel;
    registered: boolean;
    budgetGroups: Set<string>;
    sectionNames: Set<string>;
    pinnedValues: Set<boolean>;
    prunableValues: Set<boolean>;
    tokenCount: number;
  };

  const entries = new Map<string, MutableEntry>();

  for (const section of args.sections) {
    const sourceKind = inferPromptRuntimeGovernanceSourceKind(section);
    if (!sourceKind) {
      continue;
    }

    const budgetGroup = resolveSectionBudgetGroup(section);
    const tokenCount = section.messages.reduce(
      (sum, message) => sum + (message.tokenCount ?? 0),
      0,
    );
    const descriptor = resolvePromptRuntimeSourceDescriptor(sourceKind);
    const entry = entries.get(sourceKind) ?? {
      sourceKind,
      declaredLevel: resolvePromptRuntimeSourceGovernanceLevel(sourceKind),
      registered: descriptor !== undefined,
      budgetGroups: new Set<string>(),
      sectionNames: new Set<string>(),
      pinnedValues: new Set<boolean>(),
      prunableValues: new Set<boolean>(),
      tokenCount: 0,
    } satisfies MutableEntry;

    entry.budgetGroups.add(budgetGroup);
    entry.sectionNames.add(section.name);
    entry.pinnedValues.add(section.pinned === true);
    for (const message of section.messages) {
      entry.prunableValues.add(message.prunable !== false);
    }
    entry.tokenCount += tokenCount;
    entries.set(sourceKind, entry);
  }

  const normalizedEntries: PromptRuntimeGovernanceSeedEntry[] = [...entries.values()]
    .map((entry) => {
      const budgetGroups = [...entry.budgetGroups].sort((left, right) => left.localeCompare(right));
      const retainedTokenCount = budgetGroups.reduce(
        (sum, group) => sum + (args.retainedByGroup?.[group] ?? 0),
        0,
      );
      const prunedTokenCount = budgetGroups.reduce(
        (sum, group) => sum + (args.prunedByGroup?.[group] ?? 0),
        0,
      );
      const tokenCount = entry.tokenCount > 0
        ? entry.tokenCount
        : retainedTokenCount + prunedTokenCount;

      return {
        sourceKind: entry.sourceKind,
        declaredLevel: entry.declaredLevel,
        registered: entry.registered,
        budgetGroups,
        sectionNames: [...entry.sectionNames].sort((left, right) => left.localeCompare(right)),
        pinnedValues: [...entry.pinnedValues].sort((left, right) => Number(left) - Number(right)),
        prunableValues: [...entry.prunableValues].sort((left, right) => Number(left) - Number(right)),
        tokenCount,
        retainedTokenCount,
        prunedTokenCount,
      } satisfies PromptRuntimeGovernanceSeedEntry;
    })
    .sort((left, right) => left.sourceKind.localeCompare(right.sourceKind));

  return {
    entries: normalizedEntries,
  };
}

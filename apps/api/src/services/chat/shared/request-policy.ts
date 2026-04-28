import type { PromptVisibilityPolicy } from "../../chat-history-loader.js";
import type {
  PromptBudgetPolicy,
  PromptDeliveryPolicy,
  PromptSourceSelectionPolicy,
  PromptStructurePolicy,
} from "../../prompt-assembler.js";
import { buildPromptRuntimeRequestPolicy } from "../../prompt-runtime-execution.js";

export function buildLivePromptRuntimeRequestPolicy(request: {
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  budget?: PromptBudgetPolicy;
  sourceSelection?: PromptSourceSelectionPolicy;
}) {
  return buildPromptRuntimeRequestPolicy({
    structure: request.structure,
    delivery: request.delivery,
    budget: request.budget,
    sourceSelection: request.sourceSelection,
  });
}

export function buildInspectionPromptRuntimeRequestPolicy(request?: {
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  budget?: PromptBudgetPolicy;
  sourceSelection?: PromptSourceSelectionPolicy;
  visibility?: PromptVisibilityPolicy;
}) {
  return buildPromptRuntimeRequestPolicy(request);
}

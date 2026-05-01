import type { PromptRuntimeRegexPhaseId } from "../../prompt-assembler.js";
import { REGEX_PLACEMENT, type RegexExecutionChannel } from "@tavern/adapters-sillytavern";

export interface PromptRuntimeRegexPhaseContract {
  phaseId: PromptRuntimeRegexPhaseId;
  placement: number;
  channel: RegexExecutionChannel | null;
  executable: boolean;
  inspectable: boolean;
  snapshotWorthy: boolean;
  reserved: boolean;
}

const PHASE_CONTRACTS: readonly PromptRuntimeRegexPhaseContract[] = [
  {
    phaseId: "persist.user_input",
    placement: REGEX_PLACEMENT.USER_INPUT,
    channel: "persist",
    executable: true,
    inspectable: true,
    snapshotWorthy: true,
    reserved: false,
  },
  {
    phaseId: "prompt.user_input",
    placement: REGEX_PLACEMENT.USER_INPUT,
    channel: "prompt",
    executable: true,
    inspectable: true,
    snapshotWorthy: true,
    reserved: false,
  },
  {
    phaseId: "persist.ai_output",
    placement: REGEX_PLACEMENT.AI_OUTPUT,
    channel: "persist",
    executable: true,
    inspectable: true,
    snapshotWorthy: true,
    reserved: false,
  },
  {
    phaseId: "prompt.world_info.reserved",
    placement: REGEX_PLACEMENT.WORLD_INFO,
    channel: "prompt",
    executable: false,
    inspectable: true,
    snapshotWorthy: true,
    reserved: true,
  },
] as const;

const PHASE_CONTRACT_MAP = new Map(
  PHASE_CONTRACTS.map((contract) => [contract.phaseId, contract] satisfies [PromptRuntimeRegexPhaseId, PromptRuntimeRegexPhaseContract]),
);

export const PROMPT_RUNTIME_REGEX_PHASE_ORDER = PHASE_CONTRACTS.map((contract) => contract.phaseId);

export function listPromptRuntimeRegexPhaseContracts(): PromptRuntimeRegexPhaseContract[] {
  return [...PHASE_CONTRACTS];
}

export function getPromptRuntimeRegexPhaseContract(
  phaseId: PromptRuntimeRegexPhaseId,
): PromptRuntimeRegexPhaseContract {
  const contract = PHASE_CONTRACT_MAP.get(phaseId);
  if (!contract) {
    throw new Error(`Unknown prompt runtime regex phase '${phaseId}'.`);
  }

  return contract;
}

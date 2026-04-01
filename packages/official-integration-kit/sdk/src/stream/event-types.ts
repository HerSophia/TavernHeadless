import type { RespondFinalState } from "../resources/sessions.js";
import type { ApiUsage } from "../types/usage.js";

export type TavernRespondStartPayload = {
  branchId?: string;
  floorId?: string;
  floorNo?: number;
};

export type TavernRespondChunkPayload = {
  chunk: string;
};

export type TavernRespondSummaryPayload = {
  summaries: string[];
};

export type TavernRespondRunPendingOutputPayload = {
  attemptNo: number;
  error?: string | null;
  startedAt: number;
  state: "draft" | "streaming" | "generated" | "failed";
  tempId: string;
  text: string;
  updatedAt: number;
};

export type TavernRespondRunVerifierIssuePayload = {
  description: string;
  severity: "warning" | "error";
};

export type TavernRespondRunVerifierPayload = {
  issues?: TavernRespondRunVerifierIssuePayload[] | null;
  status: "pending" | "passed" | "warned" | "blocked" | "skipped";
  suggestion?: string | null;
};

export type TavernRespondRunErrorPayload = {
  code: string;
  message: string;
};

export type TavernRespondRunPayload = {
  attemptNo: number;
  completedAt?: number | null;
  error?: TavernRespondRunErrorPayload | null;
  floorId: string;
  pendingOutput?: TavernRespondRunPendingOutputPayload | null;
  phase: "input_recorded" | "semantic_resolved" | "prechecked" | "prompt_assembled" | "page_generating" | "candidate_generated" | "verifier_checked" | "transaction_prepared" | "transaction_committed" | "post_commit_scheduled";
  phaseSeq: number;
  publicPhase: "preparing" | "generating" | "verifying" | "committing" | "post_processing";
  runId: string; runType: "respond" | "regenerate_page" | "retry_turn" | "edit_and_regenerate"; startedAt: number; status: "running" | "completed" | "failed" | "cancelled"; updatedAt: number; verifier?: TavernRespondRunVerifierPayload | null;
};

export type TavernRespondToolPhase = "start" | "success" | "error" | "denied" | "timeout" | "uncertain" | "blocked";
export type TavernRespondToolReplaySafety = "safe" | "confirm_on_replay" | "never_auto_replay" | "uncertain";
export type TavernRespondToolProviderType = "builtin" | "preset" | "mcp" | "unknown";
export type TavernRespondToolSideEffectLevel = "none" | "sandbox" | "irreversible";

export type TavernRespondToolPayload = {
  durationMs?: number;
  executionId: string;
  message?: string;
  phase: TavernRespondToolPhase;
  providerId: string;
  providerType?: TavernRespondToolProviderType;
  replaySafety: TavernRespondToolReplaySafety;
  sideEffectLevel?: TavernRespondToolSideEffectLevel;
  toolName: string;
};

export type TavernRespondErrorPayload = {
  code?: string;
  message?: string;
};

export type TavernRespondDonePayload = {
  branchId?: string;
  finalState?: RespondFinalState;
  floorId: string;
  floorNo: number;
  generatedText?: string;
  summaries: string[];
  totalUsage: ApiUsage;
};

export type TavernRespondStreamEvent =
  | { payload: TavernRespondStartPayload; type: "start" }
  | { payload: TavernRespondChunkPayload; type: "chunk" }
  | { payload: TavernRespondRunPayload; type: "run" }
  | { payload: TavernRespondSummaryPayload; type: "summary" }
  | { payload: TavernRespondToolPayload; type: "tool" }
  | { payload: TavernRespondErrorPayload; type: "error" }
  | { payload: TavernRespondDonePayload; type: "done" };

export type TavernStreamEvent = TavernRespondStreamEvent;

export type RespondStreamCallbacks = {
  onChunk?: (payload: TavernRespondChunkPayload) => void;
  onError?: (payload: TavernRespondErrorPayload) => void;
  onEvent?: (event: TavernRespondStreamEvent) => void;
  onRun?: (payload: TavernRespondRunPayload) => void;
  onStart?: (payload: TavernRespondStartPayload) => void;
  onSummary?: (payload: TavernRespondSummaryPayload) => void;
  onTool?: (payload: TavernRespondToolPayload) => void;
};

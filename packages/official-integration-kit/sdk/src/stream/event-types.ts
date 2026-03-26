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
  | { payload: TavernRespondSummaryPayload; type: "summary" }
  | { payload: TavernRespondErrorPayload; type: "error" }
  | { payload: TavernRespondDonePayload; type: "done" };

export type TavernStreamEvent = TavernRespondStreamEvent;

export type RespondStreamCallbacks = {
  onChunk?: (payload: TavernRespondChunkPayload) => void;
  onError?: (payload: TavernRespondErrorPayload) => void;
  onEvent?: (event: TavernRespondStreamEvent) => void;
  onStart?: (payload: TavernRespondStartPayload) => void;
  onSummary?: (payload: TavernRespondSummaryPayload) => void;
};

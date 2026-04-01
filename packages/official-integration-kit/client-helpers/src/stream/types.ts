import type { RespondResult, TavernRespondRunPayload, TavernRespondToolPayload } from "@tavern/sdk";

export type RespondStreamWarning = {
  code: string;
  executionId?: string;
  message: string;
  toolName?: string;
};

export type RespondStreamState = {
  activeTools: Record<string, TavernRespondToolPayload>;
  branchId?: string;
  content: string;
  error?: {
    code?: string;
    message: string;
  };
  floorId?: string;
  floorNo?: number;
  run?: TavernRespondRunPayload | null;
  result: RespondResult | null;
  status: "idle" | "streaming" | "done" | "error";
  summaries: string[];
  toolEvents: TavernRespondToolPayload[];
  warnings: RespondStreamWarning[];
};

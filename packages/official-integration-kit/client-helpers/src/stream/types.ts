import type { RespondResult } from "@tavern/sdk";

export type RespondStreamState = {
  branchId?: string;
  content: string;
  error?: {
    code?: string;
    message: string;
  };
  floorId?: string;
  floorNo?: number;
  result: RespondResult | null;
  status: "idle" | "streaming" | "done" | "error";
  summaries: string[];
};

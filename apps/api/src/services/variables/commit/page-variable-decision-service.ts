import { eq } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../../../db/client.js";
import { messagePages } from "../../../db/schema.js";
import type { PageVariableDecision } from "../contracts.js";

export interface ResolvePageVariableDecisionInput {
  floorId: string;
  pageId?: string;
  rerouteToSessionState?: boolean;
}

export class PageVariableDecisionService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  resolveForCommit(input: ResolvePageVariableDecisionInput): PageVariableDecision | undefined {
    if (input.rerouteToSessionState) {
      return {
        status: "rerouted_to_session_state",
        decisionReason: "identified_as_session_state_candidate",
      };
    }

    if (!input.pageId) {
      return undefined;
    }

    const page = this.db
      .select()
      .from(messagePages)
      .where(eq(messagePages.id, input.pageId))
      .limit(1)
      .all()[0];

    if (!page) {
      return {
        status: "rejected",
        decisionReason: "page_commit_gate_source_page_missing",
      };
    }

    if (page.floorId !== input.floorId) {
      return {
        status: "rejected",
        decisionReason: "page_commit_gate_floor_mismatch",
      };
    }

    if (!page.isActive) {
      return {
        status: "discarded",
        decisionReason: "page_not_active_at_commit",
      };
    }

    return undefined;
  }
}

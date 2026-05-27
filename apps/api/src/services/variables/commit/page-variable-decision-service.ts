import { eq } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../../../db/client.js";
import { messagePages } from "../../../db/schema.js";
import { resolveVariableDecisionCode } from "../../state-governance/shared/page-inspection-contracts.js";
import type { PageVariableDecision } from "../contracts.js";

const OUTPUT_PAGE_REQUIRED_DECISION_REASON = "page_commit_gate_source_page_not_output";

export interface ResolvePageVariableDecisionInput {
  floorId: string;
  pageId?: string;
  rerouteToSessionState?: boolean;
}

export class PageVariableDecisionService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  resolveForCommit(input: ResolvePageVariableDecisionInput): PageVariableDecision | undefined {
    if (input.rerouteToSessionState && !input.pageId) {
      return {
        status: "rerouted_to_session_state",
        decisionCode: "rerouted_to_session_state",
        decisionReason: "identified_as_session_state_candidate",
        reroutedTarget: "session_state",
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
        decisionCode: "source_page_missing",
        decisionReason: "page_commit_gate_source_page_missing",
      };
    }

    if (page.floorId !== input.floorId) {
      return {
        status: "rejected",
        decisionCode: "source_page_scope_mismatch",
        decisionReason: "page_commit_gate_floor_mismatch",
      };
    }

    if (page.pageKind !== "output") {
      return {
        status: "rejected",
        decisionCode: resolveVariableDecisionCode({
          status: "rejected",
          decisionReason: OUTPUT_PAGE_REQUIRED_DECISION_REASON,
        }),
        decisionReason: OUTPUT_PAGE_REQUIRED_DECISION_REASON,
      };
    }

    if (!page.isActive) {
      return {
        status: "discarded",
        decisionCode: "source_page_not_active",
        decisionReason: "page_not_active_at_commit",
      };
    }

    if (input.rerouteToSessionState) {
      return {
        status: "rerouted_to_session_state",
        decisionCode: "rerouted_to_session_state",
        decisionReason: "identified_as_session_state_candidate",
        reroutedTarget: "session_state",
      };
    }

    return undefined;
  }
}

import { apiClient } from "../api";
import { isWorkspaceMessageRole, normalizeContentFormat } from "./mappers";
import { buildAccountHeaders } from "./transport";
import type {
  TimelineResponse,
  WorkspaceTimelineMessage
} from "./types";

export async function fetchSessionTimeline(sessionId: string, accountId?: string): Promise<WorkspaceTimelineMessage[]> {
  const response = await apiClient.get("/sessions/{id}/timeline", {
    headers: buildAccountHeaders(accountId),
    path: {
      id: sessionId
    },
    query: {
      branch_id: "main",
      limit: 200,
      offset: 0
    }
  });

  if (response.status !== 200 || !response.body || typeof response.body !== "object") {
    return [];
  }

  const payload = response.body as TimelineResponse;
  const floors = payload.data?.floors ?? [];
  const timeline: WorkspaceTimelineMessage[] = [];

  for (const floor of floors) {
    const page = floor.active_page;
    if (!page) {
      continue;
    }

    for (const message of page.messages) {
      if (!isWorkspaceMessageRole(message.role)) {
        continue;
      }

      timeline.push({
        at: floor.created_at,
        content: message.content,
        contentFormat: normalizeContentFormat(message.content_format),
        floorState: floor.state,
        floorId: floor.id,
        floorNo: floor.floor_no,
        id: message.id,
        pageId: page.id,
        role: message.role,
        seq: message.seq,
        tokenIn: floor.token_in,
        tokenOut: floor.token_out
      });
    }
  }

  return timeline;
}

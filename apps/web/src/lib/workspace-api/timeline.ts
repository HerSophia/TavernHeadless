import { buildTimelineMessages } from "@tavern/client-helpers";

import { apiClient } from "../api";
import type { WorkspaceTimelineMessage } from "./types";

export async function fetchSessionTimeline(sessionId: string, accountId?: string): Promise<WorkspaceTimelineMessage[]> {
  const timeline = await apiClient.sessions.timeline({
    accountId,
    branchId: "main",
    limit: 200,
    offset: 0,
    sessionId
  });

  return buildTimelineMessages(timeline.floors);
}

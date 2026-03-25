import type { TimelineFloor } from "@tavern/sdk";

import type { TimelineContentFormat, TimelineMessageView } from "./types.js";

export function buildTimelineMessages(floors: TimelineFloor[]): TimelineMessageView[] {
  const timeline: TimelineMessageView[] = [];

  for (const floor of floors) {
    const page = floor.activePage;
    if (!page) {
      continue;
    }

    for (const message of page.messages) {
      if (!isTimelineRole(message.role)) {
        continue;
      }

      timeline.push({
        at: floor.createdAt,
        content: message.content,
        contentFormat: normalizeContentFormat(message.contentFormat),
        floorId: floor.id,
        floorNo: floor.floorNo,
        floorState: floor.state,
        id: message.id,
        pageId: page.id,
        role: message.role,
        seq: message.seq,
        tokenIn: floor.tokenIn,
        tokenOut: floor.tokenOut,
      });
    }
  }

  return timeline;
}

function isTimelineRole(role: string): role is TimelineMessageView["role"] {
  return role === "assistant" || role === "narrator" || role === "system" || role === "user";
}

function normalizeContentFormat(format: string): TimelineContentFormat {
  return format === "json" || format === "markdown" ? format : "text";
}

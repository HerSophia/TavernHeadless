import type { TimelineFloor } from "@tavern/sdk";

import type { TimelineContentFormat, TimelineMessageView } from "./types.js";

/**
 * 把 timeline floors 平铺为按消息为粒度的 TimelineMessageView 列表。
 *
 * 后端 page-aware 升级后，一个 floor 可能同时存在多条 active page。为避免丢失消息：
 *
 * 1. 优先从 `floor.activePages` 展开（page-aware 真相源）。
 * 2. 若 `activePages` 为空，由于后端会在 仅 1 条 active page 的场景同时回填
 *    `activePage`，这里回退到 `activePage`，保证兼容。
 * 3. 再次回退到 `pages` 里 `isActive === true` 的子集，用于 SDK 尚未支持
 *    page-aware 字段的转接期。
 *
 * 同一 floor 内多条 active page 的 messages 按照 pages 的顺序拼接。
 */
export function buildTimelineMessages(floors: TimelineFloor[]): TimelineMessageView[] {
  const timeline: TimelineMessageView[] = [];

  for (const floor of floors) {
    const activePages = resolveActivePagesForTimeline(floor);
    if (activePages.length === 0) {
      continue;
    }

    for (const page of activePages) {
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
  }

  return timeline;
}

function resolveActivePagesForTimeline(floor: TimelineFloor): TimelineFloor["activePages"] {
  const activePages = floor.activePages ?? [];
  if (activePages.length > 0) {
    return activePages;
  }

  if (floor.activePage) {
    return [floor.activePage];
  }

  const pages = floor.pages ?? [];
  return pages.filter((page) => page.isActive);
}

function isTimelineRole(role: string): role is TimelineMessageView["role"] {
  return role === "assistant" || role === "narrator" || role === "system" || role === "user";
}

function normalizeContentFormat(format: string): TimelineContentFormat {
  return format === "json" || format === "markdown" ? format : "text";
}

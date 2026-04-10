import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { sessions, floors, messagePages, messages } from "../../db/schema.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import {
  ChatHistoryLoader,
  type PromptVisibilityPolicy,
} from "../chat-history-loader.js";

describe("ChatHistoryLoader visibility policy", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  async function seedSessionWithFloors() {
    const now = Date.now();
    const sessionId = nanoid();

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "History Visibility Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    for (let floorNo = 1; floorNo <= 5; floorNo += 1) {
      const floorId = nanoid();
      const pageId = nanoid();
      await database.db.insert(floors).values({
        id: floorId,
        sessionId,
        floorNo,
        branchId: "main",
        parentFloorId: floorNo > 1 ? `parent-${floorNo - 1}` : null,
        state: "committed",
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now + floorNo,
        updatedAt: now + floorNo,
      });
      await database.db.insert(messagePages).values({
        id: pageId,
        floorId,
        pageNo: 1,
        pageKind: "input",
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: now + floorNo,
        updatedAt: now + floorNo,
      });
      await database.db.insert(messages).values({
        id: nanoid(),
        pageId,
        role: "user",
        content: `floor-${floorNo}`,
        seq: 1,
        isHidden: false,
        createdAt: now + floorNo,
      });
    }

    return sessionId;
  }

  async function loadVisibleMessages(args: {
    sessionId: string;
    historyMaxFloors?: number;
    visibility?: PromptVisibilityPolicy;
  }) {
    const loader = new ChatHistoryLoader(database.db, args.historyMaxFloors);
    return loader.loadHistory(args.sessionId, "main", undefined, args.visibility);
  }

  it("filters hidden floor ranges before applying historyMaxFloors", async () => {
    const sessionId = await seedSessionWithFloors();

    const messages = await loadVisibleMessages({
      sessionId,
      historyMaxFloors: 2,
      visibility: {
        hiddenFloorRanges: [{ startFloorNo: 5, endFloorNo: 5 }],
      },
    });

    expect(messages.map((message) => message.content)).toEqual(["floor-3", "floor-4"]);
  });

  it("supports multiple hidden ranges", async () => {
    const sessionId = await seedSessionWithFloors();

    const messages = await loadVisibleMessages({
      sessionId,
      visibility: {
        hiddenFloorRanges: [
          { startFloorNo: 2, endFloorNo: 3 },
          { startFloorNo: 5, endFloorNo: 5 },
        ],
      },
    });

    expect(messages.map((message) => message.content)).toEqual(["floor-1", "floor-4"]);
  });

  it("supports deny_all_except_visible mode", async () => {
    const sessionId = await seedSessionWithFloors();

    const messages = await loadVisibleMessages({
      sessionId,
      visibility: {
        mode: "deny_all_except_visible",
        visibleFloorRanges: [{ startFloorNo: 2, endFloorNo: 4 }],
      },
    });

    expect(messages.map((message) => message.content)).toEqual(["floor-2", "floor-3", "floor-4"]);
  });

  it("supports hidden floor ids", async () => {
    const now = Date.now();
    const sessionId = nanoid();
    await database.db.insert(sessions).values({
      id: sessionId,
      title: "History Hidden Id Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const floorIds: string[] = [];
    for (let floorNo = 1; floorNo <= 3; floorNo += 1) {
      const floorId = nanoid();
      floorIds.push(floorId);
      const pageId = nanoid();
      await database.db.insert(floors).values({
        id: floorId,
        sessionId,
        floorNo,
        branchId: "main",
        parentFloorId: null,
        state: "committed",
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now + floorNo,
        updatedAt: now + floorNo,
      });
      await database.db.insert(messagePages).values({
        id: pageId,
        floorId,
        pageNo: 1,
        pageKind: "input",
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: now + floorNo,
        updatedAt: now + floorNo,
      });
      await database.db.insert(messages).values({
        id: nanoid(),
        pageId,
        role: "user",
        content: `visible-${floorNo}`,
        seq: 1,
        isHidden: false,
        createdAt: now + floorNo,
      });
    }

    const messagesLoaded = await loadVisibleMessages({
      sessionId,
      visibility: {
        hiddenFloorIds: [floorIds[1]!],
      },
    });

    expect(messagesLoaded.map((message) => message.content)).toEqual(["visible-1", "visible-3"]);
  });
});

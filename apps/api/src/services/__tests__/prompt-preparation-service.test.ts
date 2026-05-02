import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { SimpleTokenCounter } from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { floors, messagePages, messages, sessions } from "../../db/schema.js";
import { ChatHistoryLoader } from "../chat-history-loader.js";
import { PromptPreparationService } from "../chat/prompt-preparation-service.js";

describe("PromptPreparationService conversation window", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  async function seedSessionWithUserTail(): Promise<string> {
    const sessionId = nanoid();
    const now = Date.now();

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Prompt Preparation Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const floorSeeds = [
      { floorNo: 1, role: "user" as const, content: "hello" },
      { floorNo: 2, role: "user" as const, content: "again" },
    ];

    let parentFloorId: string | null = null;
    for (const floorSeed of floorSeeds) {
      const floorId = nanoid();
      const pageId = nanoid();
      await database.db.insert(floors).values({
        id: floorId,
        sessionId,
        floorNo: floorSeed.floorNo,
        branchId: "main",
        parentFloorId,
        state: "committed",
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now + floorSeed.floorNo,
        updatedAt: now + floorSeed.floorNo,
      });
      await database.db.insert(messagePages).values({
        id: pageId,
        floorId,
        pageNo: 1,
        pageKind: "input",
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: now + floorSeed.floorNo,
        updatedAt: now + floorSeed.floorNo,
      });
      await database.db.insert(messages).values({
        id: nanoid(),
        pageId,
        role: floorSeed.role,
        content: floorSeed.content,
        seq: 1,
        isHidden: false,
        createdAt: now + floorSeed.floorNo,
      });
      parentFloorId = floorId;
    }

    return sessionId;
  }

  it("applies sourceSelection history windows after effective turn normalization", async () => {
    const sessionId = await seedSessionWithUserTail();
    const service = new PromptPreparationService(
      database.db,
      new SimpleTokenCounter(),
      new ChatHistoryLoader(database.db),
    );

    const result = await service.loadPromptRuntimeConversationWindow({
      sessionId,
      branchId: "main",
      visibility: { mode: "allow_all_except_hidden" },
      sourceSelection: {
        history: {
          mode: "windowed",
          maxMessages: 1,
        },
      },
      currentInput: {
        content: "third ask",
      },
    });

    expect(result.history).toEqual([]);
    expect(result.effectiveUserMessage).toBe("hello\n\nagain\n\nthird ask");
    expect(result.historyNormalization).toEqual({
      rawEntryCount: 3,
      effectiveTurnCount: 1,
      selectedTurnCount: 1,
      trailingUserSourceFloorIds: expect.any(Array),
      mergedUserGroups: [
        {
          effectiveRole: "user",
          sourceFloorIds: expect.any(Array),
          sourceMessageIds: expect.any(Array),
          includesCurrentInput: true,
        },
      ],
      violations: [],
    });
    expect(result.historyNormalization.trailingUserSourceFloorIds).toHaveLength(2);
    for (const floorId of result.historyNormalization.trailingUserSourceFloorIds) {
      expect(typeof floorId).toBe("string");
      expect(floorId.length).toBeGreaterThan(0);
    }
  });
});

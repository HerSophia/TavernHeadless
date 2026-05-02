import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { floors, messagePages, messages, sessions } from "../../db/schema.js";
import { ConversationShapePolicyService } from "../conversation-shape-policy.js";

describe("ConversationShapePolicyService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("allows consecutive user floors", async () => {
    const sessionId = await seedSession(database, Date.now());
    await seedUserOnlyFloor(database, { sessionId, floorNo: 1, content: "first ask" });
    const secondFloorId = await seedUserOnlyFloor(database, { sessionId, floorNo: 2, content: "second ask" });

    const rejection = new ConversationShapePolicyService(database.db).getFloorMutationRejection(secondFloorId);

    expect(rejection).toBeNull();
  });

  it("rejects adjacent assistant floors against the previous live floor", async () => {
    const sessionId = await seedSession(database, Date.now());
    const previousFloorId = await seedAssistantOnlyFloor(database, { sessionId, floorNo: 1, content: "reply one" });
    const currentFloorId = await seedAssistantOnlyFloor(database, { sessionId, floorNo: 2, content: "reply two" });

    const rejection = new ConversationShapePolicyService(database.db).getFloorMutationRejection(currentFloorId);

    expect(rejection).toEqual({
      code: "invalid_conversation_shape",
      reason: "adjacent_assistant_floors",
      message: "This write would create consecutive assistant floors in the active conversation shape.",
      floorId: currentFloorId,
      previousFloorId,
      nextFloorId: null,
    });
  });

  it("rejects adjacent assistant floors against the next live floor", async () => {
    const sessionId = await seedSession(database, Date.now());
    await seedUserOnlyFloor(database, { sessionId, floorNo: 1, content: "setup" });
    const currentFloorId = await seedAssistantOnlyFloor(database, { sessionId, floorNo: 2, content: "reply one" });
    const nextFloorId = await seedAssistantOnlyFloor(database, { sessionId, floorNo: 3, content: "reply two" });

    const rejection = new ConversationShapePolicyService(database.db).getFloorMutationRejection(currentFloorId);

    expect(rejection).toEqual({
      code: "invalid_conversation_shape",
      reason: "adjacent_assistant_floors",
      message: "This write would create consecutive assistant floors in the active conversation shape.",
      floorId: currentFloorId,
      previousFloorId: null,
      nextFloorId,
    });
  });
});

async function seedSession(database: DatabaseConnection, now: number): Promise<string> {
  const sessionId = nanoid();
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Conversation shape session",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return sessionId;
}

async function seedUserOnlyFloor(
  database: DatabaseConnection,
  input: { sessionId: string; floorNo: number; content: string },
): Promise<string> {
  return seedFloorWithActiveMessage(database, {
    sessionId: input.sessionId,
    floorNo: input.floorNo,
    pageKind: "input",
    role: "user",
    content: input.content,
  });
}

async function seedAssistantOnlyFloor(
  database: DatabaseConnection,
  input: { sessionId: string; floorNo: number; content: string },
): Promise<string> {
  return seedFloorWithActiveMessage(database, {
    sessionId: input.sessionId,
    floorNo: input.floorNo,
    pageKind: "output",
    role: "assistant",
    content: input.content,
  });
}

async function seedFloorWithActiveMessage(
  database: DatabaseConnection,
  input: {
    sessionId: string;
    floorNo: number;
    pageKind: "input" | "output";
    role: "user" | "assistant";
    content: string;
  },
): Promise<string> {
  const now = Date.now() + input.floorNo;
  const floorId = nanoid();
  const pageId = nanoid();

  await database.db.insert(floors).values({
    id: floorId,
    sessionId: input.sessionId,
    floorNo: input.floorNo,
    branchId: "main",
    parentFloorId: null,
    state: "draft",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now,
    updatedAt: now,
  });
  await database.db.insert(messagePages).values({
    id: pageId,
    floorId,
    pageNo: input.pageKind === "input" ? 0 : 1,
    pageKind: input.pageKind,
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: now,
    updatedAt: now,
  });
  await database.db.insert(messages).values({
    id: nanoid(),
    pageId,
    seq: 0,
    role: input.role,
    content: input.content,
    contentFormat: "text",
    tokenCount: input.content.length,
    isHidden: false,
    source: "api",
    createdAt: now,
  });

  return floorId;
}

import { eq } from "drizzle-orm";
import { SimpleTokenCounter } from "@tavern/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp, type BuildAppResult } from "../../app.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import {
  floorResultSnapshots,
  floors,
  messagePages,
  messages,
  operationLogs,
  sessions,
} from "../../db/schema.js";

const NOW = 1_736_910_000_000;
const tokenCounter = new SimpleTokenCounter();

async function buildRevisionApp(): Promise<BuildAppResult> {
  const built = await buildApp({
    accountMode: "single",
    auth: { mode: "off" },
    databasePath: ":memory:",
    logger: false,
  });
  await built.app.ready();
  return built;
}

async function seedCommittedFixture(
  built: BuildAppResult,
  input: {
    content?: string;
    floorId: string;
    messageId: string;
    pageId: string;
    sessionId: string;
  },
): Promise<void> {
  const content = input.content ?? "Original committed content";

  await built.database.insert(sessions).values({
    id: input.sessionId,
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    title: "Manual revision route test",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await built.database.insert(floors).values({
    id: input.floorId,
    sessionId: input.sessionId,
    floorNo: 1,
    branchId: "main",
    parentFloorId: null,
    supersededAt: null,
    supersededByFloorId: null,
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await built.database.insert(messagePages).values({
    id: input.pageId,
    floorId: input.floorId,
    pageNo: 1,
    pageKind: "output",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await built.database.insert(messages).values({
    id: input.messageId,
    pageId: input.pageId,
    seq: 0,
    role: "assistant",
    content,
    contentFormat: "text",
    tokenCount: tokenCounter.count(content),
    isHidden: false,
    source: "api",
    createdAt: NOW,
  });
}

describe("manual revision routes", () => {
  const builtApps: BuildAppResult[] = [];

  afterEach(async () => {
    while (builtApps.length > 0) {
      const built = builtApps.pop();
      if (built) {
        await built.app.close();
      }
    }
  });

  it("updates message current truth and keeps floor result snapshot unchanged", async () => {
    const built = await buildRevisionApp();
    builtApps.push(built);

    await seedCommittedFixture(built, {
      floorId: "floor:message",
      messageId: "message:message",
      pageId: "page:message",
      sessionId: "session:message",
      content: "Original committed content",
    });
    await built.database.insert(floorResultSnapshots).values({
      floorId: "floor:message",
      outputPageId: "page:message",
      assistantMessageId: "message:message",
      generatedText: "Original committed content",
      summariesJson: JSON.stringify(["summary"]),
      usageJson: JSON.stringify({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
      verifierJson: null,
      committedAt: NOW,
      updatedAt: NOW,
    });

    const applyResponse = await built.app.inject({
      method: "POST",
      url: "/messages/message:message/manual-revisions",
      payload: {
        content: "Revised committed content",
        expected_latest_revision_no: 0,
        reason: "fix wording",
      },
    });

    expect(applyResponse.statusCode, applyResponse.body).toBe(200);
    expect(applyResponse.json()).toMatchObject({
      data: {
        target_kind: "message",
        target_id: "message:message",
        message_id: "message:message",
        page_id: "page:message",
        floor_id: "floor:message",
        current_content: "Revised committed content",
        latest_revision_no: 1,
        items: [
          {
            requested_target_kind: "message",
            requested_target_id: "message:message",
            original_content: "Original committed content",
            previous_content: "Original committed content",
            edited_content: "Revised committed content",
            reason: "fix wording",
          },
        ],
      },
    });

    const getMessageResponse = await built.app.inject({
      method: "GET",
      url: "/messages/message:message",
    });
    expect(getMessageResponse.statusCode, getMessageResponse.body).toBe(200);
    expect(getMessageResponse.json()).toMatchObject({
      data: {
        id: "message:message",
        content: "Revised committed content",
        token_count: tokenCounter.count("Revised committed content"),
      },
    });

    const historyResponse = await built.app.inject({
      method: "GET",
      url: "/messages/message:message/manual-revisions",
    });
    expect(historyResponse.statusCode, historyResponse.body).toBe(200);
    expect(historyResponse.json()).toMatchObject({
      data: {
        target_kind: "message",
        target_id: "message:message",
        latest_revision_no: 1,
        current_content: "Revised committed content",
        items: [
          {
            requested_target_kind: "message",
            requested_target_id: "message:message",
          },
        ],
      },
    });

    const floorResultResponse = await built.app.inject({
      method: "GET",
      url: "/floors/floor:message/result",
    });
    expect(floorResultResponse.statusCode, floorResultResponse.body).toBe(200);
    expect(floorResultResponse.json()).toMatchObject({
      data: {
        floor_id: "floor:message",
        generated_text: "Original committed content",
      },
    });

    const storedPage = await built.database
      .select()
      .from(messagePages)
      .where(eq(messagePages.id, "page:message"))
      .limit(1);
    expect(storedPage[0]?.updatedAt).toBeGreaterThan(NOW);

    const storedLogs = await built.database
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.floorId, "floor:message"));
    expect(storedLogs).toHaveLength(1);
    expect(storedLogs[0]).toMatchObject({
      action: "message.manual_revision.apply",
      targetType: "message_manual_revision",
    });
  });

  it("resolves single-message pages and records page-target revision history", async () => {
    const built = await buildRevisionApp();
    builtApps.push(built);

    await seedCommittedFixture(built, {
      floorId: "floor:page",
      messageId: "message:page",
      pageId: "page:page",
      sessionId: "session:page",
      content: "Page route original content",
    });

    const applyResponse = await built.app.inject({
      method: "POST",
      url: "/pages/page:page/manual-revisions",
      payload: {
        content: "Page route revised content",
        expected_latest_revision_no: 0,
        reason: "page wrapper",
      },
    });

    expect(applyResponse.statusCode, applyResponse.body).toBe(200);
    expect(applyResponse.json()).toMatchObject({
      data: {
        target_kind: "page",
        target_id: "page:page",
        message_id: "message:page",
        current_content: "Page route revised content",
        latest_revision_no: 1,
        items: [
          {
            requested_target_kind: "page",
            requested_target_id: "page:page",
            message_id: "message:page",
          },
        ],
      },
    });

    const historyResponse = await built.app.inject({
      method: "GET",
      url: "/pages/page:page/manual-revisions",
    });
    expect(historyResponse.statusCode, historyResponse.body).toBe(200);
    expect(historyResponse.json()).toMatchObject({
      data: {
        target_kind: "page",
        target_id: "page:page",
        message_id: "message:page",
        current_content: "Page route revised content",
        latest_revision_no: 1,
      },
    });

    const storedMessage = await built.database
      .select()
      .from(messages)
      .where(eq(messages.id, "message:page"))
      .limit(1);
    expect(storedMessage[0]?.content).toBe("Page route revised content");
  });

  it("rejects page manual revision when the page contains multiple messages", async () => {
    const built = await buildRevisionApp();
    builtApps.push(built);

    await seedCommittedFixture(built, {
      floorId: "floor:shape",
      messageId: "message:shape:1",
      pageId: "page:shape",
      sessionId: "session:shape",
      content: "First content",
    });
    await built.database.insert(messages).values({
      id: "message:shape:2",
      pageId: "page:shape",
      seq: 1,
      role: "assistant",
      content: "Second content",
      contentFormat: "text",
      tokenCount: tokenCounter.count("Second content"),
      isHidden: false,
      source: "api",
      createdAt: NOW + 1,
    });

    const response = await built.app.inject({
      method: "POST",
      url: "/pages/page:shape/manual-revisions",
      payload: {
        content: "Should fail",
        expected_latest_revision_no: 0,
      },
    });

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "manual_revision_shape_not_supported",
        details: {
          page_id: "page:shape",
          message_count: 2,
        },
      },
    });
  });
});

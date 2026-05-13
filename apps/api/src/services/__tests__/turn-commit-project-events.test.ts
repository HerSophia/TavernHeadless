import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { SimpleTokenCounter, createEventBus, type TurnExecutionResult } from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  floors,
  messagePages,
  messages,
  operationLogs,
  projectEvents,
} from "../../db/schema.js";
import {
  createTestProject,
  createTestSessionWithScope,
} from "../../__tests__/helpers/workspace-project.js";
import { ChatMessagePersistence } from "../chat-message-persistence.js";
import { ProjectEventLiveHub } from "../project-event-live-hub.js";
import type { ProjectEventRecord } from "../project-event-service.js";
import { TurnCommitService } from "../turn-commit-service.js";

const ACCOUNT_ID = "default-admin";

function seedFloor(args: {
  database: DatabaseConnection;
  sessionId: string;
  floorId: string;
  now: number;
}): void {
  args.database.db.insert(floors).values({
    id: args.floorId,
    sessionId: args.sessionId,
    floorNo: 1,
    branchId: "main",
    parentFloorId: null,
    state: "generating",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: args.now,
    updatedAt: args.now,
  }).run();
}

function seedInputPage(args: {
  database: DatabaseConnection;
  floorId: string;
  pageId: string;
  now: number;
}): void {
  args.database.db.insert(messagePages).values({
    id: args.pageId,
    floorId: args.floorId,
    pageNo: 0,
    pageKind: "input",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: args.now,
    updatedAt: args.now,
  }).run();
}

function createService(database: DatabaseConnection, hub?: ProjectEventLiveHub): TurnCommitService {
  return new TurnCommitService(
    database.db,
    new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
    createEventBus(),
    { projectEventLiveHub: hub },
  );
}

function listProjectEvents(database: DatabaseConnection, projectId: string): ProjectEventRecord[] {
  return database.db
    .select()
    .from(projectEvents)
    .where(eq(projectEvents.projectId, projectId))
    .orderBy(asc(projectEvents.sequence))
    .all()
    .map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      sequence: row.sequence,
      type: row.type,
      visibility: row.visibility,
      source: row.source,
      actorAccountId: row.actorAccountId,
      sessionId: row.sessionId,
      branchId: row.branchId,
      floorId: row.floorId,
      pageId: row.pageId,
      messageId: row.messageId,
      operationLogId: row.operationLogId,
      correlationId: row.correlationId,
      causationEventId: row.causationEventId,
      payload: JSON.parse(row.payloadJson),
      createdAt: row.createdAt,
    }));
}

function payloadOf(event: ProjectEventRecord): Record<string, unknown> {
  expect(event.payload).toEqual(expect.any(Object));
  return event.payload as Record<string, unknown>;
}

describe("TurnCommitService project events", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("persists and publishes floor and variable project events after commit", async () => {
    const now = 1_735_800_000_000;
    const committedAt = now + 100;
    const session = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT_ID,
      id: "sess_turn_project_events",
      now,
    });
    const floorId = nanoid();
    const pageId = nanoid();
    seedFloor({ database, sessionId: session.sessionId, floorId, now });
    seedInputPage({ database, floorId, pageId, now });

    const hub = new ProjectEventLiveHub();
    const published: ProjectEventRecord[] = [];
    const unsubscribe = hub.subscribe(session.projectId, (event) => {
      published.push(event);
    });
    const service = createService(database, hub);

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Accepted project event write.",
      rawText: "Accepted project event write.",
      summaries: [],
      totalUsage: {
        promptTokens: 11,
        completionTokens: 13,
        totalTokens: 24,
      },
      bufferedVariableMutations: [
        {
          runId: "run-variable-project-event",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "mood",
          value: "steady",
          intent: "promote_to_floor_on_accept",
          reason: "test:set_variable",
          source: { toolName: "set_variable", providerId: "builtin" },
          bufferedAt: now + 10,
        },
      ],
    };

    const result = await service.commit({
      accountId: ACCOUNT_ID,
      floorId,
      sessionId: session.sessionId,
      execution,
      committedAt,
      runId: "run-project-events",
      variableCommit: { pageId },
      operationLog: {
        requestId: "req-project-events",
        operationGroupId: "op-group-project-events",
        route: "POST /sessions/:id/respond",
      },
    });
    unsubscribe();

    const events = listProjectEvents(database, session.projectId);
    expect(events.map((event) => event.type)).toEqual([
      "floor.stateChanged",
      "floor.committed",
      "variable.set",
      "variable.promoted",
    ]);
    expect(published.map((event) => event.id)).toEqual(events.map((event) => event.id));

    const [stateChanged, committed, variableSet, variablePromoted] = events;
    expect(stateChanged).toMatchObject({
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      sequence: 1,
      visibility: "project",
      source: "api",
      actorAccountId: ACCOUNT_ID,
      sessionId: session.sessionId,
      branchId: "main",
      floorId,
      correlationId: "req-project-events",
      causationEventId: null,
      createdAt: committedAt,
    });
    expect(payloadOf(stateChanged!)).toMatchObject({
      floor_id: floorId,
      floor_no: 1,
      branch_id: "main",
      from: "generating",
      to: "committed",
    });

    expect(committed).toMatchObject({
      sequence: 2,
      type: "floor.committed",
      pageId: result.outputPageId,
      messageId: result.assistantMessageId,
      causationEventId: stateChanged!.id,
      operationLogId: stateChanged!.operationLogId,
      correlationId: "req-project-events",
    });
    expect(payloadOf(committed!)).toMatchObject({
      floor_id: floorId,
      floor_no: 1,
      branch_id: "main",
      page_id: result.outputPageId,
      assistant_message_ids: [result.assistantMessageId],
      usage: {
        promptTokens: 11,
        completionTokens: 13,
        totalTokens: 24,
      },
      memory_status: null,
      memory_mode: null,
      tool_execution_count: 0,
      session_state_mutation_count: 0,
    });

    expect(variableSet).toMatchObject({
      sequence: 3,
      type: "variable.set",
      pageId,
      causationEventId: committed!.id,
      operationLogId: stateChanged!.operationLogId,
      correlationId: "req-project-events",
    });
    expect(payloadOf(variableSet!)).toMatchObject({
      session_id: session.sessionId,
      branch_id: "main",
      floor_id: floorId,
      page_id: pageId,
      scope: "page",
      scope_id: pageId,
      key: "mood",
      is_new: true,
    });
    expect(payloadOf(variableSet!)).not.toHaveProperty("value");

    expect(variablePromoted).toMatchObject({
      sequence: 4,
      type: "variable.promoted",
      pageId,
      causationEventId: committed!.id,
      operationLogId: stateChanged!.operationLogId,
      correlationId: "req-project-events",
    });
    expect(payloadOf(variablePromoted!)).toMatchObject({
      session_id: session.sessionId,
      branch_id: "main",
      floor_id: floorId,
      page_id: pageId,
      key: "mood",
      from_scope: "page",
      to_scope: "floor",
    });
    expect(payloadOf(variablePromoted!)).not.toHaveProperty("value");

    const operationLogId = stateChanged!.operationLogId;
    expect(operationLogId).toEqual(expect.any(String));
    const operation = database.db
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.id, operationLogId!))
      .get();
    expect(operation).toMatchObject({
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      actorAccountId: ACCOUNT_ID,
      sessionId: session.sessionId,
      branchId: "main",
      floorId,
      runId: "run-project-events",
      requestId: "req-project-events",
      createdAt: committedAt,
    });
  });

  it("rolls back business rows and project events when project event append fails", async () => {
    const now = 1_735_800_100_000;
    const committedAt = now + 100;
    const project = createTestProject(database.db, {
      accountId: ACCOUNT_ID,
      id: "project_archived_for_turn_commit",
      status: "archived",
      now,
    });
    const session = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT_ID,
      id: "sess_turn_project_event_rollback",
      projectId: project.projectId,
      now,
    });
    const floorId = nanoid();
    const pageId = nanoid();
    seedFloor({ database, sessionId: session.sessionId, floorId, now });
    seedInputPage({ database, floorId, pageId, now });

    const hub = new ProjectEventLiveHub();
    const published: ProjectEventRecord[] = [];
    hub.subscribe(project.projectId, (event) => {
      published.push(event);
    });
    const service = createService(database, hub);

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "This should be rolled back.",
      rawText: "This should be rolled back.",
      summaries: [],
      totalUsage: {
        promptTokens: 3,
        completionTokens: 5,
        totalTokens: 8,
      },
    };

    await expect(service.commit({
      accountId: ACCOUNT_ID,
      floorId,
      sessionId: session.sessionId,
      execution,
      committedAt,
      variableCommit: { pageId },
      operationLog: { requestId: "req-rollback" },
    })).rejects.toMatchObject({ code: "project_archived" });

    expect(published).toEqual([]);
    expect(listProjectEvents(database, project.projectId)).toEqual([]);

    const floor = database.db.select().from(floors).where(eq(floors.id, floorId)).get();
    expect(floor).toMatchObject({
      state: "generating",
      tokenIn: 0,
      tokenOut: 0,
      updatedAt: now,
    });

    const assistantMessages = database.db
      .select()
      .from(messages)
      .where(eq(messages.role, "assistant"))
      .all();
    expect(assistantMessages).toEqual([]);

    const scopedOperations = database.db
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.projectId, project.projectId))
      .all();
    expect(scopedOperations).toEqual([]);
  });
});

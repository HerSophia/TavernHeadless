import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import { ProjectEventLiveHub } from "../project-event-live-hub.js";
import { ProjectEventService, type ProjectEventRecord } from "../project-event-service.js";
import {
  ProjectEventStreamService,
  matchesProjectEventStreamFilters,
} from "../project-event-stream-service.js";

const ACCOUNT_ID = "project-event-stream-account";

describe("ProjectEventStreamService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("sends heartbeat comments and removes live subscription on abort", async () => {
    const project = createTestProject(database.db, {
      accountId: ACCOUNT_ID,
      id: "project-event-stream-service-heartbeat",
    });
    const liveHub = new ProjectEventLiveHub();
    const streamService = new ProjectEventStreamService(
      new ProjectEventService(database.db),
      liveHub,
      { heartbeatIntervalMs: 5 },
    );
    const writer = new PassThrough();
    const controller = new AbortController();
    let output = "";

    writer.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
    });

    const streamPromise = streamService.stream({
      projectId: project.projectId,
      after: 0,
      visibilitySet: ["project"],
      writer,
      abortSignal: controller.signal,
    });

    await waitUntil(() => output.includes(": heartbeat"));
    expect(liveHub.listenerCount(project.projectId)).toBe(1);

    controller.abort();
    await streamPromise;
    writer.destroy();

    expect(liveHub.listenerCount(project.projectId)).toBe(0);
  });
});

describe("matchesProjectEventStreamFilters", () => {
  function buildEvent(overrides: Partial<ProjectEventRecord> = {}): ProjectEventRecord {
    return {
      id: "evt_filter",
      workspaceId: "ws_filter",
      projectId: "proj_filter",
      sequence: 1,
      type: "session.created",
      visibility: "project",
      source: "api",
      actorAccountId: null,
      actorClientId: null,
      sessionId: null,
      branchId: null,
      floorId: null,
      pageId: null,
      messageId: null,
      operationLogId: null,
      correlationId: null,
      causationEventId: null,
      payload: {},
      createdAt: 1_700_000_000_000,
      ...overrides,
    };
  }

  it("hides events whose visibility is outside the visibility set", () => {
    const ownerEvent = buildEvent({ visibility: "owner" });
    expect(
      matchesProjectEventStreamFilters(ownerEvent, { visibilitySet: ["project"] }),
    ).toBe(false);
    expect(
      matchesProjectEventStreamFilters(ownerEvent, { visibilitySet: ["project", "owner"] }),
    ).toBe(true);
  });

  it("matches by type when types filter is provided", () => {
    const event = buildEvent({ type: "floor.committed", visibility: "project" });
    expect(
      matchesProjectEventStreamFilters(event, {
        visibilitySet: ["project"],
        types: ["floor.committed"],
      }),
    ).toBe(true);
    expect(
      matchesProjectEventStreamFilters(event, {
        visibilitySet: ["project"],
        types: ["session.created"],
      }),
    ).toBe(false);
  });

  it("matches by sessionId only when sessionId filter is non-empty", () => {
    const event = buildEvent({ sessionId: "sess_match", visibility: "project" });
    expect(
      matchesProjectEventStreamFilters(event, {
        visibilitySet: ["project"],
        sessionId: "sess_match",
      }),
    ).toBe(true);
    expect(
      matchesProjectEventStreamFilters(event, {
        visibilitySet: ["project"],
        sessionId: "sess_other",
      }),
    ).toBe(false);
    expect(
      matchesProjectEventStreamFilters(event, {
        visibilitySet: ["project"],
        sessionId: "   ",
      }),
    ).toBe(true);
  });
});

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("Timed out waiting for condition");
}

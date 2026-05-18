import { describe, expect, it } from "vitest";

import { ProjectEventLiveHub } from "../project-event-live-hub.js";
import type { ProjectEventRecord } from "../project-event-service.js";

function createEvent(projectId: string, sequence: number): ProjectEventRecord {
  return {
    id: `evt-${projectId}-${sequence}`,
    workspaceId: "workspace-1",
    projectId,
    sequence,
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
    createdAt: 1_700_000_000_000 + sequence,
  };
}

describe("ProjectEventLiveHub", () => {
  it("broadcasts events only to listeners of the same project", () => {
    const hub = new ProjectEventLiveHub();
    const projectA: number[] = [];
    const projectB: number[] = [];

    hub.subscribe("project-a", (event) => projectA.push(event.sequence));
    hub.subscribe("project-b", (event) => projectB.push(event.sequence));

    hub.publish(createEvent("project-a", 1));
    hub.publish(createEvent("project-b", 2));

    expect(projectA).toEqual([1]);
    expect(projectB).toEqual([2]);
  });

  it("supports idempotent unsubscribe", () => {
    const hub = new ProjectEventLiveHub();
    const received: number[] = [];
    const unsubscribe = hub.subscribe("project-a", (event) => received.push(event.sequence));

    unsubscribe();
    unsubscribe();
    hub.publish(createEvent("project-a", 1));

    expect(received).toEqual([]);
    expect(hub.listenerCount()).toBe(0);
  });

  it("keeps other listeners active when one listener throws", () => {
    const hub = new ProjectEventLiveHub();
    const received: number[] = [];

    hub.subscribe("project-a", () => {
      throw new Error("listener failed");
    });
    hub.subscribe("project-a", (event) => received.push(event.sequence));

    expect(() => hub.publish(createEvent("project-a", 1))).not.toThrow();
    expect(received).toEqual([1]);
  });
});

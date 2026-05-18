import type { ProjectEventLiveHub } from "./project-event-live-hub.js";
import {
  ProjectEventService,
  type ProjectEventRecord,
  type ProjectEventVisibility,
} from "./project-event-service.js";

export type ProjectEventSseWriter = {
  write(chunk: string): boolean;
  end(): void;
  destroyed?: boolean;
  writableEnded?: boolean;
};

export type ProjectEventStreamFilters = {
  types?: readonly string[];
  sessionId?: string | null;
  visibilitySet: readonly ProjectEventVisibility[];
};

export type ProjectEventStreamInput = ProjectEventStreamFilters & {
  projectId: string;
  after: number;
  writer: ProjectEventSseWriter;
  abortSignal?: AbortSignal;
};

export type ProjectEventStreamServiceOptions = {
  heartbeatIntervalMs?: number;
  historyBatchSize?: number;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_HISTORY_BATCH_SIZE = 500;

/**
 * Streams durable Project events as SSE and bridges committed live events.
 */
export class ProjectEventStreamService {
  private readonly heartbeatIntervalMs: number;
  private readonly historyBatchSize: number;

  constructor(
    private readonly eventService: ProjectEventService,
    private readonly liveHub: ProjectEventLiveHub,
    options: ProjectEventStreamServiceOptions = {},
  ) {
    this.heartbeatIntervalMs = Math.max(1, options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
    this.historyBatchSize = Math.max(1, Math.min(DEFAULT_HISTORY_BATCH_SIZE, options.historyBatchSize ?? DEFAULT_HISTORY_BATCH_SIZE));
  }

  async stream(input: ProjectEventStreamInput): Promise<void> {
    const filters = normalizeStreamFilters(input);
    const pendingLiveEvents: ProjectEventRecord[] = [];
    let closed = isWriterClosed(input.writer);
    let liveMode = false;
    let lastSentSequence = Math.max(0, Math.trunc(input.after));

    const markClosed = () => {
      closed = true;
    };

    const abortPromise = new Promise<void>((resolve) => {
      if (input.abortSignal?.aborted) {
        markClosed();
        resolve();
        return;
      }

      input.abortSignal?.addEventListener("abort", () => {
        markClosed();
        resolve();
      }, { once: true });
    });

    const drainLiveEvents = () => {
      if (closed || pendingLiveEvents.length === 0) {
        return;
      }

      pendingLiveEvents.sort((left, right) => left.sequence - right.sequence);
      const events = pendingLiveEvents.splice(0, pendingLiveEvents.length);
      for (const event of events) {
        if (event.sequence <= lastSentSequence) {
          continue;
        }
        if (!writeProjectEventSse(input.writer, event)) {
          closed = true;
          return;
        }
        lastSentSequence = event.sequence;
      }
    };

    const unsubscribe = this.liveHub.subscribe(input.projectId, (event) => {
      if (!matchesProjectEventStreamFilters(event, filters)) {
        return;
      }
      if (event.sequence <= lastSentSequence) {
        return;
      }

      pendingLiveEvents.push(event);
      if (liveMode) {
        drainLiveEvents();
      }
    });

    const heartbeat = setInterval(() => {
      if (closed || !writeSseComment(input.writer, "heartbeat")) {
        closed = true;
      }
    }, this.heartbeatIntervalMs);
    heartbeat.unref?.();

    try {
      while (!closed) {
        const result = this.eventService.list(input.projectId, {
          after: lastSentSequence,
          limit: this.historyBatchSize,
          types: filters.types,
          sessionId: filters.sessionId,
          visibilitySet: filters.visibilitySet,
        });

        for (const event of result.items) {
          if (event.sequence <= lastSentSequence) {
            continue;
          }
          if (!writeProjectEventSse(input.writer, event)) {
            closed = true;
            break;
          }
          lastSentSequence = event.sequence;
        }

        if (closed || !result.hasMore) {
          break;
        }
      }

      liveMode = true;
      drainLiveEvents();

      if (!closed) {
        await abortPromise;
      }
    } catch (error) {
      if (!closed) {
        writeProjectEventSseError(input.writer, "project_event_stream_error", error instanceof Error ? error.message : "Project event stream failed");
      }
    } finally {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    }
  }
}

export function toProjectEventResponse(event: ProjectEventRecord) {
  return {
    id: event.id,
    workspace_id: event.workspaceId,
    project_id: event.projectId,
    sequence: event.sequence,
    type: event.type,
    visibility: event.visibility,
    source: event.source,
    actor_account_id: event.actorAccountId,
    actor_client_id: event.actorClientId,
    session_id: event.sessionId,
    branch_id: event.branchId,
    floor_id: event.floorId,
    page_id: event.pageId,
    message_id: event.messageId,
    operation_log_id: event.operationLogId,
    correlation_id: event.correlationId,
    causation_event_id: event.causationEventId,
    payload: event.payload,
    created_at: event.createdAt,
  };
}

export function matchesProjectEventStreamFilters(
  event: ProjectEventRecord,
  filters: ProjectEventStreamFilters,
): boolean {
  const normalized = normalizeStreamFilters(filters);
  if (!normalized.visibilitySet.includes(event.visibility)) {
    return false;
  }

  if (normalized.types.length > 0 && !normalized.types.includes(event.type)) {
    return false;
  }

  if (normalized.sessionId && event.sessionId !== normalized.sessionId) {
    return false;
  }

  return true;
}

export function writeProjectEventSse(writer: ProjectEventSseWriter, event: ProjectEventRecord): boolean {
  return writeSseBlock(
    writer,
    `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(toProjectEventResponse(event))}\n\n`,
  );
}

export function writeProjectEventSseError(
  writer: ProjectEventSseWriter,
  code: string,
  message: string,
): boolean {
  return writeSseBlock(
    writer,
    `event: error\ndata: ${JSON.stringify({ code, message })}\n\n`,
  );
}

function writeSseComment(writer: ProjectEventSseWriter, comment: string): boolean {
  return writeSseBlock(writer, `: ${comment}\n\n`);
}

function writeSseBlock(writer: ProjectEventSseWriter, block: string): boolean {
  if (isWriterClosed(writer)) {
    return false;
  }

  try {
    writer.write(block);
    return true;
  } catch {
    return false;
  }
}

function isWriterClosed(writer: ProjectEventSseWriter): boolean {
  return writer.destroyed === true || writer.writableEnded === true;
}

function normalizeStreamFilters(filters: ProjectEventStreamFilters): Required<ProjectEventStreamFilters> {
  return {
    types: Array.from(new Set((filters.types ?? []).map((type) => type.trim()).filter(Boolean))),
    sessionId: typeof filters.sessionId === "string" && filters.sessionId.trim().length > 0
      ? filters.sessionId.trim()
      : null,
    visibilitySet: Array.from(new Set(filters.visibilitySet)),
  };
}

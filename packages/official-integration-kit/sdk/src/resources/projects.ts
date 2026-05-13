import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { TavernApiError } from "../errors/tavern-api-error.js";
import { createResponseError } from "../errors/normalize-error.js";
import {
  buildQueryString,
  compactObject,
  readArray,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readNumber,
  readRecord,
  readString,
} from "./utils.js";

export type ProjectRole = "owner" | "observer";
export type ProjectStatus = "active" | "archived";
export type ProjectKind = "session_default" | "manual";
export type ProjectMemberStatus = "active" | "removed";
export type ProjectEventVisibility = "project" | "owner" | "internal";
export type ProjectEventSource = "api" | "runtime_job" | "migration" | "system";

export type ProjectRecord = {
  id: string;
  workspaceId: string;
  accountId: string;
  name: string;
  description: string | null;
  kind: ProjectKind;
  status: ProjectStatus;
  role: ProjectRole;
  settingsOverride: unknown;
  createdAt: number;
  updatedAt: number;
};

export type ProjectSessionSummary = {
  id: string;
  workspaceId: string | null;
  projectId: string | null;
  title: string | null;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
};

export type ProjectEventRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  sequence: number;
  type: string;
  visibility: ProjectEventVisibility;
  source: ProjectEventSource;
  actorAccountId: string | null;
  sessionId: string | null;
  branchId: string | null;
  floorId: string | null;
  pageId: string | null;
  messageId: string | null;
  operationLogId: string | null;
  correlationId: string | null;
  causationEventId: string | null;
  payload: unknown;
  createdAt: number;
};

export type ProjectMember = {
  id: string;
  workspaceId: string;
  projectId: string;
  accountId: string;
  role: ProjectRole;
  status: ProjectMemberStatus;
  createdByAccountId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ProjectsListOptions = {
  accountId?: AccountIdHint;
  cursor?: string;
  limit?: number;
  role?: ProjectRole;
  status?: ProjectStatus;
};

export type ProjectsListResult = {
  items: ProjectRecord[];
  nextCursor: string | null;
};

export type ProjectsGetOptions = {
  accountId?: AccountIdHint;
  projectId: string;
};

export type ProjectsListSessionsOptions = {
  accountId?: AccountIdHint;
  cursor?: string;
  limit?: number;
  projectId: string;
  status?: "active" | "archived";
};

export type ProjectsListSessionsResult = {
  items: ProjectSessionSummary[];
  nextCursor: string | null;
};

export type ProjectsListEventsOptions = {
  accountId?: AccountIdHint;
  after?: number | string;
  limit?: number;
  projectId: string;
  sessionId?: string;
  types?: string | string[];
};

export type ProjectsListEventsResult = {
  items: ProjectEventRecord[];
  nextAfter: number | null;
  hasMore: boolean;
};

export type ProjectsStreamEventsOptions = {
  accountId?: AccountIdHint;
  after?: number | string;
  lastEventId?: number | string;
  projectId: string;
  sessionId?: string;
  signal?: AbortSignal;
  types?: string | string[];
  onEvent?: (event: ProjectEventRecord) => void;
  onHeartbeat?: () => void;
};

export type ProjectsListMembersOptions = {
  accountId?: AccountIdHint;
  projectId: string;
};

export type ProjectsAddObserverOptions = {
  accountId?: AccountIdHint;
  projectId: string;
  observerAccountId: string;
};

export type ProjectsRemoveMemberOptions = {
  accountId?: AccountIdHint;
  projectId: string;
  memberAccountId: string;
};

export type ProjectsResource = {
  list(options?: ProjectsListOptions): Promise<ProjectsListResult>;
  get(options: ProjectsGetOptions): Promise<ProjectRecord>;
  listSessions(options: ProjectsListSessionsOptions): Promise<ProjectsListSessionsResult>;
  listEvents(options: ProjectsListEventsOptions): Promise<ProjectsListEventsResult>;
  streamEvents(options: ProjectsStreamEventsOptions): Promise<void>;
  listMembers(options: ProjectsListMembersOptions): Promise<ProjectMember[]>;
  addObserver(options: ProjectsAddObserverOptions): Promise<ProjectMember>;
  removeMember(options: ProjectsRemoveMemberOptions): Promise<ProjectMember>;
};

export function createProjectsResource(client: TransportClient): ProjectsResource {
  return {
    async list(options: ProjectsListOptions = {}): Promise<ProjectsListResult> {
      const query = buildQueryString(
        compactObject({
          role: options.role,
          status: options.status,
          limit: options.limit,
          cursor: options.cursor,
        }),
      );
      const pathname = query ? `/projects?${query}` : "/projects";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });
      const body = readRecord(response.body);
      return {
        items: readArray(body?.items)
          .map(mapProjectRecord)
          .filter((item): item is ProjectRecord => item !== null),
        nextCursor: readNullableString(body?.next_cursor),
      };
    },
    async get(options): Promise<ProjectRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/projects/${encodeURIComponent(options.projectId)}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );
      const record = mapProjectRecord(response.body);
      if (!record) {
        throw new Error("Project payload is missing");
      }
      return record;
    },
    async listSessions(options): Promise<ProjectsListSessionsResult> {
      const query = buildQueryString(
        compactObject({
          status: options.status,
          limit: options.limit,
          cursor: options.cursor,
        }),
      );
      const pathname = query
        ? `/projects/${encodeURIComponent(options.projectId)}/sessions?${query}`
        : `/projects/${encodeURIComponent(options.projectId)}/sessions`;
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });
      const body = readRecord(response.body);
      return {
        items: readArray(body?.items)
          .map(mapProjectSessionSummary)
          .filter((item): item is ProjectSessionSummary => item !== null),
        nextCursor: readNullableString(body?.next_cursor),
      };
    },
    async listEvents(options): Promise<ProjectsListEventsResult> {
      const query = buildEventQuery(options);
      const pathname = query
        ? `/projects/${encodeURIComponent(options.projectId)}/events?${query}`
        : `/projects/${encodeURIComponent(options.projectId)}/events`;
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });
      const body = readRecord(response.body);
      return {
        items: readArray(body?.items)
          .map(mapProjectEventRecord)
          .filter((item): item is ProjectEventRecord => item !== null),
        nextAfter: readNullableNumber(body?.next_after),
        hasMore: readBoolean(body?.has_more, false),
      };
    },
    async streamEvents(options): Promise<void> {
      const query = buildEventQuery(options, { skipLimit: true });
      const pathname = query
        ? `/projects/${encodeURIComponent(options.projectId)}/events/stream?${query}`
        : `/projects/${encodeURIComponent(options.projectId)}/events/stream`;
      const response = await client.fetchRaw(pathname, {
        accept: "text/event-stream",
        headers: buildEventStreamHeaders(options),
        method: "GET",
        signal: options.signal,
      });

      if (!response.ok) {
        throw await createResponseError(response);
      }

      if (!response.body) {
        throw new TavernApiError({
          message: "Project event stream is not available in this runtime",
          status: response.status,
        });
      }

      await consumeProjectEventStream(response.body, options);
    },
    async listMembers(options): Promise<ProjectMember[]> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/projects/${encodeURIComponent(options.projectId)}/members`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );
      const body = readRecord(response.body);
      return readArray(body?.items)
        .map(mapProjectMember)
        .filter((item): item is ProjectMember => item !== null);
    },
    async addObserver(options): Promise<ProjectMember> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/projects/${encodeURIComponent(options.projectId)}/members`,
        {
          body: {
            account_id: options.observerAccountId,
            role: "observer",
          },
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      const member = mapProjectMember(readRecord(response.body)?.item);
      if (!member) {
        throw new Error("Project member payload is missing");
      }
      return member;
    },
    async removeMember(options): Promise<ProjectMember> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/projects/${encodeURIComponent(options.projectId)}/members/${encodeURIComponent(options.memberAccountId)}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "DELETE",
        },
      );
      const member = mapProjectMember(readRecord(response.body)?.item);
      if (!member) {
        throw new Error("Project member payload is missing");
      }
      return member;
    },
  };
}

function buildEventQuery(
  options: {
    after?: number | string;
    limit?: number;
    sessionId?: string;
    types?: string | string[];
  },
  options2: { skipLimit?: boolean } = {},
): string {
  const typesValue = Array.isArray(options.types)
    ? options.types.filter((entry) => entry.length > 0).join(",")
    : options.types;
  return buildQueryString(
    compactObject({
      after: options.after,
      types: typesValue && typesValue.length > 0 ? typesValue : undefined,
      session_id: options.sessionId,
      ...(options2.skipLimit ? {} : { limit: options.limit }),
    }),
  );
}

function buildEventStreamHeaders(options: ProjectsStreamEventsOptions): Record<string, string> | undefined {
  const headers = buildAccountHeaders(options.accountId) ?? {};
  if (options.after === undefined && options.lastEventId !== undefined) {
    headers["Last-Event-ID"] = String(options.lastEventId);
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

async function consumeProjectEventStream(
  body: ReadableStream<Uint8Array>,
  options: ProjectsStreamEventsOptions,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];

  const flushEvent = (): void => {
    if (dataLines.length === 0) {
      eventName = "message";
      return;
    }

    const rawEvent = dataLines.join("\n");
    dataLines = [];

    if (eventName === "error") {
      eventName = "message";
      const payload = parseJson(rawEvent);
      throw new TavernApiError({
        code: typeof payload?.code === "string" ? payload.code : undefined,
        message: typeof payload?.message === "string" ? payload.message : "Project event stream failed",
        status: 200,
      });
    }

    eventName = "message";
    const parsed = parseJson(rawEvent);
    const record = mapProjectEventRecord(parsed);
    if (record) {
      options.onEvent?.(record);
    }
  };

  const handleComment = (line: string): void => {
    if (line.slice(1).trim() === "heartbeat") {
      options.onHeartbeat?.();
    }
    eventName = "message";
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const lineBreakIndex = buffer.indexOf("\n");
        if (lineBreakIndex < 0) {
          break;
        }

        const rawLine = buffer.slice(0, lineBreakIndex);
        buffer = buffer.slice(lineBreakIndex + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

        if (line.length === 0) {
          flushEvent();
          continue;
        }

        if (line.startsWith(":")) {
          handleComment(line);
          continue;
        }

        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }
    }
  } finally {
    flushEvent();
    try {
      reader.releaseLock();
    } catch {
      // ignore releaseLock errors
    }
  }
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function mapProjectRecord(value: unknown): ProjectRecord | null {
  const record = readRecord(value);
  if (!record) return null;
  const role = readString(record.role) as ProjectRole;
  const kind = readString(record.kind) as ProjectKind;
  const status = readString(record.status) as ProjectStatus;
  if (role !== "owner" && role !== "observer") return null;
  if (kind !== "session_default" && kind !== "manual") return null;
  if (status !== "active" && status !== "archived") return null;
  return {
    id: readString(record.id),
    workspaceId: readString(record.workspace_id),
    accountId: readString(record.account_id),
    name: readString(record.name),
    description: readNullableString(record.description),
    kind,
    status,
    role,
    settingsOverride: record.settings_override ?? null,
    createdAt: readNumber(record.created_at),
    updatedAt: readNumber(record.updated_at),
  };
}

function mapProjectSessionSummary(value: unknown): ProjectSessionSummary | null {
  const record = readRecord(value);
  if (!record) return null;
  const status = readString(record.status) as "active" | "archived";
  if (status !== "active" && status !== "archived") return null;
  return {
    id: readString(record.id),
    workspaceId: readNullableString(record.workspace_id),
    projectId: readNullableString(record.project_id),
    title: readNullableString(record.title),
    status,
    createdAt: readNumber(record.created_at),
    updatedAt: readNumber(record.updated_at),
  };
}

function mapProjectEventRecord(value: unknown): ProjectEventRecord | null {
  const record = readRecord(value);
  if (!record) return null;
  const visibility = readString(record.visibility) as ProjectEventVisibility;
  if (visibility !== "project" && visibility !== "owner" && visibility !== "internal") return null;
  const source = readString(record.source) as ProjectEventSource;
  if (source !== "api" && source !== "runtime_job" && source !== "migration" && source !== "system") return null;
  return {
    id: readString(record.id),
    workspaceId: readString(record.workspace_id),
    projectId: readString(record.project_id),
    sequence: readNumber(record.sequence),
    type: readString(record.type),
    visibility,
    source,
    actorAccountId: readNullableString(record.actor_account_id),
    sessionId: readNullableString(record.session_id),
    branchId: readNullableString(record.branch_id),
    floorId: readNullableString(record.floor_id),
    pageId: readNullableString(record.page_id),
    messageId: readNullableString(record.message_id),
    operationLogId: readNullableString(record.operation_log_id),
    correlationId: readNullableString(record.correlation_id),
    causationEventId: readNullableString(record.causation_event_id),
    payload: record.payload ?? null,
    createdAt: readNumber(record.created_at),
  };
}

function mapProjectMember(value: unknown): ProjectMember | null {
  const record = readRecord(value);
  if (!record) return null;
  const role = readString(record.role) as ProjectRole;
  if (role !== "owner" && role !== "observer") return null;
  const status = readString(record.status) as ProjectMemberStatus;
  if (status !== "active" && status !== "removed") return null;
  return {
    id: readString(record.id),
    workspaceId: readString(record.workspace_id),
    projectId: readString(record.project_id),
    accountId: readString(record.account_id),
    role,
    status,
    createdByAccountId: readNullableString(record.created_by_account_id),
    createdAt: readNumber(record.created_at),
    updatedAt: readNumber(record.updated_at),
  };
}

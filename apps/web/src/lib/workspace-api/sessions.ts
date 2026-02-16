import { apiClient } from "../api";
import { toWorkspaceSession } from "./mappers";
import { buildAccountHeaders } from "./transport";
import type {
  SessionResponse,
  WorkspaceSession
} from "./types";

export async function fetchHealthStatus(): Promise<string> {
  const response = await apiClient.get("/health");
  if (response.status !== 200 || !response.body || typeof response.body !== "object") {
    return "offline";
  }

  const body = response.body as { database?: string; service?: string };
  const service = body.service ?? "api";
  const database = body.database ?? "unknown-db";
  return `${service} (${database})`;
}

export async function fetchSessions(accountId?: string): Promise<WorkspaceSession[]> {
  const response = await apiClient.get("/sessions", {
    headers: buildAccountHeaders(accountId),
    query: {
      limit: 50,
      offset: 0,
      sort_by: "updated_at",
      sort_order: "desc"
    }
  });

  if (response.status !== 200 || !response.body || typeof response.body !== "object") {
    return [];
  }

  const payload = response.body as { data?: SessionResponse[] };
  return (payload.data ?? []).map((session) => toWorkspaceSession(session, accountId));
}

export async function createSession(title?: string, accountId?: string): Promise<WorkspaceSession | null> {
  const response = await apiClient.post("/sessions", {
    body: {
      title
    },
    headers: buildAccountHeaders(accountId)
  });

  if (response.status !== 201 || !response.body || typeof response.body !== "object") {
    return null;
  }

  const payload = response.body as { data?: SessionResponse };
  const session = payload.data;
  if (!session) {
    return null;
  }

  return toWorkspaceSession(session, accountId);
}

export async function renameSession(sessionId: string, title: string, accountId?: string): Promise<boolean> {
  const response = await apiClient.patch("/sessions/{id}", {
    body: {
      title
    },
    headers: buildAccountHeaders(accountId),
    path: {
      id: sessionId
    }
  });

  return response.status === 200;
}

export async function archiveSession(sessionId: string, accountId?: string): Promise<boolean> {
  const response = await apiClient.patch("/sessions/{id}", {
    body: {
      status: "archived"
    },
    headers: buildAccountHeaders(accountId),
    path: {
      id: sessionId
    }
  });

  return response.status === 200;
}

export async function removeSession(sessionId: string, accountId?: string): Promise<boolean> {
  const response = await apiClient.delete("/sessions/{id}", {
    headers: buildAccountHeaders(accountId),
    path: {
      id: sessionId
    }
  });

  return response.status === 200;
}

import { apiClient } from "../api";
import { toWorkspaceSession } from "./mappers";
import type { WorkspaceSession } from "./types";

export async function fetchHealthStatus(): Promise<string> {
  const response = await apiClient.health.get();
  const service = response.service ?? "api";
  const database = response.database ?? "unknown-db";
  return `${service} (${database})`;
}

export async function fetchSessions(accountId?: string): Promise<WorkspaceSession[]> {
  const sessions = await apiClient.sessions.list({
    accountId,
    limit: 50,
    offset: 0,
    sortBy: "updated_at",
    sortOrder: "desc"
  });

  return sessions.map((session) => toWorkspaceSession(session, accountId));
}

export async function createSession(title?: string, accountId?: string): Promise<WorkspaceSession | null> {
  const session = await apiClient.sessions.create({
    accountId,
    title
  });

  return session ? toWorkspaceSession(session, accountId) : null;
}

export async function renameSession(sessionId: string, title: string, accountId?: string): Promise<boolean> {
  await apiClient.sessions.update({
    accountId,
    sessionId,
    title
  });

  return true;
}

export async function archiveSession(sessionId: string, accountId?: string): Promise<boolean> {
  await apiClient.sessions.update({
    accountId,
    sessionId,
    status: "archived"
  });

  return true;
}

export async function removeSession(sessionId: string, accountId?: string): Promise<boolean> {
  return apiClient.sessions.remove({
    accountId,
    sessionId
  });
}

import type {
  SessionRuntimeToolCatalog,
  SessionToolPermissions,
  ToolDefinitionRecord,
  ToolDefinitionSource,
  ToolDefinitionsListResult,
  ToolExecutionCommitOutcome,
  ToolExecutionLifecycleState,
  ToolExecutionProviderType,
  ToolExecutionRecord,
  ToolExecutionsListResult,
  ToolExecutionsListOptions,
  ToolExecutionStatus,
  ToolHandlerType,
  ToolSideEffectLevel
} from "@tavern/sdk";

import { apiClient } from "../api";

export type WorkspaceSessionToolPermissions = SessionToolPermissions;
export type WorkspaceRuntimeToolCatalog = SessionRuntimeToolCatalog;
export type WorkspaceToolDefinition = ToolDefinitionRecord;
export type WorkspaceToolDefinitionsListResult = ToolDefinitionsListResult;
export type WorkspaceToolExecutionStatus = ToolExecutionStatus;
export type WorkspaceToolExecutionCommitOutcome = ToolExecutionCommitOutcome;
export type WorkspaceToolExecutionLifecycleState = ToolExecutionLifecycleState;
export type WorkspaceToolExecutionProviderType = ToolExecutionProviderType;
export type WorkspaceToolExecutionRecord = ToolExecutionRecord;
export type WorkspaceToolExecutionsListResult = ToolExecutionsListResult;
export type WorkspaceToolSideEffectLevel = ToolSideEffectLevel;
export type WorkspaceToolDefinitionSource = ToolDefinitionSource;
export type WorkspaceToolHandlerType = ToolHandlerType;

export async function fetchSessionToolPermissions(sessionId: string, accountId?: string): Promise<WorkspaceSessionToolPermissions> {
  return apiClient.sessions.getToolPermissions({
    accountId,
    sessionId
  });
}

export async function patchSessionToolPermissions(
  sessionId: string,
  permissions: WorkspaceSessionToolPermissions,
  accountId?: string
): Promise<WorkspaceSessionToolPermissions> {
  return apiClient.sessions.patchToolPermissions({
    accountId,
    permissions,
    sessionId
  });
}

export async function putSessionToolPermissions(
  sessionId: string,
  permissions: WorkspaceSessionToolPermissions,
  accountId?: string
): Promise<WorkspaceSessionToolPermissions> {
  return apiClient.sessions.putToolPermissions({
    accountId,
    permissions,
    sessionId
  });
}

export async function fetchSessionRuntimeToolCatalog(
  sessionId: string,
  accountId?: string
): Promise<WorkspaceRuntimeToolCatalog> {
  return apiClient.sessions.getRuntimeToolCatalog({
    accountId,
    sessionId
  });
}

export async function fetchToolDefinitions(options: {
  accountId?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: "updated_at" | "name";
  sortOrder?: "asc" | "desc";
  source?: WorkspaceToolDefinitionSource;
  sourceId?: string;
} = {}): Promise<WorkspaceToolDefinitionsListResult> {
  return apiClient.tools.listDefinitions(options);
}

export async function fetchToolDefinition(definitionId: string, accountId?: string): Promise<WorkspaceToolDefinition> {
  return apiClient.tools.getDefinition({
    accountId,
    definitionId
  });
}

export async function createToolDefinition(options: {
  accountId?: string;
  allowedSlots?: string[];
  description?: string;
  enabled?: boolean;
  handler?: Record<string, unknown>;
  handlerType?: WorkspaceToolHandlerType;
  name: string;
  parameters?: Record<string, unknown>;
  sideEffectLevel?: WorkspaceToolSideEffectLevel;
  source?: WorkspaceToolDefinitionSource;
  sourceId?: string | null;
}): Promise<WorkspaceToolDefinition> {
  return apiClient.tools.createDefinition(options);
}

export async function updateToolDefinition(options: {
  accountId?: string;
  allowedSlots?: string[];
  definitionId: string;
  description?: string;
  handler?: Record<string, unknown>;
  handlerType?: WorkspaceToolHandlerType;
  name?: string;
  parameters?: Record<string, unknown>;
  sideEffectLevel?: WorkspaceToolSideEffectLevel;
  source?: WorkspaceToolDefinitionSource;
  sourceId?: string | null;
}): Promise<WorkspaceToolDefinition> {
  return apiClient.tools.updateDefinition(options);
}

export async function toggleToolDefinition(
  definitionId: string,
  enabled: boolean,
  accountId?: string
): Promise<WorkspaceToolDefinition> {
  return apiClient.tools.toggleDefinition({
    accountId,
    definitionId,
    enabled
  });
}

export async function deleteToolDefinition(definitionId: string, accountId?: string): Promise<boolean> {
  return apiClient.tools.removeDefinition({
    accountId,
    definitionId
  });
}

export async function fetchToolExecutions(options: ToolExecutionsListOptions): Promise<WorkspaceToolExecutionsListResult> {
  return apiClient.tools.listExecutions(options);
}

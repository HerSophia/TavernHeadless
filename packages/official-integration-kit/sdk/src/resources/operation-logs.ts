import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { buildQueryString, compactObject, readArray, readNullableString, readNumber, readRecord, readString } from "./utils.js";

export type OperationLogStatus = "succeeded" | "failed" | "denied" | "cancelled";

export type OperationLogRecord = {
  accountId: string;
  action: string;
  actorId: string | null;
  actorType: string;
  actorAccountId: string | null;
  actorClientId: string | null;
  permissionAction: string | null;
  result: "allowed" | "denied" | null;
  reason: string | null;
  afterRef: unknown | null;
  beforeRef: unknown | null;
  branchId: string | null;
  createdAt: number;
  diff: unknown | null;
  floorId: string | null;
  id: string;
  metadata: unknown | null;
  operationGroupId: string | null;
  projectId: string | null;
  requestId: string | null;
  runId: string | null;
  sessionId: string | null;
  sourceType: string;
  status: OperationLogStatus;
  targetId: string | null;
  targetType: string;
  workspaceId: string | null;
};

export type OperationLogsListMeta = {
  hasMore: boolean;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  total: number;
};

export type OperationLogsListResult = {
  logs: OperationLogRecord[];
  meta: OperationLogsListMeta;
};

export type OperationLogsListOptions = {
  accountId?: AccountIdHint;
  action?: string;
  actorType?: string;
  actorAccountId?: string;
  actorClientId?: string;
  permissionAction?: string;
  result?: "allowed" | "denied";
  floorId?: string;
  limit?: number;
  offset?: number;
  operationGroupId?: string;
  projectId?: string;
  requestId?: string;
  runId?: string;
  sessionId?: string;
  sortOrder?: "asc" | "desc";
  status?: OperationLogStatus;
  targetId?: string;
  targetType?: string;
  workspaceId?: string;
};

export type OperationLogsScopedListOptions = Omit<OperationLogsListOptions, "sessionId" | "floorId">;

export type OperationLogsResource = {
  list(options?: OperationLogsListOptions): Promise<OperationLogsListResult>;
  listForFloor(options: OperationLogsScopedListOptions & { floorId: string }): Promise<OperationLogsListResult>;
  listForSession(options: OperationLogsScopedListOptions & { sessionId: string }): Promise<OperationLogsListResult>;
};

export function createOperationLogsResource(client: TransportClient): OperationLogsResource {
  return {
    async list(options: OperationLogsListOptions = {}): Promise<OperationLogsListResult> {
      return fetchOperationLogs(client, "/operation-logs", options);
    },
    async listForFloor(options): Promise<OperationLogsListResult> {
      const { floorId, ...queryOptions } = options;
      return fetchOperationLogs(
        client,
        `/floors/${encodeURIComponent(floorId)}/operation-logs`,
        queryOptions,
      );
    },
    async listForSession(options): Promise<OperationLogsListResult> {
      const { sessionId, ...queryOptions } = options;
      return fetchOperationLogs(
        client,
        `/sessions/${encodeURIComponent(sessionId)}/operation-logs`,
        queryOptions,
      );
    },
  };
}

async function fetchOperationLogs(
  client: TransportClient,
  pathname: string,
  options: OperationLogsListOptions,
): Promise<OperationLogsListResult> {
  const query = buildQueryString(
    compactObject({
      workspace_id: options.workspaceId,
      project_id: options.projectId,
      actor_account_id: options.actorAccountId,
      actor_client_id: options.actorClientId,
      permission_action: options.permissionAction,
      result: options.result,
      session_id: options.sessionId,
      floor_id: options.floorId,
      run_id: options.runId,
      target_type: options.targetType,
      target_id: options.targetId,
      action: options.action,
      actor_type: options.actorType,
      status: options.status,
      operation_group_id: options.operationGroupId,
      request_id: options.requestId,
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
      sort_order: options.sortOrder ?? "desc",
    }),
  );
  const response = await client.fetchJson<Record<string, unknown>>(query ? `${pathname}?${query}` : pathname, {
    headers: buildAccountHeaders(options.accountId),
    method: "GET",
  });
  const body = readRecord(response.body);

  return {
    logs: readArray(body?.data).map(mapOperationLog).filter((item): item is OperationLogRecord => item !== null),
    meta: mapOperationLogsMeta(body?.meta),
  };
}

function mapOperationLog(value: unknown): OperationLogRecord | null {
  const record = readRecord(value);
  if (!record) return null;

  return {
    accountId: readString(record.account_id),
    action: readString(record.action),
    actorId: readNullableString(record.actor_id),
    actorType: readString(record.actor_type),
    actorAccountId: readNullableString(record.actor_account_id),
    actorClientId: readNullableString(record.actor_client_id),
    permissionAction: readNullableString(record.permission_action),
    result: (readNullableString(record.result) as "allowed" | "denied" | null) ?? null,
    reason: readNullableString(record.reason),
    afterRef: record.after_ref ?? null,
    beforeRef: record.before_ref ?? null,
    branchId: readNullableString(record.branch_id),
    createdAt: readNumber(record.created_at),
    diff: record.diff ?? null,
    floorId: readNullableString(record.floor_id),
    id: readString(record.id),
    metadata: record.metadata ?? null,
    operationGroupId: readNullableString(record.operation_group_id),
    projectId: readNullableString(record.project_id),
    requestId: readNullableString(record.request_id),
    runId: readNullableString(record.run_id),
    sessionId: readNullableString(record.session_id),
    sourceType: readString(record.source_type),
    status: readString(record.status, "succeeded") as OperationLogStatus,
    targetId: readNullableString(record.target_id),
    targetType: readString(record.target_type),
    workspaceId: readNullableString(record.workspace_id),
  };
}

function mapOperationLogsMeta(value: unknown): OperationLogsListMeta {
  const record = readRecord(value);
  return {
    hasMore: record?.has_more === true,
    limit: readNumber(record?.limit, 50),
    offset: readNumber(record?.offset, 0),
    sortBy: readString(record?.sort_by, "created_at"),
    sortOrder: readString(record?.sort_order, "desc") as "asc" | "desc",
    total: readNumber(record?.total, 0),
  };
}

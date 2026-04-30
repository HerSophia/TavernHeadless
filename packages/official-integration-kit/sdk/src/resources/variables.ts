import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import {
  buildQueryString,
  readArray,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readNumber,
  readOptionalString,
  readRecord,
  readString,
} from "./utils.js";

export type VariableScope = "global" | "chat" | "floor" | "branch" | "page";

export type BranchVariableScopeRef = {
  sessionId: string;
  branchId: string;
};

const VARIABLE_SCOPES: VariableScope[] = ["global", "chat", "floor", "branch", "page"];

export type VariableRecord = {
  id: string;
  key: string;
  scope: VariableScope;
  scopeId: string;
  scopeRef?: BranchVariableScopeRef;
  updatedAt: number;
  value: unknown;
};

export type ResolvedVariableRecord = {
  key: string;
  sourceScope: VariableScope;
  sourceScopeId: string;
  sourceScopeRef?: BranchVariableScopeRef;
  updatedAt: number;
  value: unknown;
};

export type VariableLayerSnapshot = {
  items: VariableRecord[];
  scope: VariableScope;
  scopeId: string;
  scopeRef?: BranchVariableScopeRef;
};

export type ResolvedVariablesSnapshot = {
  context: {
    accountId: string;
    branchId?: string;
    floorId?: string;
    globalScopeId: string;
    pageId?: string;
    sessionId: string;
  };
  layers?: Partial<Record<VariableScope, VariableLayerSnapshot>>;
  resolved: ResolvedVariableRecord[];
};

export type PageStagedVariableWriteRecord = {
  id: string;
  key: string;
  op: "set" | "delete";
  value: unknown | null;
  intent: "page_only" | "promote_to_floor_on_accept";
  conflictPolicy: "replace" | "if_absent";
  reason: string;
  source: Record<string, unknown>;
  evidence: Record<string, unknown>;
  status:
    | "staged"
    | "accepted_page_only"
    | "promoted"
    | "rejected"
    | "discarded"
    | "rerouted_to_session_state";
  decisionReason: string | null;
  createdAt: number;
  resolvedAt: number | null;
};

export type PageStagedVariableWriteSnapshot = {
  pageId: string;
  floorId: string;
  sessionId: string;
  branchId: string;
  items: PageStagedVariableWriteRecord[];
};

export type VariablePromotionTraceRecord = {
  id: string;
  stagedWriteId: string | null;
  key: string;
  fromScope: "page" | "floor" | "branch" | "chat";
  fromScopeId: string;
  toScope: "floor" | "branch" | "chat" | "global";
  toScopeId: string;
  conflictPolicy: "replace" | "if_absent";
  sourceVariableId: string | null;
  targetVariableId: string | null;
  value: unknown;
  createdAt: number;
};

export type PageVariablePromotionTraceSnapshot = {
  pageId: string;
  floorId: string;
  sessionId: string;
  branchId: string;
  items: VariablePromotionTraceRecord[];
};

export type VariablesUpsertManyResult = {
  meta: {
    created: number;
    total: number;
    updated: number;
  };
  results: Array<{
    action: "created" | "updated" | string;
    data: VariableRecord;
    index: number;
  }>;
};

export type VariablesResource = {
  getDetail(options: { accountId?: AccountIdHint; variableId: string }): Promise<VariableRecord>;
  getPagePromotions(options: { accountId?: AccountIdHint; pageId: string }): Promise<PageVariablePromotionTraceSnapshot>;
  getPageStagedWrites(options: { accountId?: AccountIdHint; pageId: string }): Promise<PageStagedVariableWriteSnapshot>;
  list(options?: {
    accountId?: AccountIdHint;
    key?: string;
    limit?: number;
    offset?: number;
    scope?: VariableScope;
    scopeId?: string;
    sessionId?: string;
    branchId?: string;
    sortBy?: "key" | "updated_at";
    sortOrder?: "asc" | "desc";
  }): Promise<VariableRecord[]>;
  resolveContext(options: {
    accountId?: AccountIdHint;
    branchId?: string;
    floorId?: string;
    includeLayers?: boolean;
    pageId?: string;
    sessionId: string;
  }): Promise<ResolvedVariablesSnapshot>;
  remove(options: { accountId?: AccountIdHint; variableId: string }): Promise<boolean>;
  /**
   * `branch` 变量要求目标分支已经被注册为 first-class branch host。
   * 只要 branch registry 已存在，就允许对空 branch 直接做 durable 写入。
   */
  upsert(options: {
    accountId?: AccountIdHint;
    key: string;
    scope: VariableScope;
    scopeId?: string;
    branchId?: string;
    sessionId?: string;
    value: unknown;
  }): Promise<VariableRecord>;
  /**
   * `branch` 变量要求目标分支已经被注册为 first-class branch host。
   * 只要 branch registry 已存在，就允许对空 branch 直接做 durable 写入。
   */
  upsertMany(options: {
    accountId?: AccountIdHint;
    items: Array<{
      key: string;
      scope: VariableScope;
      scopeId?: string;
      sessionId?: string;
      branchId?: string;
      value: unknown;
    }>;
  }): Promise<VariablesUpsertManyResult>;
};

export function createVariablesResource(client: TransportClient): VariablesResource {
  return {
    async getDetail(options): Promise<VariableRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(`/variables/${encodeURIComponent(options.variableId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapVariableRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Variable detail returned an invalid payload");
      }

      return payload;
    },
    async getPageStagedWrites(options): Promise<PageStagedVariableWriteSnapshot> {
      const response = await client.fetchJson<Record<string, unknown>>(`/pages/${encodeURIComponent(options.pageId)}/variables/staged`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapPageStagedVariableWriteSnapshot(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Page staged variable writes returned an invalid payload");
      }

      return payload;
    },
    async getPagePromotions(options): Promise<PageVariablePromotionTraceSnapshot> {
      const response = await client.fetchJson<Record<string, unknown>>(`/pages/${encodeURIComponent(options.pageId)}/variables/promotions`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapPageVariablePromotionTraceSnapshot(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Page variable promotions returned an invalid payload");
      }

      return payload;
    },
    async list(options = {}): Promise<VariableRecord[]> {
      const query = buildQueryString({
        key: options.key,
        limit: options.limit,
        offset: options.offset,
        scope: options.scope,
        scope_id: options.scopeId,
        session_id: options.sessionId,
        branch_id: options.branchId,
        sort_by: options.sortBy,
        sort_order: options.sortOrder,
      });
      const pathname = query ? `/variables?${query}` : "/variables";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapVariableRecord)
        .filter((item): item is VariableRecord => item !== null);
    },
    async resolveContext(options): Promise<ResolvedVariablesSnapshot> {
      const query = buildQueryString({
        branch_id: options.branchId,
        floor_id: options.floorId,
        include_layers: options.includeLayers ?? false,
        page_id: options.pageId,
        session_id: options.sessionId,
      });
      const pathname = query ? `/variables/resolve?${query}` : "/variables/resolve";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapResolvedVariablesSnapshot(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Resolved variables snapshot returned an invalid payload");
      }

      return payload;
    },
    async remove(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/variables/${encodeURIComponent(options.variableId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
    async upsert(options): Promise<VariableRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/variables", {
        body: buildVariableWriteBody(options),
        headers: buildAccountHeaders(options.accountId),
        method: "PUT",
      });

      const payload = mapVariableRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Variable upsert returned an invalid payload");
      }

      return payload;
    },
    async upsertMany(options): Promise<VariablesUpsertManyResult> {
      const response = await client.fetchJson<Record<string, unknown>>("/variables/batch", {
        body: {
          items: options.items.map((item) => buildVariableWriteBody(item)),
        },
        headers: buildAccountHeaders(options.accountId),
        method: "PUT",
      });

      return mapUpsertManyResult(response.body);
    },
  };
}

function buildVariableWriteBody(input: {
  key: string;
  scope: VariableScope;
  scopeId?: string;
  sessionId?: string;
  branchId?: string;
  value: unknown;
}) {
  return {
    key: input.key,
    scope: input.scope,
    ...(input.scopeId !== undefined ? { scope_id: input.scopeId } : {}),
    ...(input.sessionId !== undefined ? { session_id: input.sessionId } : {}),
    ...(input.branchId !== undefined ? { branch_id: input.branchId } : {}),
    value: input.value,
  };
}

function mapVariableRecord(value: unknown): VariableRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const scope = readString(record.scope, "global") as VariableScope;
  const scopeRef = mapBranchScopeRef(record.scope_ref);

  return {
    id: readString(record.id),
    key: readString(record.key),
    scope,
    scopeId: readString(record.scope_id),
    ...(scopeRef ? { scopeRef } : {}),
    updatedAt: readNumber(record.updated_at),
    value: record.value,
  };
}

function mapPageStagedVariableWriteSnapshot(value: unknown): PageStagedVariableWriteSnapshot | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const pageId = readOptionalString(record.page_id);
  const floorId = readOptionalString(record.floor_id);
  const sessionId = readOptionalString(record.session_id);
  const branchId = readOptionalString(record.branch_id);
  if (!pageId || !floorId || !sessionId || !branchId) {
    return null;
  }

  return {
    pageId,
    floorId,
    sessionId,
    branchId,
    items: readArray(record.items)
      .map(mapPageStagedVariableWriteRecord)
      .filter((item): item is PageStagedVariableWriteRecord => item !== null),
  };
}

function mapPageStagedVariableWriteRecord(value: unknown): PageStagedVariableWriteRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    id: readString(record.id),
    key: readString(record.key),
    op: readString(record.op, "set") as PageStagedVariableWriteRecord["op"],
    value: Object.prototype.hasOwnProperty.call(record, "value") ? record.value : null,
    intent: readString(record.intent, "promote_to_floor_on_accept") as PageStagedVariableWriteRecord["intent"],
    conflictPolicy: readString(record.conflict_policy, "replace") as PageStagedVariableWriteRecord["conflictPolicy"],
    reason: readString(record.reason),
    source: readRecord(record.source) ?? {},
    evidence: readRecord(record.evidence) ?? {},
    status: readString(record.status, "staged") as PageStagedVariableWriteRecord["status"],
    decisionReason: readNullableString(record.decision_reason),
    createdAt: readNumber(record.created_at),
    resolvedAt: readNullableNumber(record.resolved_at),
  };
}

function mapPageVariablePromotionTraceSnapshot(value: unknown): PageVariablePromotionTraceSnapshot | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const pageId = readOptionalString(record.page_id);
  const floorId = readOptionalString(record.floor_id);
  const sessionId = readOptionalString(record.session_id);
  const branchId = readOptionalString(record.branch_id);
  if (!pageId || !floorId || !sessionId || !branchId) {
    return null;
  }

  return {
    pageId,
    floorId,
    sessionId,
    branchId,
    items: readArray(record.items)
      .map(mapVariablePromotionTraceRecord)
      .filter((item): item is VariablePromotionTraceRecord => item !== null),
  };
}

function mapVariablePromotionTraceRecord(value: unknown): VariablePromotionTraceRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    id: readString(record.id),
    stagedWriteId: readNullableString(record.staged_write_id),
    key: readString(record.key),
    fromScope: readString(record.from_scope, "page") as VariablePromotionTraceRecord["fromScope"],
    fromScopeId: readString(record.from_scope_id),
    toScope: readString(record.to_scope, "floor") as VariablePromotionTraceRecord["toScope"],
    toScopeId: readString(record.to_scope_id),
    conflictPolicy: readString(record.conflict_policy, "replace") as VariablePromotionTraceRecord["conflictPolicy"],
    sourceVariableId: readNullableString(record.source_variable_id),
    targetVariableId: readNullableString(record.target_variable_id),
    value: record.value,
    createdAt: readNumber(record.created_at),
  };
}

function mapResolvedVariablesSnapshot(value: unknown): ResolvedVariablesSnapshot | null {
  const record = readRecord(value);
  const context = readRecord(record?.context);
  const sessionId = readString(context?.session_id);

  if (!record || !context || !sessionId) {
    return null;
  }

  const layers = mapVariableLayers(record.layers);

  return {
    context: {
      accountId: readString(context.account_id),
      branchId: readOptionalString(context.branch_id),
      floorId: readOptionalString(context.floor_id),
      globalScopeId: readString(context.global_scope_id, "global"),
      pageId: readOptionalString(context.page_id),
      sessionId,
    },
    ...(layers ? { layers } : {}),
    resolved: readArray(record.resolved)
      .map(mapResolvedVariableRecord)
      .filter((item): item is ResolvedVariableRecord => item !== null),
  };
}

function mapResolvedVariableRecord(value: unknown): ResolvedVariableRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const sourceScopeRef = mapBranchScopeRef(record.source_scope_ref);

  return {
    key: readString(record.key),
    sourceScope: readString(record.source_scope, "global") as VariableScope,
    sourceScopeId: readString(record.source_scope_id),
    ...(sourceScopeRef ? { sourceScopeRef } : {}),
    updatedAt: readNumber(record.updated_at),
    value: record.value,
  };
}

function mapVariableLayers(value: unknown): Partial<Record<VariableScope, VariableLayerSnapshot>> | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const layers: Partial<Record<VariableScope, VariableLayerSnapshot>> = {};

  for (const scope of VARIABLE_SCOPES) {
    const layer = mapVariableLayerSnapshot(scope, record[scope]);
    if (layer) {
      layers[scope] = layer;
    }
  }

  return Object.keys(layers).length > 0 ? layers : undefined;
}

function mapVariableLayerSnapshot(scope: VariableScope, value: unknown): VariableLayerSnapshot | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const scopeRef = mapBranchScopeRef(record.scope_ref);

  return {
    items: readArray(record.items).map(mapVariableRecord).filter((item): item is VariableRecord => item !== null),
    scope: readString(record.scope, scope) as VariableScope,
    scopeId: readString(record.scope_id),
    ...(scopeRef ? { scopeRef } : {}),
  };
}

function mapBranchScopeRef(value: unknown): BranchVariableScopeRef | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const sessionId = readOptionalString(record.session_id);
  const branchId = readOptionalString(record.branch_id);
  if (!sessionId || !branchId) {
    return undefined;
  }

  return { sessionId, branchId };
}

function mapUpsertManyResult(payload: Record<string, unknown> | null): VariablesUpsertManyResult {
  const data = readRecord(payload?.data);
  const meta = readRecord(data?.meta);

  return {
    meta: {
      created: readNumber(meta?.created),
      total: readNumber(meta?.total),
      updated: readNumber(meta?.updated),
    },
    results: readArray(data?.results).reduce<VariablesUpsertManyResult["results"]>((items, value) => {
      const record = readRecord(value);
      const variable = mapVariableRecord(record?.data);
      if (!record || !variable) {
        return items;
      }

      items.push({
        action: readString(record.action),
        data: variable,
        index: readNumber(record.index),
      });
      return items;
    }, []),
  };
}

import { Buffer } from "node:buffer";

import type { AppDb } from "../db/client.js";
import type {
  ClientDataItemRecord,
  ClientDataManagedDomainRecord,
} from "../client-data/client-data-repository.js";
import type {
  SessionStateMutationListFilters,
  SessionStateMutationListPagination,
} from "./session-state-repository.js";
import {
  SessionStateService,
  type SessionStateObservationAccess,
} from "./session-state-service.js";
import type {
  SessionStateDiffEntry,
  SessionStateFloorSnapshotView,
  SessionStateLiveHeadEnvelope,
  SessionStateMutationStatus,
  SessionStateMutationView,
  SessionStateNamespace,
  SessionStateReplayEvaluation,
  SessionStateResolvedValue,
} from "./session-state-types.js";
import {
  SESSION_STATE_LIVE_COLLECTION,
  SESSION_STATE_SNAPSHOT_COLLECTION,
} from "./session-state-types.js";

/**
 * Phase 3 观察面 facade。
 *
 * 收口所有只读端点，并在服务层统一做账号隔离校验。不提供任何写路径，不绕过
 * requireOwnedSession / requireOwnedFloor 返回跨账号数据，也不直接解析 client_data_item 原文：
 * 所有 payload 解析均调用 SessionStateService 提供的 envelope 方法。
 */
export class SessionStateObservationService {
  private readonly access: SessionStateObservationAccess;

  constructor(
    private readonly db: AppDb,
    private readonly sessionStateService: SessionStateService,
  ) {
    this.access = this.sessionStateService.getObservationAccess();
  }


  listBindingsForSession(accountId: string, sessionId: string): ClientDataManagedDomainRecord[] {
    this.requireOwnedSession(accountId, sessionId);
    return this.access.clientDataRepository(this.db).listManagedDomainsByHost({
      accountId,
      managerKind: "session_state",
      hostType: "session",
      hostId: sessionId,
    });
  }

  listMutationsForSession(
    accountId: string,
    sessionId: string,
    filters: Omit<SessionStateMutationListFilters, "sessionId">,
    pagination: SessionStateMutationListPagination,
  ): SessionStateMutationListPageView {
    this.requireOwnedSession(accountId, sessionId);
    const { rows, total } = this.access.sessionStateRepository(this.db).listMutations(
      { ...filters, sessionId },
      pagination,
    );
    return {
      rows: rows.map((row) => this.buildMutationSummary(row)),
      total,
    };
  }

  getMutationById(
    accountId: string,
    sessionId: string,
    mutationId: string,
  ): SessionStateObservedMutationDetail {
    this.requireOwnedSession(accountId, sessionId);
    const mutation = this.access.sessionStateRepository(this.db).findMutationById(mutationId);
    if (!mutation || mutation.sessionId !== sessionId || mutation.accountId !== accountId) {
      throw new SessionStateObservationServiceError(404, "not_found", "Resource not found");
    }
    return this.buildMutationDetail(mutation);
  }

  listLiveHeadsForSession(
    accountId: string,
    sessionId: string,
    filters: LiveHeadListFilters,
  ): SessionStateObservedLiveHeadSummary[] {
    this.requireOwnedSession(accountId, sessionId);
    const bindings = this.listBindingsForSession(accountId, sessionId);
    const namespaceFilter = filters.stateNamespace;
    const branchFilter = filters.branchId;
    const result: SessionStateObservedLiveHeadSummary[] = [];

    for (const binding of bindings) {
      if (namespaceFilter !== undefined && binding.stateNamespace !== namespaceFilter) {
        continue;
      }
      const items = this.listItemsByPrefix(accountId, binding.domainId, SESSION_STATE_LIVE_COLLECTION, "live:");
      for (const item of items) {
        const envelope = this.sessionStateService.parseLiveHeadEnvelope(item.valueJson);
        if (!envelope) continue;
        if (envelope.sessionId !== sessionId) continue;
        if (branchFilter !== undefined && (envelope.branchId ?? null) !== branchFilter) continue;
        result.push({
          stateNamespace: envelope.namespace,
          slot: envelope.slot,
          branchId: envelope.branchId,
          visibilityMode: envelope.visibilityMode,
          schemaVersion: envelope.schemaVersion,
          present: envelope.present,
          sourceFloorId: envelope.sourceFloorId,
          lastMutationId: envelope.lastMutationId,
          updatedAt: envelope.updatedAt,
          payloadSizeBytes: byteLengthOf(item.valueJson),
        });
      }
    }

    return result;
  }

  resolveLive(
    accountId: string,
    sessionId: string,
    branchId: string,
    namespace: SessionStateNamespace,
    slot: string,
    sourceFloorId?: string,
  ): SessionStateResolvedValue | null {
    this.requireOwnedSession(accountId, sessionId);
    this.access.requireSlotDefinition(namespace, slot);
    return this.sessionStateService.resolveLiveValue({
      accountId,
      sessionId,
      branchId,
      namespace,
      slot,
      ...(sourceFloorId ? { sourceFloorId } : {}),
    });
  }

  listFloorSnapshots(
    accountId: string,
    sessionId: string,
    floorId: string,
    filters: FloorSnapshotListFilters,
  ): SessionStateObservedSnapshotSummary[] {
    this.requireOwnedSessionAndFloor(accountId, sessionId, floorId);
    const bindings = this.listBindingsForSession(accountId, sessionId);
    const namespaceFilter = filters.stateNamespace;
    const result: SessionStateObservedSnapshotSummary[] = [];

    for (const binding of bindings) {
      if (namespaceFilter !== undefined && binding.stateNamespace !== namespaceFilter) {
        continue;
      }
      const prefix = `snapshot:${binding.stateNamespace}:`;
      const items = this.listItemsByPrefix(accountId, binding.domainId, SESSION_STATE_SNAPSHOT_COLLECTION, prefix);
      for (const item of items) {
        if (!item.itemKey.endsWith(`:floor:${floorId}`)) continue;
        const view = this.sessionStateService.parseFloorSnapshotEnvelope(item.valueJson);
        if (!view) continue;
        if (view.floorId !== floorId || view.sessionId !== sessionId) continue;
        result.push({
          stateNamespace: view.namespace,
          slot: view.slot,
          visibilityMode: view.visibilityMode,
          schemaVersion: view.schemaVersion,
          present: view.present,
          sessionId: view.sessionId,
          branchId: view.branchId,
          floorId: view.floorId,
          sourceMutationIds: [...view.sourceMutationIds],
          committedAt: view.committedAt,
          payloadSizeBytes: byteLengthOf(item.valueJson),
        });
      }
    }

    return result;
  }

  getFloorSnapshot(
    accountId: string,
    sessionId: string,
    floorId: string,
    namespace: SessionStateNamespace,
    slot: string,
  ): SessionStateFloorSnapshotView | null {
    this.requireOwnedSessionAndFloor(accountId, sessionId, floorId);
    this.access.requireSlotDefinition(namespace, slot);
    return this.sessionStateService.getFloorSnapshot({
      accountId,
      sessionId,
      floorId,
      namespace,
      slot,
    });
  }

  evaluateReplaySafetyForFloor(
    accountId: string,
    sessionId: string,
    floorId: string,
    confirmedMutationIds?: string[],
  ): SessionStateReplayEvaluation {
    this.requireOwnedSessionAndFloor(accountId, sessionId, floorId);
    return this.sessionStateService.evaluateReplaySafetyForFloor({
      accountId,
      sessionId,
      floorId,
      ...(confirmedMutationIds ? { confirmedMutationIds } : {}),
    });
  }

  diffFloorAgainst(
    accountId: string,
    sessionId: string,
    floorId: string,
    against: DiffAgainst,
    options: DiffOptions = {},
  ): SessionStateObservedDiffEntry[] {
    this.requireOwnedSessionAndFloor(accountId, sessionId, floorId);
    const namespace = options.stateNamespace;
    const includeValues = options.includeValues === true;

    let entries: SessionStateDiffEntry[];
    if (against.kind === "floor") {
      this.requireOwnedFloor(accountId, against.floorId);
      entries = this.sessionStateService.diffFloorSnapshots({
        accountId,
        sessionId,
        leftFloorId: floorId,
        rightFloorId: against.floorId,
        ...(namespace ? { namespace } : {}),
      });
    } else {
      entries = this.sessionStateService.diffLiveAgainstFloor({
        accountId,
        sessionId,
        branchId: against.branchId,
        floorId,
        ...(namespace ? { namespace } : {}),
      });
    }

    return entries.map((entry) => {
      const base = {
        stateNamespace: entry.namespace,
        slot: entry.slot,
        changeType: entry.changeType,
        leftFloorId: entry.leftFloorId,
        rightFloorId: entry.rightFloorId,
        leftPresent: entry.leftPresent,
        rightPresent: entry.rightPresent,
      } satisfies Omit<SessionStateObservedDiffEntry, "leftValue" | "rightValue">;

      if (!includeValues) {
        return base;
      }

      return {
        ...base,
        leftValue: entry.leftValue ?? null,
        rightValue: entry.rightValue ?? null,
      };
    });
  }

  private buildMutationSummary(
    mutation: SessionStateMutationView,
  ): SessionStateObservedMutationSummary {
    const payloadJson = mutation.payloadJson;
    const payloadSizeBytes = byteLengthOf(payloadJson);
    const payload = this.sessionStateService.parseMutationPayload(payloadJson);
    return {
      id: mutation.id,
      stateNamespace: mutation.stateNamespace,
      targetSlot: mutation.targetSlot,
      sessionId: mutation.sessionId,
      branchId: mutation.branchId,
      sourceFloorId: mutation.sourceFloorId,
      sourceSnapshotFloorId: mutation.sourceSnapshotFloorId,
      visibilityMode: mutation.visibilityMode,
      writeMode: mutation.writeMode,
      status: mutation.status,
      replaySafety: mutation.replaySafety,
      requestId: mutation.requestId,
      runId: mutation.runId,
      liveHeadKey: mutation.liveHeadKey,
      discardReason: mutation.discardReason,
      blockedReason: mutation.blockedReason,
      payloadSizeBytes,
      payloadPresent: payload.present,
      payloadPreview: buildPayloadPreview(payloadJson),
      createdAt: mutation.createdAt,
      updatedAt: mutation.updatedAt,
      appliedAt: mutation.appliedAt,
    };
  }

  private buildMutationDetail(mutation: SessionStateMutationView): SessionStateObservedMutationDetail {
    const summary = this.buildMutationSummary(mutation);
    const payload = this.sessionStateService.parseMutationPayload(mutation.payloadJson);
    return {
      ...summary,
      payload: {
        present: payload.present,
        value: payload.value ?? null,
      },
    };
  }

  private listItemsByPrefix(
    _accountId: string,
    domainId: string,
    collectionName: string,
    prefix: string,
  ): ClientDataItemRecord[] {
    const collection = this.access.clientDataRepository(this.db).getCollectionByDomainName(domainId, collectionName);
    if (!collection) {
      return [];
    }
    const result: ClientDataItemRecord[] = [];
    const pageSize = 200;
    let offset = 0;
    for (;;) {
      const page = this.access.clientDataRepository(this.db).listItems({
        domainId,
        collectionId: collection.id,
        limit: pageSize,
        offset,
        sortBy: "item_key",
        sortOrder: "asc",
      });
      for (const row of page.rows) {
        if (row.itemKey.startsWith(prefix)) {
          result.push(row);
        }
      }
      if (page.rows.length < pageSize) break;
      offset += pageSize;
      if (offset >= page.total) break;
    }
    return result;
  }


  /**
   * 按 floorId 解析它所属的 sessionId，同时做一次账号归属校验。
   *
   * 路由层只拿到 /floors/:id 的时候需要先知道 floor 属于哪个 session，
   * 才能调用 session-scoped 的读方法。账号不匹配或 floor 不存在时统一返回 null，
   * 由路由层回 404。
   */
  resolveOwnedFloorMeta(accountId: string, floorId: string): { sessionId: string; branchId: string } | null {
    const floor = this.access.sessionStateRepository(this.db).getFloorById(floorId);
    if (!floor) return null;
    const session = this.access.sessionStateRepository(this.db).getSessionById(floor.sessionId);
    if (!session || session.accountId !== accountId) return null;
    return { sessionId: floor.sessionId, branchId: floor.branchId };
  }

  private requireOwnedSession(accountId: string, sessionId: string): void {
    const session = this.access.sessionStateRepository(this.db).getSessionById(sessionId);
    if (!session || session.accountId !== accountId) {
      throw new SessionStateObservationServiceError(404, "not_found", "Resource not found");
    }
  }

  private requireOwnedFloor(accountId: string, floorId: string): void {
    const floor = this.access.sessionStateRepository(this.db).getFloorById(floorId);
    if (!floor) {
      throw new SessionStateObservationServiceError(404, "not_found", "Resource not found");
    }
    const session = this.access.sessionStateRepository(this.db).getSessionById(floor.sessionId);
    if (!session || session.accountId !== accountId) {
      throw new SessionStateObservationServiceError(404, "not_found", "Resource not found");
    }
  }

  private requireOwnedSessionAndFloor(accountId: string, sessionId: string, floorId: string): void {
    this.requireOwnedSession(accountId, sessionId);
    const floor = this.access.sessionStateRepository(this.db).getFloorById(floorId);
    if (!floor || floor.sessionId !== sessionId) {
      throw new SessionStateObservationServiceError(404, "not_found", "Resource not found");
    }
  }
}

export interface LiveHeadListFilters {
  stateNamespace?: SessionStateNamespace;
  branchId?: string | null;
}

export interface FloorSnapshotListFilters {
  stateNamespace?: SessionStateNamespace;
}

export interface DiffOptions {
  stateNamespace?: SessionStateNamespace;
  includeValues?: boolean;
}

export type DiffAgainst =
  | { kind: "floor"; floorId: string }
  | { kind: "live"; branchId: string };

export interface SessionStateMutationListPageView {
  rows: SessionStateObservedMutationSummary[];
  total: number;
}

export interface SessionStateObservedMutationSummary {
  id: string;
  stateNamespace: SessionStateNamespace;
  targetSlot: string;
  sessionId: string;
  branchId: string;
  sourceFloorId: string | null;
  sourceSnapshotFloorId: string | null;
  visibilityMode: SessionStateMutationView["visibilityMode"];
  writeMode: SessionStateMutationView["writeMode"];
  status: SessionStateMutationStatus;
  replaySafety: SessionStateMutationView["replaySafety"];
  requestId: string | null;
  runId: string | null;
  liveHeadKey: string | null;
  discardReason: string | null;
  blockedReason: string | null;
  payloadSizeBytes: number;
  payloadPresent: boolean;
  payloadPreview: string;
  createdAt: number;
  updatedAt: number;
  appliedAt: number | null;
}

export interface SessionStateObservedMutationDetail extends SessionStateObservedMutationSummary {
  payload: {
    present: boolean;
    value: unknown | null;
  };
}

export interface SessionStateObservedLiveHeadSummary {
  stateNamespace: SessionStateNamespace;
  slot: string;
  branchId: string | null;
  visibilityMode: SessionStateLiveHeadEnvelope["visibilityMode"];
  schemaVersion: number;
  present: boolean;
  sourceFloorId: string | null;
  lastMutationId: string | null;
  updatedAt: number;
  payloadSizeBytes: number;
}

export interface SessionStateObservedSnapshotSummary {
  stateNamespace: SessionStateNamespace;
  slot: string;
  visibilityMode: SessionStateFloorSnapshotView["visibilityMode"];
  schemaVersion: number;
  present: boolean;
  sessionId: string;
  branchId: string;
  floorId: string;
  sourceMutationIds: string[];
  committedAt: number;
  payloadSizeBytes: number;
}

export interface SessionStateObservedDiffEntry {
  stateNamespace: SessionStateNamespace;
  slot: string;
  changeType: SessionStateDiffEntry["changeType"];
  leftFloorId: string | null;
  rightFloorId: string | null;
  leftPresent: boolean;
  rightPresent: boolean;
  leftValue?: unknown | null;
  rightValue?: unknown | null;
}

export class SessionStateObservationServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code:
      | "not_found"
      | "validation_error"
      | "session_state_namespace_not_registered"
      | "feature_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "SessionStateObservationServiceError";
  }
}

function buildPayloadPreview(payloadJson: string): string {
  const max = 256;
  if (payloadJson.length <= max) return payloadJson;
  return payloadJson.slice(0, max);
}

function byteLengthOf(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

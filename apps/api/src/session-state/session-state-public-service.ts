import type { AppDb } from "../db/client.js";
import type { SessionStateCustomNamespaceService } from "./session-state-custom-namespace-service.js";
import type { SessionStateFloorHostRecord } from "./session-state-repository.js";
import {
  SessionStateService,
  type SessionStateObservationAccess,
} from "./session-state-service.js";
import type {
  SessionStateFloorSnapshotView,
  SessionStateNamespace,
  SessionStatePublicDiffEntry,
  SessionStatePublicNamespaceDefinition,
  SessionStatePublicBuiltInNamespaceDefinition,
  SessionStatePublicResolvedValue,
  SessionStatePublicSnapshotValue,
  SessionStatePublicSlotDefinition,
  SessionStateResolvedValue,
  SessionStateSlotDefinition,
} from "./session-state-types.js";
import type { SessionStateOperationLogContext } from "./session-state-operation-log.js";

export interface SessionStatePublicResolveInput {
  accountId: string;
  sessionId: string;
  branchId: string;
  sourceFloorId?: string;
  namespace?: SessionStateNamespace;
  slot?: string;
}

export interface SessionStatePublicSnapshotInput {
  accountId: string;
  sessionId: string;
  floorId: string;
  namespace?: SessionStateNamespace;
  slot?: string;
}

export interface SessionStatePublicDiffInput {
  accountId: string;
  sessionId: string;
  floorId: string;
  against:
    | { kind: "live"; branchId: string }
    | { kind: "floor"; floorId: string };
  namespace?: SessionStateNamespace;
  slot?: string;
}

export interface SessionStatePublicWriteInput {
  accountId: string;
  sessionId: string;
  branchId: string;
  namespace: SessionStateNamespace;
  slot: string;
  value: unknown | null;
  operationLog?: SessionStateOperationLogContext;
}

export interface SessionStatePublicDeleteInput {
  accountId: string;
  sessionId: string;
  branchId: string;
  namespace: SessionStateNamespace;
  slot: string;
  operationLog?: SessionStateOperationLogContext;
}

export class SessionStatePublicService {
  private readonly access: SessionStateObservationAccess;

  constructor(
    private readonly db: AppDb,
    private readonly sessionStateService: SessionStateService,
    private readonly customNamespaceService?: SessionStateCustomNamespaceService,
  ) {
    this.access = this.sessionStateService.getObservationAccess();
  }

  listNamespaces(accountId: string, sessionId: string): SessionStatePublicNamespaceDefinition[] {
    this.requireOwnedSession(accountId, sessionId);

    return [...this.listBuiltInNamespaces(), ...this.listCustomNamespaces(accountId, sessionId)]
      .sort((left, right) => left.namespace.localeCompare(right.namespace));
  }

  private listBuiltInNamespaces(): SessionStatePublicBuiltInNamespaceDefinition[] {
    const namespaces = new Map<string, SessionStatePublicBuiltInNamespaceDefinition>();
    for (const definition of this.access.slotRegistry.listPublic()) {
      const current = namespaces.get(definition.namespace);
      const slot = this.toPublicSlotDefinition(definition);
      if (current) {
        current.slots.push(slot);
        continue;
      }
      namespaces.set(definition.namespace, {
        namespace: definition.namespace,
        ownerKind: "built_in",
        slots: [slot],
      });
    }

    return [...namespaces.values()]
      .sort((left, right) => left.namespace.localeCompare(right.namespace))
      .map((entry) => ({
        ...entry,
        slots: [...entry.slots].sort((left, right) => left.slot.localeCompare(right.slot)),
      }));
  }

  private listCustomNamespaces(accountId: string, sessionId: string): SessionStatePublicNamespaceDefinition[] {
    return this.customNamespaceService?.listNamespaces(accountId, sessionId) ?? [];
  }

  resolveValues(input: SessionStatePublicResolveInput): SessionStatePublicResolvedValue[] {
    this.requireOwnedSession(input.accountId, input.sessionId);
    if (input.sourceFloorId) {
      this.requireOwnedFloor(input.accountId, input.sessionId, input.sourceFloorId);
    }

    return this.listPublicDefinitions(input.accountId, input.sessionId, { namespace: input.namespace, slot: input.slot }).map((definition) => {
      const resolved = this.sessionStateService.resolveLiveValue({
        accountId: input.accountId,
        sessionId: input.sessionId,
        branchId: input.branchId,
        namespace: definition.namespace,
        slot: definition.slot,
        ...(input.sourceFloorId ? { sourceFloorId: input.sourceFloorId } : {}),
      });
      return resolved
        ? this.toPublicResolvedValue(resolved)
        : this.createEmptyResolvedValue(definition, input.sessionId, input.branchId, input.sourceFloorId ?? null);
    });
  }

  listFloorSnapshots(input: SessionStatePublicSnapshotInput): SessionStatePublicSnapshotValue[] {
    const floor = this.requireOwnedFloor(input.accountId, input.sessionId, input.floorId);

    return this.listPublicDefinitions(input.accountId, input.sessionId, { namespace: input.namespace, slot: input.slot }).map((definition) => {
      const snapshot = this.sessionStateService.getFloorSnapshot({
        accountId: input.accountId,
        sessionId: input.sessionId,
        floorId: input.floorId,
        namespace: definition.namespace,
        slot: definition.slot,
      });
      return snapshot
        ? this.toPublicSnapshotValue(snapshot)
        : this.createEmptySnapshotValue(definition, input.sessionId, floor.branchId, input.floorId);
    });
  }

  diff(input: SessionStatePublicDiffInput): SessionStatePublicDiffEntry[] {
    this.requireOwnedFloor(input.accountId, input.sessionId, input.floorId);
    if (input.against.kind === "floor") {
      this.requireOwnedFloor(input.accountId, input.sessionId, input.against.floorId);
    }

    return this.listPublicDefinitions(input.accountId, input.sessionId, { namespace: input.namespace, slot: input.slot }).map((definition) => {
      const left = input.against.kind === "live"
        ? this.toSnapshotViewFromResolved(
            this.sessionStateService.resolveLiveValue({
              accountId: input.accountId,
              sessionId: input.sessionId,
              branchId: input.against.branchId,
              namespace: definition.namespace,
              slot: definition.slot,
            }),
            input.floorId,
          )
        : this.sessionStateService.getFloorSnapshot({
            accountId: input.accountId,
            sessionId: input.sessionId,
            floorId: input.against.floorId,
            namespace: definition.namespace,
            slot: definition.slot,
          });

      const right = this.sessionStateService.getFloorSnapshot({
        accountId: input.accountId,
        sessionId: input.sessionId,
        floorId: input.floorId,
        namespace: definition.namespace,
        slot: definition.slot,
      });

      return this.toPublicDiffEntry(definition.namespace, definition.slot, left, right);
    });
  }

  writeValue(input: SessionStatePublicWriteInput): SessionStatePublicResolvedValue {
    this.requireOwnedSession(input.accountId, input.sessionId);
    this.requireClientWritableCustomNamespace(input.accountId, input.sessionId, input.namespace);
    this.sessionStateService.writeDirectValue({
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      namespace: input.namespace,
      slot: input.slot,
      value: input.value,
      operationLog: input.operationLog,
    });
    return this.resolveCurrentEffectiveValueForSlot(input.accountId, input.sessionId, input.branchId, input.namespace, input.slot);
  }

  deleteValue(input: SessionStatePublicDeleteInput): SessionStatePublicResolvedValue {
    this.requireOwnedSession(input.accountId, input.sessionId);
    this.requireClientWritableCustomNamespace(input.accountId, input.sessionId, input.namespace);
    this.sessionStateService.writeDirectValue({
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      namespace: input.namespace,
      slot: input.slot,
      value: null,
      present: false,
      operationLog: input.operationLog,
    });
    return this.resolveCurrentEffectiveValueForSlot(input.accountId, input.sessionId, input.branchId, input.namespace, input.slot);
  }

  private listPublicDefinitions(
    accountId: string,
    sessionId: string,
    filter?: {
      namespace?: SessionStateNamespace;
      slot?: string;
  },
  ): SessionStateSlotDefinition[] {
    const definitions = [
      ...this.access.slotRegistry.listPublic(filter?.namespace),
      ...(this.customNamespaceService?.listMaterializedSlotDefinitions(accountId, sessionId, filter?.namespace) ?? []),
    ];
    return definitions
      .filter((definition) => definition.publicExposure.capabilities.clientReadable)
      .filter((definition) => filter?.slot === undefined || definition.slot === filter.slot)
      .sort((left, right) => {
        const namespaceOrder = left.namespace.localeCompare(right.namespace);
        return namespaceOrder !== 0 ? namespaceOrder : left.slot.localeCompare(right.slot);
      });
  }

  private toPublicSlotDefinition(definition: SessionStateSlotDefinition): SessionStatePublicSlotDefinition {
    return {
      namespace: definition.namespace,
      slot: definition.slot,
      ownerKind: definition.publicExposure.ownerKind,
      exposureLifecycle: definition.publicExposure.exposureLifecycle,
      visibilityMode: definition.visibilityMode,
      defaultWriteMode: definition.defaultWriteMode,
      defaultReplaySafety: definition.defaultReplaySafety,
      schemaVersion: definition.schemaVersion,
      sizeBudgetBytes: definition.sizeBudgetBytes,
      capabilities: {
        clientReadable: definition.publicExposure.capabilities.clientReadable,
        clientWritable: definition.publicExposure.capabilities.clientWritable,
        allowedWriteModes: [...definition.publicExposure.capabilities.allowedWriteModes],
        supportsSnapshot: definition.publicExposure.capabilities.supportsSnapshot,
        supportsDiff: definition.publicExposure.capabilities.supportsDiff,
      },
    };
  }

  private toPublicResolvedValue(resolved: SessionStateResolvedValue): SessionStatePublicResolvedValue {
    return {
      namespace: resolved.namespace,
      slot: resolved.slot,
      source: resolved.source,
      visibilityMode: resolved.visibilityMode,
      schemaVersion: resolved.schemaVersion,
      present: resolved.present,
      value: resolved.value,
      sessionId: resolved.sessionId,
      branchId: resolved.branchId,
      floorId: resolved.floorId,
      sourceMutationIds: [...resolved.sourceMutationIds],
      updatedAt: resolved.updatedAt,
    };
  }

  private createEmptyResolvedValue(
    definition: SessionStateSlotDefinition,
    sessionId: string,
    branchId: string,
    floorId: string | null,
  ): SessionStatePublicResolvedValue {
    return {
      namespace: definition.namespace,
      slot: definition.slot,
      source: "none",
      visibilityMode: definition.visibilityMode,
      schemaVersion: definition.schemaVersion,
      present: false,
      value: null,
      sessionId,
      branchId,
      floorId,
      sourceMutationIds: [],
      updatedAt: null,
    };
  }

  private toPublicSnapshotValue(snapshot: SessionStateFloorSnapshotView): SessionStatePublicSnapshotValue {
    return {
      namespace: snapshot.namespace,
      slot: snapshot.slot,
      visibilityMode: snapshot.visibilityMode,
      schemaVersion: snapshot.schemaVersion,
      present: snapshot.present,
      value: snapshot.value,
      sessionId: snapshot.sessionId,
      branchId: snapshot.branchId,
      floorId: snapshot.floorId,
      sourceMutationIds: [...snapshot.sourceMutationIds],
      committedAt: snapshot.committedAt,
    };
  }

  private createEmptySnapshotValue(
    definition: SessionStateSlotDefinition,
    sessionId: string,
    branchId: string,
    floorId: string,
  ): SessionStatePublicSnapshotValue {
    return {
      namespace: definition.namespace,
      slot: definition.slot,
      visibilityMode: definition.visibilityMode,
      schemaVersion: definition.schemaVersion,
      present: false,
      value: null,
      sessionId,
      branchId,
      floorId,
      sourceMutationIds: [],
      committedAt: null,
    };
  }

  private toSnapshotViewFromResolved(
    resolved: SessionStateResolvedValue | null,
    fallbackFloorId: string,
  ): SessionStateFloorSnapshotView | null {
    if (!resolved) {
      return null;
    }

    return {
      namespace: resolved.namespace,
      slot: resolved.slot,
      visibilityMode: resolved.visibilityMode,
      schemaVersion: resolved.schemaVersion,
      present: resolved.present,
      value: resolved.value,
      sessionId: resolved.sessionId,
      branchId: resolved.branchId,
      floorId: resolved.floorId ?? fallbackFloorId,
      sourceMutationIds: [...resolved.sourceMutationIds],
      committedAt: resolved.updatedAt,
    };
  }

  private toPublicDiffEntry(
    namespace: SessionStateNamespace,
    slot: string,
    left: SessionStateFloorSnapshotView | null,
    right: SessionStateFloorSnapshotView | null,
  ): SessionStatePublicDiffEntry {
    const leftPresent = left?.present ?? false;
    const rightPresent = right?.present ?? false;
    const leftValue = left?.value ?? null;
    const rightValue = right?.value ?? null;
    const changeType = !leftPresent && rightPresent
      ? "added"
      : leftPresent && !rightPresent
        ? "removed"
        : valuesEqual(leftValue, rightValue)
          ? "unchanged"
          : "changed";

    return {
      namespace,
      slot,
      changeType,
      leftFloorId: left?.floorId ?? null,
      rightFloorId: right?.floorId ?? null,
      leftPresent,
      rightPresent,
      leftValue,
      rightValue,
    };
  }

  private resolveCurrentEffectiveValueForSlot(
    accountId: string,
    sessionId: string,
    branchId: string,
    namespace: SessionStateNamespace,
    slot: string,
  ): SessionStatePublicResolvedValue {
    const resolved = this.sessionStateService.resolveLiveValue({
      accountId,
      sessionId,
      branchId,
      namespace,
      slot,
    });
    if (resolved) {
      return this.toPublicResolvedValue(resolved);
    }

    const definition = this.customNamespaceService?.resolveWritableSlotDefinition(accountId, sessionId, namespace, slot);
    if (!definition) {
      throw new SessionStatePublicServiceError(
        500,
        "session_state_public_write_resolution_failed",
        `Failed to resolve current-effective view for slot '${namespace}/${slot}' after write`,
      );
    }
    return this.createEmptyResolvedValue(definition, sessionId, branchId, null);
  }

  private requireClientWritableCustomNamespace(
    accountId: string,
    sessionId: string,
    namespace: SessionStateNamespace,
  ) {
    if (this.access.slotRegistry.list(namespace).length > 0) {
      throw new SessionStatePublicServiceError(409, "session_state_public_write_forbidden", `Clients cannot write built-in Session State namespace '${namespace}'`);
    }

    const service = this.requireCustomNamespaceService();
    const registration = service.getNamespaceRegistration(accountId, sessionId, namespace);
    if (!registration) {
      throw new SessionStatePublicServiceError(404, "session_state_namespace_not_registered", `Session State namespace '${namespace}' is not registered for session '${sessionId}'`);
    }
    if (!registration.defaultSlotTemplate.clientWritable || !registration.defaultSlotTemplate.allowedWriteModes.includes("direct")) {
      throw new SessionStatePublicServiceError(409, "session_state_public_write_forbidden", `Session State namespace '${namespace}' does not allow client direct writes`);
    }
    return registration;
  }

  private requireCustomNamespaceService(): SessionStateCustomNamespaceService {
    if (!this.customNamespaceService) {
      throw new SessionStatePublicServiceError(503, "feature_unavailable", "Session state is unavailable because client-data is disabled");
    }
    return this.customNamespaceService;
  }

  private requireOwnedSession(accountId: string, sessionId: string) {
    const session = this.access.sessionStateRepository(this.db).getSessionById(sessionId);
    if (!session || session.accountId !== accountId) {
      throw new SessionStatePublicServiceError(404, "not_found", "Resource not found");
    }
    return session;
  }

  private requireOwnedFloor(
    accountId: string,
    sessionId: string,
    floorId: string,
  ): SessionStateFloorHostRecord {
    this.requireOwnedSession(accountId, sessionId);
    const floor = this.access.sessionStateRepository(this.db).getFloorById(floorId);
    if (!floor || floor.sessionId !== sessionId) {
      throw new SessionStatePublicServiceError(404, "not_found", "Resource not found");
    }
    return floor;
  }
}

export class SessionStatePublicServiceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SessionStatePublicServiceError";
  }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableStringify(value));
}

function normalizeForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForStableStringify(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeForStableStringify(entry)]),
    );
  }

  return value;
}

import { Buffer } from "node:buffer";

import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { parseJsonField } from "../lib/http.js";
import {
  ClientDataService,
  ClientDataServiceError,
  type ClientDataAuditActor,
  type ClientDataConfig,
} from "../client-data/client-data-service.js";
import {
  ClientDataRepository,
  type ClientDataManagedDomainRecord,
  type ClientDataItemRecord,
} from "../client-data/client-data-repository.js";
import type { SessionStateCustomNamespaceService } from "./session-state-custom-namespace-service.js";
import { SessionStateRepository, type SessionStateFloorHostRecord } from "./session-state-repository.js";
import {
  SessionStateSlotRegistry,
  createDefaultSessionStateSlotRegistry,
} from "./session-state-slot-registry.js";
import type {
  SessionStateDiffEntry,
  SessionStateFloorSnapshotEnvelope,
  SessionStateFloorSnapshotView,
  SessionStateLiveHeadEnvelope,
  SessionStateMutationPayload,
  SessionStateMutationView,
  SessionStateNamespace,
  SessionStateReplaySafety,
  SessionStateReplayEvaluation,
  SessionStateResolvedValue,
  SessionStateSlotDefinition,
  SessionStateVisibilityMode,
  SessionStateWriteMode,
} from "./session-state-types.js";
import {
  SESSION_STATE_HOST_TYPE,
  SESSION_STATE_INTERNAL_OWNER_ID,
  SESSION_STATE_INTERNAL_OWNER_TYPE,
  SESSION_STATE_LIVE_COLLECTION,
  SESSION_STATE_MANAGER_KIND,
  SESSION_STATE_SNAPSHOT_COLLECTION,
} from "./session-state-types.js";
import {
  appendSessionStateOperationLog,
  buildSessionStateValueTargetId,
  toSessionStateValueOperationRef,
  type SessionStateOperationLogContext,
} from "./session-state-operation-log.js";

export interface SessionStateServiceOptions {
  clientData: ClientDataConfig;
  slotRegistry?: SessionStateSlotRegistry;
  managedOwnerType?: "application" | "plugin";
  managedOwnerId?: string;
  customNamespaceService?: SessionStateCustomNamespaceService;
  now?: () => number;
}

export interface SessionStateApplyResult {
  mutations: SessionStateMutationView[];
  snapshots: SessionStateFloorSnapshotView[];
}

export class SessionStateService {
  private readonly clientDataConfig: ClientDataConfig;
  private readonly slotRegistry: SessionStateSlotRegistry;
  private readonly managedOwnerType: "application" | "plugin";
  private readonly managedOwnerId: string;
  private readonly customNamespaceService?: SessionStateCustomNamespaceService;
  private readonly now: () => number;

  constructor(
    private readonly db: AppDb,
    options: SessionStateServiceOptions,
  ) {
    this.clientDataConfig = options.clientData;
    this.slotRegistry = options.slotRegistry ?? createDefaultSessionStateSlotRegistry();
    this.managedOwnerType = options.managedOwnerType ?? SESSION_STATE_INTERNAL_OWNER_TYPE;
    this.managedOwnerId = options.managedOwnerId ?? SESSION_STATE_INTERNAL_OWNER_ID;
    this.customNamespaceService = options.customNamespaceService;
    this.now = options.now ?? Date.now;
  }

  stageCommitBoundValue(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    sourceFloorId: string;
    namespace: SessionStateNamespace;
    slot: string;
    value: unknown | null;
    present?: boolean;
    replaySafety?: SessionStateReplaySafety;
    requestId?: string | null;
    runId?: string | null;
  }): SessionStateMutationView {
    return this.executeTransaction((tx) => {
      const host = this.requireSessionHost(tx, input.accountId, input.sessionId, { requireActive: true });
      const definition = this.requireWritableSlotDefinition(host.accountId, host.id, input.namespace, input.slot);
      this.ensureWriteModeAllowed(definition, "commit_bound");
      const replaySafety = this.resolveReplaySafety(definition, input.replaySafety);
      const sourceFloor = this.requireFloorInSession(tx, host.id, input.sourceFloorId);
      this.requireFloorBranchMatch(sourceFloor, input.branchId, "Source floor");
      const binding = this.ensureManagedDomainBinding(tx, host.accountId, host.id, input.namespace);
      const payload = this.createMutationPayload({
        present: input.present ?? true,
        value: input.value,
      });
      this.assertPayloadWithinBudget(definition, payload);
      const mutation = this.sessionStateRepository(tx).createMutation({
        id: nanoid(),
        accountId: host.accountId,
        domainId: binding.domainId,
        stateNamespace: input.namespace,
        sessionId: host.id,
        branchId: input.branchId,
        sourceFloorId: input.sourceFloorId,
        targetSlot: input.slot,
        visibilityMode: definition.visibilityMode,
        writeMode: "commit_bound",
        commitMode: "turn_bound",
        replaySafety,
        status: "staged",
        decisionStatus: "accepted",
        requestId: input.requestId ?? null,
        runId: input.runId ?? null,
        payloadJson: JSON.stringify(payload),
        sourceSnapshotFloorId: input.sourceFloorId,
        liveHeadKey: this.buildLiveHeadItemKey(input.namespace, input.slot, definition.visibilityMode, host.id, input.branchId),
        createdAt: this.now(),
        updatedAt: this.now(),
      });
      return this.inflateMutation(mutation);
    });
  }

  stageVariableRerouteValue(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    sourceFloorId: string;
    sourcePageId: string;
    namespace: SessionStateNamespace;
    slot: string;
    value: unknown | null;
    present?: boolean;
    actorClientId?: string | null;
    sourceKind?: string | null;
    decisionReason?: string | null;
    decisionCode?: string | null;
    linkedVariableStageId: string | null;
    createdAt?: number;
  }, executor?: DbExecutor): SessionStateMutationView {
    if (!executor) {
      return this.executeTransaction((tx) => this.stageVariableRerouteValue(input, tx));
    }

    const tx = executor;
    const host = this.requireSessionHost(tx, input.accountId, input.sessionId, { requireActive: true });
    const definition = this.requireWritableSlotDefinition(host.accountId, host.id, input.namespace, input.slot);
    this.ensureWriteModeAllowed(definition, "commit_bound");
    const replaySafety = this.resolveReplaySafety(definition);
    const sourceFloor = this.requireFloorInSession(tx, host.id, input.sourceFloorId);
    this.requireFloorBranchMatch(sourceFloor, input.branchId, "Source floor");
    const binding = this.ensureManagedDomainBinding(tx, host.accountId, host.id, input.namespace);
    const payload = this.createMutationPayload({
      present: input.present ?? true,
      value: input.value,
    });
    this.assertPayloadWithinBudget(definition, payload);
    const mutation = this.sessionStateRepository(tx).createMutation({
      id: nanoid(),
      accountId: host.accountId,
      domainId: binding.domainId,
      stateNamespace: input.namespace,
      sourceKind: input.sourceKind ?? "variable_reroute",
      sessionId: host.id,
      branchId: input.branchId,
      sourceBranchId: input.branchId,
      sourceFloorId: input.sourceFloorId,
      sourcePageId: input.sourcePageId,
      targetSlot: input.slot,
      actorClientId: input.actorClientId ?? null,
      visibilityMode: definition.visibilityMode,
      writeMode: "commit_bound",
      commitMode: "variable_reroute",
      replaySafety,
      status: "staged",
      decisionStatus: "rerouted_to_session_state",
      decisionReason: input.decisionReason ?? null,
      decisionCode: input.decisionCode ?? "rerouted_to_session_state",
      payloadJson: JSON.stringify(payload),
      sourceSnapshotFloorId: input.sourceFloorId,
      liveHeadKey: this.buildLiveHeadItemKey(input.namespace, input.slot, definition.visibilityMode, host.id, input.branchId),
      linkedVariableStageId: input.linkedVariableStageId,
      createdAt: input.createdAt ?? this.now(),
      updatedAt: input.createdAt ?? this.now(),
    });
    return this.inflateMutation(mutation);
  }

  stageClientCommitBoundValue(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    sourceFloorId: string;
    sourcePageId?: string | null;
    actorClientId?: string | null;
    namespace: SessionStateNamespace;
    slot: string;
    value: unknown | null;
    present?: boolean;
    requestId?: string | null;
    runId?: string | null;
    operationLog?: SessionStateOperationLogContext;
    operationIndex?: number;
    operationCount?: number;
  }): SessionStateMutationView {
    return this.executeTransaction((tx) => {
      const host = this.requireSessionHost(tx, input.accountId, input.sessionId, { requireActive: true });
      const definition = this.requireWritableSlotDefinition(host.accountId, host.id, input.namespace, input.slot);
      this.ensureClientWritableCustomSlot(definition);
      this.ensureWriteModeAllowed(definition, "commit_bound");
      const replaySafety = this.resolveReplaySafety(definition);
      const sourceFloor = this.requireFloorInSession(tx, host.id, input.sourceFloorId);
      this.requireFloorBranchMatch(sourceFloor, input.branchId, "Source floor");
      const binding = this.ensureManagedDomainBinding(tx, host.accountId, host.id, input.namespace);
      const payload = this.createMutationPayload({
        present: input.present ?? true,
        value: input.value,
      });
      this.assertPayloadWithinBudget(definition, payload);
      const mutation = this.sessionStateRepository(tx).createMutation({
        id: nanoid(),
        accountId: host.accountId,
        domainId: binding.domainId,
        stateNamespace: input.namespace,
        sourceKind: "client_turn_write",
        sessionId: host.id,
        branchId: input.branchId,
        sourceBranchId: input.branchId,
        sourceFloorId: input.sourceFloorId,
        sourcePageId: input.sourcePageId ?? null,
        targetSlot: input.slot,
        actorClientId: input.actorClientId ?? null,
        visibilityMode: definition.visibilityMode,
        writeMode: "commit_bound",
        commitMode: "turn_bound",
        replaySafety,
        status: "staged",
        decisionStatus: "accepted",
        decisionReason: null,
        decisionCode: null,
        requestId: input.requestId ?? input.operationLog?.requestId ?? null,
        runId: input.runId ?? null,
        payloadJson: JSON.stringify(payload),
        sourceSnapshotFloorId: input.sourceFloorId,
        liveHeadKey: this.buildLiveHeadItemKey(input.namespace, input.slot, definition.visibilityMode, host.id, input.branchId),
        createdAt: this.now(),
        updatedAt: this.now(),
      });
      const inflatedMutation = this.inflateMutation(mutation);
      if (input.operationLog) {
        appendSessionStateOperationLog(tx, {
          ...input.operationLog,
          accountId: host.accountId,
          action: "stage_session_state_turn_write",
          sessionId: host.id,
          branchId: input.branchId,
          floorId: input.sourceFloorId,
          runId: input.runId ?? null,
          targetType: "session_state_value",
          targetId: buildSessionStateValueTargetId(host.id, input.branchId, input.namespace, input.slot),
          beforeRef: null,
          afterRef: toSessionStateValueOperationRef({
            sessionId: host.id,
            branchId: input.branchId,
            namespace: input.namespace,
            slot: input.slot,
            visibilityMode: definition.visibilityMode,
            schemaVersion: definition.schemaVersion,
            mutation: inflatedMutation,
            payload,
          }),
          metadata: {
            write_mode: "commit_bound",
            operation: payload.present ? "set" : "delete",
            request_write_index: input.operationIndex ?? null,
            request_write_count: input.operationCount ?? null,
          },
        });
      }
      return inflatedMutation;
    });
  }

  writeDirectValue(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    namespace: SessionStateNamespace;
    slot: string;
    value: unknown | null;
    present?: boolean;
    replaySafety?: SessionStateReplaySafety;
    requestId?: string | null;
    runId?: string | null;
    sourceFloorId?: string | null;
    operationLog?: SessionStateOperationLogContext;
  }): SessionStateMutationView {
    return this.executeTransaction((tx) => {
      const host = this.requireSessionHost(tx, input.accountId, input.sessionId, { requireActive: true });
      const definition = this.requireWritableSlotDefinition(host.accountId, host.id, input.namespace, input.slot);
      this.ensureWriteModeAllowed(definition, "direct");
      const replaySafety = this.resolveReplaySafety(definition, input.replaySafety);
      if (input.sourceFloorId) {
        this.requireFloorInSession(tx, host.id, input.sourceFloorId);
      }
      const binding = this.ensureManagedDomainBinding(tx, host.accountId, host.id, input.namespace);
      const payload = this.createMutationPayload({
        present: input.present ?? true,
        value: input.value,
      });
      const beforeLiveHead = input.operationLog
        ? this.getLiveHeadEnvelope(
            tx,
            host.accountId,
            binding.domainId,
            input.namespace,
            input.slot,
            definition.visibilityMode,
            host.id,
            input.branchId,
          )
        : null;
      this.assertPayloadWithinBudget(definition, payload);
      const mutation = this.sessionStateRepository(tx).createMutation({
        id: nanoid(),
        accountId: host.accountId,
        domainId: binding.domainId,
        stateNamespace: input.namespace,
        sourceKind: "client_direct_write",
        sessionId: host.id,
        branchId: input.branchId,
        sourceBranchId: input.branchId,
        sourceFloorId: input.sourceFloorId ?? null,
        sourcePageId: null,
        targetSlot: input.slot,
        actorClientId: null,
        visibilityMode: definition.visibilityMode,
        writeMode: "direct",
        commitMode: "direct_public",
        replaySafety,
        status: replaySafety === "uncertain" ? "uncertain" : "staged",
        decisionStatus: replaySafety === "uncertain" ? "blocked" : "accepted",
        decisionReason: replaySafety === "uncertain" ? "uncertain_replay_safety" : null,
        decisionCode: null,
        requestId: input.requestId ?? input.operationLog?.requestId ?? null,
        runId: input.runId ?? null,
        payloadJson: JSON.stringify(payload),
        sourceSnapshotFloorId: input.sourceFloorId ?? null,
        liveHeadKey: this.buildLiveHeadItemKey(input.namespace, input.slot, definition.visibilityMode, host.id, input.branchId),
        blockedReason: replaySafety === "uncertain" ? "uncertain_replay_safety" : null,
        createdAt: this.now(),
        updatedAt: this.now(),
      });

      if (replaySafety === "uncertain") {
        const inflatedMutation = this.inflateMutation(mutation);
        if (input.operationLog) {
          appendSessionStateOperationLog(tx, {
            ...input.operationLog,
            accountId: host.accountId,
            action: payload.present ? "write_session_state_value" : "delete_session_state_value",
            sessionId: host.id,
            branchId: input.branchId,
            floorId: input.sourceFloorId ?? null,
            runId: input.runId ?? null,
            targetType: "session_state_value",
            targetId: buildSessionStateValueTargetId(host.id, input.branchId, input.namespace, input.slot),
            beforeRef: toSessionStateValueOperationRef({
              sessionId: host.id,
              branchId: input.branchId,
              namespace: input.namespace,
              slot: input.slot,
              visibilityMode: definition.visibilityMode,
              schemaVersion: definition.schemaVersion,
              liveHead: beforeLiveHead,
            }),
            afterRef: toSessionStateValueOperationRef({
              sessionId: host.id,
              branchId: input.branchId,
              namespace: input.namespace,
              slot: input.slot,
              visibilityMode: definition.visibilityMode,
              schemaVersion: definition.schemaVersion,
              liveHead: beforeLiveHead,
              mutation: inflatedMutation,
              payload,
            }),
            metadata: buildDirectSessionStateOperationMetadata(payload.present, "uncertain"),
          });
        }
        this.appendGovernanceAudit(tx, host.accountId, binding, {
          action: "session_state.mutation.uncertain",
          targetType: "mutation",
          targetId: mutation.id,
          metadata: {
            slot: input.slot,
            namespace: input.namespace,
            branch_id: input.branchId,
            write_mode: "direct",
          },
        });
        return inflatedMutation;
      }

      const appliedMutation = this.applyDirectMutation(tx, binding, definition, mutation, payload, this.now());
      if (input.operationLog) {
        const afterLiveHead = this.getLiveHeadEnvelope(
          tx,
          host.accountId,
          binding.domainId,
          input.namespace,
          input.slot,
          definition.visibilityMode,
          host.id,
          input.branchId,
        );
        appendSessionStateOperationLog(tx, {
          ...input.operationLog,
          accountId: host.accountId,
          action: payload.present ? "write_session_state_value" : "delete_session_state_value",
          sessionId: host.id,
          branchId: input.branchId,
          floorId: input.sourceFloorId ?? null,
          runId: input.runId ?? null,
          targetType: "session_state_value",
          targetId: buildSessionStateValueTargetId(host.id, input.branchId, input.namespace, input.slot),
          beforeRef: toSessionStateValueOperationRef({
            sessionId: host.id,
            branchId: input.branchId,
            namespace: input.namespace,
            slot: input.slot,
            visibilityMode: definition.visibilityMode,
            schemaVersion: definition.schemaVersion,
            liveHead: beforeLiveHead,
          }),
          afterRef: toSessionStateValueOperationRef({
            sessionId: host.id,
            branchId: input.branchId,
            namespace: input.namespace,
            slot: input.slot,
            visibilityMode: definition.visibilityMode,
            schemaVersion: definition.schemaVersion,
            liveHead: afterLiveHead,
            mutation: appliedMutation,
            payload,
          }),
          metadata: buildDirectSessionStateOperationMetadata(payload.present, "applied"),
        });
      }
      this.appendGovernanceAudit(tx, host.accountId, binding, {
        action: "session_state.mutation.direct_apply",
        targetType: "mutation",
        targetId: appliedMutation.id,
        metadata: {
          slot: appliedMutation.targetSlot,
          namespace: appliedMutation.stateNamespace,
          branch_id: appliedMutation.branchId,
          source_floor_id: appliedMutation.sourceFloorId,
        },
      });
      return appliedMutation;
    });
  }

  discardStagedMutationsForFloor(input: {
    accountId: string;
    sessionId: string;
    floorId: string;
    reason: string;
  }): SessionStateMutationView[] {
    return this.executeTransaction((tx) => {
      this.requireSessionHost(tx, input.accountId, input.sessionId, { requireActive: false });
      this.requireFloorInSession(tx, input.sessionId, input.floorId);
      const mutations = this.sessionStateRepository(tx).listMutationsForSourceFloor(input.floorId, ["staged"]);
      return mutations.map((mutation) => {
        const updated = this.sessionStateRepository(tx).updateMutation({
          mutationId: mutation.id,
          status: "discarded",
          discardReason: input.reason,
          updatedAt: this.now(),
        });
        return this.inflateMutation(updated ?? mutation);
      });
    });
  }

  applyStagedMutationsForFloor(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    committedAt: number;
  }, executor?: DbExecutor): SessionStateApplyResult {
    if (!executor) {
      return this.executeTransaction((tx) => this.applyStagedMutationsForFloor(input, tx));
    }

    const tx = executor;
    const host = this.requireSessionHost(tx, input.accountId, input.sessionId, { requireActive: false });
    const floor = this.requireFloorInSession(tx, host.id, input.floorId);
    this.requireFloorBranchMatch(floor, input.branchId, "Commit floor");
    const managedBindings = this.clientDataRepository(tx).listManagedDomainsByHost({
      accountId: host.accountId,
      managerKind: SESSION_STATE_MANAGER_KIND,
      hostType: SESSION_STATE_HOST_TYPE,
      hostId: host.id,
    });
    const managedByNamespace = new Map<SessionStateNamespace, ClientDataManagedDomainRecord>(
      managedBindings.map((binding) => [binding.stateNamespace, binding]),
    );
    const stagedMutations = this.sessionStateRepository(tx).listMutationsForSourceFloor(input.floorId, ["staged"]);
    const appliedBySlot = new Map<string, { mutation: SessionStateMutationView; payload: SessionStateMutationPayload }>();
    const appliedMutations: SessionStateMutationView[] = [];

    for (const mutationBase of stagedMutations) {
      const definition = this.requireWritableSlotDefinition(host.accountId, host.id, mutationBase.stateNamespace, mutationBase.targetSlot);
      this.assertStagedMutationCommitContext(floor, definition, mutationBase);
      const payload = this.parseMutationPayload(mutationBase.payloadJson);
      if (mutationBase.replaySafety === "uncertain") {
        this.sessionStateRepository(tx).updateMutation({
          mutationId: mutationBase.id,
          status: "uncertain",
          decisionStatus: "blocked",
          decisionReason: "uncertain_replay_safety",
          decisionCode: null,
          blockedReason: "uncertain_replay_safety",
          updatedAt: input.committedAt,
        });
        throw new SessionStateServiceError(
          409,
          "session_state_replay_uncertain",
          `Session state mutation '${mutationBase.id}' is uncertain and cannot be auto-applied during commit`,
        );
      }

      const binding = managedByNamespace.get(mutationBase.stateNamespace)
        ?? this.ensureManagedDomainBinding(tx, host.accountId, host.id, mutationBase.stateNamespace);
      const applied = this.applyDirectMutation(tx, binding, definition, mutationBase, payload, input.committedAt);
      appliedMutations.push(applied);
      appliedBySlot.set(this.toSlotMapKey(mutationBase.stateNamespace, mutationBase.targetSlot), {
        mutation: applied,
        payload,
      });
    }

    const snapshots: SessionStateFloorSnapshotView[] = [];
    for (const binding of managedByNamespace.values()) {
      const definitions = this.listSlotDefinitionsForSession(host.accountId, host.id, binding.stateNamespace);
      for (const definition of definitions) {
        const snapshot = this.materializeFloorSnapshotForSlot(tx, {
          accountId: host.accountId,
          binding,
          floor,
          definition,
          branchId: input.branchId,
          committedAt: input.committedAt,
          appliedBySlot,
        });
        snapshots.push(snapshot);
      }
    }

    return {
      mutations: appliedMutations,
      snapshots,
    };
  }

  releaseManagedDomainsForSession(input: {
    accountId: string;
    sessionId: string;
    actor?: ClientDataAuditActor;
  }, executor?: DbExecutor): string[] {
    if (!executor) {
      return this.executeTransaction((tx) => this.releaseManagedDomainsForSession(input, tx));
    }

    const tx = executor;
    const host = this.requireSessionHost(tx, input.accountId, input.sessionId, { requireActive: false });
    const bindings = this.clientDataRepository(tx).listManagedDomainsByHost({
      accountId: host.accountId,
      managerKind: SESSION_STATE_MANAGER_KIND,
      hostType: SESSION_STATE_HOST_TYPE,
      hostId: host.id,
    });
    const clientDataRepository = this.clientDataRepository(tx);
    const clientDataService = this.getClientDataService(tx);
    const releasedDomainIds: string[] = [];
    const releasedDomainIdSet = new Set<string>();
    const actor = input.actor ?? { actorType: "system:session_state", actorId: host.id };

    for (const binding of bindings) {
      if (releasedDomainIdSet.has(binding.domainId)) {
        continue;
      }
      const domain = clientDataRepository.getDomainById(binding.domainId);
      if (!domain || domain.status === "deleted") {
        continue;
      }
      clientDataService.deleteDomain(
        host.accountId,
        binding.domainId,
        actor,
        `session-state-host-delete:${host.id}:${binding.stateNamespace}`,
      );
      releasedDomainIdSet.add(binding.domainId);
      releasedDomainIds.push(binding.domainId);
    }

    return releasedDomainIds;
  }

  resolveLiveValue(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    namespace: SessionStateNamespace;
    slot: string;
    sourceFloorId?: string;
  }): SessionStateResolvedValue | null {
    this.requireSessionHost(this.db, input.accountId, input.sessionId, { requireActive: false });
    if (input.sourceFloorId) {
      this.requireFloorInSession(this.db, input.sessionId, input.sourceFloorId);
    }

    const definition = this.resolveReadableSlotDefinition(input.accountId, input.sessionId, input.namespace, input.slot);
    if (!definition) {
      return null;
    }

    const binding = this.findManagedDomainBinding(this.db, input.accountId, input.sessionId, input.namespace);
    if (!binding) {
      return null;
    }

    if (input.sourceFloorId) {
      const historicalSnapshot = this.getFloorSnapshot({
        accountId: input.accountId,
        sessionId: input.sessionId,
        floorId: input.sourceFloorId,
        namespace: input.namespace,
        slot: input.slot,
      });
      if (historicalSnapshot) {
        return {
          namespace: historicalSnapshot.namespace,
          slot: historicalSnapshot.slot,
          source: "source_floor_snapshot",
          visibilityMode: historicalSnapshot.visibilityMode,
          schemaVersion: historicalSnapshot.schemaVersion,
          present: historicalSnapshot.present,
          value: historicalSnapshot.value,
          sessionId: historicalSnapshot.sessionId,
          branchId: historicalSnapshot.branchId,
          floorId: historicalSnapshot.floorId,
          sourceMutationIds: historicalSnapshot.sourceMutationIds,
          updatedAt: historicalSnapshot.committedAt,
        };
      }
    }

    const liveHead = this.getLiveHeadEnvelope(
      this.db,
      input.accountId,
      binding.domainId,
      input.namespace,
      input.slot,
      definition.visibilityMode,
      input.sessionId,
      input.branchId,
    );
    if (liveHead) {
      return {
        namespace: input.namespace,
        slot: input.slot,
        source: "live_head",
        visibilityMode: definition.visibilityMode,
        schemaVersion: liveHead.schemaVersion,
        present: liveHead.present,
        value: liveHead.value,
        sessionId: liveHead.sessionId,
        branchId: liveHead.branchId ?? input.branchId,
        floorId: liveHead.sourceFloorId,
        sourceMutationIds: liveHead.lastMutationId ? [liveHead.lastMutationId] : [],
        updatedAt: liveHead.updatedAt,
      };
    }

    const latestBranchFloor = this.sessionStateRepository(this.db).getLatestCommittedFloorInBranch(input.sessionId, input.branchId);
    if (latestBranchFloor) {
      const snapshot = this.getFloorSnapshot({
        accountId: input.accountId,
        sessionId: input.sessionId,
        floorId: latestBranchFloor.id,
        namespace: input.namespace,
        slot: input.slot,
      });
      if (snapshot) {
        return {
          namespace: snapshot.namespace,
          slot: snapshot.slot,
          source: "latest_branch_snapshot",
          visibilityMode: snapshot.visibilityMode,
          schemaVersion: snapshot.schemaVersion,
          present: snapshot.present,
          value: snapshot.value,
          sessionId: snapshot.sessionId,
          branchId: snapshot.branchId,
          floorId: snapshot.floorId,
          sourceMutationIds: snapshot.sourceMutationIds,
          updatedAt: snapshot.committedAt,
        };
      }
    }

    if (definition.visibilityMode === "session_shared" && input.branchId !== "main") {
      const latestMainFloor = this.sessionStateRepository(this.db).getLatestCommittedFloorInBranch(input.sessionId, "main");
      if (latestMainFloor) {
        const snapshot = this.getFloorSnapshot({
          accountId: input.accountId,
          sessionId: input.sessionId,
          floorId: latestMainFloor.id,
          namespace: input.namespace,
          slot: input.slot,
        });
        if (snapshot) {
          return {
            namespace: snapshot.namespace,
            slot: snapshot.slot,
            source: "latest_main_snapshot",
            visibilityMode: snapshot.visibilityMode,
            schemaVersion: snapshot.schemaVersion,
            present: snapshot.present,
            value: snapshot.value,
            sessionId: snapshot.sessionId,
            branchId: snapshot.branchId,
            floorId: snapshot.floorId,
            sourceMutationIds: snapshot.sourceMutationIds,
            updatedAt: snapshot.committedAt,
          };
        }
      }
    }

    return null;
  }

  getFloorSnapshot(input: {
    accountId: string;
    sessionId: string;
    floorId: string;
    namespace: SessionStateNamespace;
    slot: string;
  }): SessionStateFloorSnapshotView | null {
    this.requireSessionHost(this.db, input.accountId, input.sessionId, { requireActive: false });
    this.requireFloorInSession(this.db, input.sessionId, input.floorId);
    if (!this.resolveReadableSlotDefinition(input.accountId, input.sessionId, input.namespace, input.slot)) {
      return null;
    }

    const binding = this.findManagedDomainBinding(this.db, input.accountId, input.sessionId, input.namespace);
    if (!binding) {
      return null;
    }

    const item = this.getInternalItemByKeyOrNull(this.db, {
      accountId: input.accountId,
      domainId: binding.domainId,
      collectionName: SESSION_STATE_SNAPSHOT_COLLECTION,
      itemKey: this.buildSnapshotItemKey(input.namespace, input.slot, input.floorId),
    });
    if (!item) {
      return null;
    }

    return this.parseFloorSnapshotEnvelope(item.valueJson);
  }

  diffFloorSnapshots(input: {
    accountId: string;
    sessionId: string;
    leftFloorId: string;
    rightFloorId: string;
    namespace?: SessionStateNamespace;
  }): SessionStateDiffEntry[] {
    this.requireSessionHost(this.db, input.accountId, input.sessionId, { requireActive: false });
    this.requireFloorInSession(this.db, input.sessionId, input.leftFloorId);
    this.requireFloorInSession(this.db, input.sessionId, input.rightFloorId);

    const definitions = this.listSlotDefinitionsForSession(input.accountId, input.sessionId, input.namespace);
    return definitions.map((definition) => {
      const left = this.getFloorSnapshot({
        accountId: input.accountId,
        sessionId: input.sessionId,
        floorId: input.leftFloorId,
        namespace: definition.namespace,
        slot: definition.slot,
      });
      const right = this.getFloorSnapshot({
        accountId: input.accountId,
        sessionId: input.sessionId,
        floorId: input.rightFloorId,
        namespace: definition.namespace,
        slot: definition.slot,
      });
      return this.toDiffEntry(definition.namespace, definition.slot, left, right);
    });
  }

  diffLiveAgainstFloor(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    namespace?: SessionStateNamespace;
  }): SessionStateDiffEntry[] {
    this.requireSessionHost(this.db, input.accountId, input.sessionId, { requireActive: false });
    this.requireFloorInSession(this.db, input.sessionId, input.floorId);

    const definitions = this.listSlotDefinitionsForSession(input.accountId, input.sessionId, input.namespace);
    return definitions.map((definition) => {
      const live = this.resolveLiveValue({
        accountId: input.accountId,
        sessionId: input.sessionId,
        branchId: input.branchId,
        namespace: definition.namespace,
        slot: definition.slot,
      });
      const snapshot = this.getFloorSnapshot({
        accountId: input.accountId,
        sessionId: input.sessionId,
        floorId: input.floorId,
        namespace: definition.namespace,
        slot: definition.slot,
      });
      const left = live
        ? {
            namespace: live.namespace,
            slot: live.slot,
            visibilityMode: live.visibilityMode,
            schemaVersion: live.schemaVersion,
            present: live.present,
            value: live.value,
            sessionId: live.sessionId,
            branchId: live.branchId,
            floorId: live.floorId ?? input.floorId,
            sourceMutationIds: live.sourceMutationIds,
            committedAt: live.updatedAt,
          }
        : null;
      return this.toDiffEntry(definition.namespace, definition.slot, left, snapshot);
    });
  }

  restoreFloorSnapshot(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    namespace: SessionStateNamespace;
    slot: string;
    writeMode?: SessionStateWriteMode;
    requestId?: string | null;
    runId?: string | null;
  }): SessionStateMutationView {
    const snapshot = this.getFloorSnapshot({
      accountId: input.accountId,
      sessionId: input.sessionId,
      floorId: input.floorId,
      namespace: input.namespace,
      slot: input.slot,
    });
    if (!snapshot) {
      throw new SessionStateServiceError(404, "session_state_snapshot_not_found", `Floor snapshot '${input.floorId}' does not exist for slot '${input.namespace}/${input.slot}'`);
    }

    if ((input.writeMode ?? "direct") === "commit_bound") {
      return this.stageCommitBoundValue({
        accountId: input.accountId,
        sessionId: input.sessionId,
        branchId: input.branchId,
        sourceFloorId: input.floorId,
        namespace: input.namespace,
        slot: input.slot,
        value: snapshot.value,
        present: snapshot.present,
        requestId: input.requestId ?? null,
        runId: input.runId ?? null,
      });
    }

    return this.writeDirectValue({
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      namespace: input.namespace,
      slot: input.slot,
      value: snapshot.value,
      present: snapshot.present,
      requestId: input.requestId ?? null,
      runId: input.runId ?? null,
      sourceFloorId: input.floorId,
    });
  }

  evaluateReplaySafetyForFloor(input: {
    accountId: string;
    sessionId: string;
    floorId: string;
    confirmedMutationIds?: string[];
  }): SessionStateReplayEvaluation {
    this.requireSessionHost(this.db, input.accountId, input.sessionId, { requireActive: false });
    this.requireFloorInSession(this.db, input.sessionId, input.floorId);
    const confirmedMutationIds = new Set(input.confirmedMutationIds ?? []);
    const mutations = this.sessionStateRepository(this.db)
      .listMutationsForSourceFloor(input.floorId, ["applied", "blocked", "uncertain"])
      .map((mutation) => this.inflateMutation(mutation));

    const blockers: SessionStateReplayEvaluation["blockers"] = [];
    for (const mutation of mutations) {
      if (mutation.status === "blocked") {
        blockers.push({
          mutationId: mutation.id,
          stateNamespace: mutation.stateNamespace,
          targetSlot: mutation.targetSlot,
          replaySafety: mutation.replaySafety,
          status: mutation.status,
          reason: "blocked",
        });
        continue;
      }
      if (mutation.status === "uncertain" || mutation.replaySafety === "uncertain") {
        blockers.push({
          mutationId: mutation.id,
          stateNamespace: mutation.stateNamespace,
          targetSlot: mutation.targetSlot,
          replaySafety: mutation.replaySafety,
          status: mutation.status,
          reason: "uncertain",
        });
        continue;
      }
      if (mutation.replaySafety === "never_auto_replay") {
        blockers.push({
          mutationId: mutation.id,
          stateNamespace: mutation.stateNamespace,
          targetSlot: mutation.targetSlot,
          replaySafety: mutation.replaySafety,
          status: mutation.status,
          reason: "never_auto_replay",
        });
        continue;
      }
      if (mutation.replaySafety === "confirm_on_replay" && !confirmedMutationIds.has(mutation.id)) {
        blockers.push({
          mutationId: mutation.id,
          stateNamespace: mutation.stateNamespace,
          targetSlot: mutation.targetSlot,
          replaySafety: mutation.replaySafety,
          status: mutation.status,
          reason: "confirmation_required",
        });
      }
    }

    return {
      allowed: blockers.length === 0,
      blockers,
    };
  }

  private applyDirectMutation(
    tx: AppDb | DbExecutor,
    binding: ClientDataManagedDomainRecord,
    definition: SessionStateSlotDefinition,
    mutation: SessionStateMutationView,
    payload: SessionStateMutationPayload,
    appliedAt: number,
  ): SessionStateMutationView {
    const liveHeadKey = mutation.liveHeadKey
      ?? this.buildLiveHeadItemKey(
        mutation.stateNamespace,
        mutation.targetSlot,
        definition.visibilityMode,
        mutation.sessionId,
        mutation.branchId,
      );
    const liveHeadEnvelope: SessionStateLiveHeadEnvelope = {
      kind: "live_head",
      namespace: mutation.stateNamespace,
      slot: mutation.targetSlot,
      sessionId: mutation.sessionId,
      branchId: definition.visibilityMode === "session_shared" ? null : mutation.branchId,
      visibilityMode: definition.visibilityMode,
      schemaVersion: definition.schemaVersion,
      present: payload.present,
      value: payload.value,
      lastMutationId: mutation.id,
      sourceFloorId: mutation.sourceFloorId,
      updatedAt: appliedAt,
    };

    try {
      this.getClientDataService(tx).upsertItem({
        accountId: mutation.accountId,
        domainId: binding.domainId,
        collectionName: SESSION_STATE_LIVE_COLLECTION,
        itemKey: liveHeadKey,
        valueJson: liveHeadEnvelope,
      });
    } catch (error) {
      this.throwMappedClientDataStorageError(error, definition.namespace, definition.slot);
    }

    const updated = this.sessionStateRepository(tx).updateMutation({
      mutationId: mutation.id,
      status: "applied",
      liveHeadKey,
      updatedAt: appliedAt,
      appliedAt,
    });

    if (!updated) {
      throw new SessionStateServiceError(500, "session_state_mutation_not_found", `Session state mutation '${mutation.id}' disappeared while applying`);
    }

    return this.inflateMutation(updated);
  }

  private materializeFloorSnapshotForSlot(
    tx: AppDb | DbExecutor,
    input: {
      accountId: string;
      binding: ClientDataManagedDomainRecord;
      floor: SessionStateFloorHostRecord;
      definition: SessionStateSlotDefinition;
      branchId: string;
      committedAt: number;
      appliedBySlot: Map<string, { mutation: SessionStateMutationView; payload: SessionStateMutationPayload }>;
    },
  ): SessionStateFloorSnapshotView {
    const slotMapKey = this.toSlotMapKey(input.definition.namespace, input.definition.slot);
    const applied = input.appliedBySlot.get(slotMapKey);
    const currentLiveHead = this.getLiveHeadEnvelope(
      tx,
      input.accountId,
      input.binding.domainId,
      input.definition.namespace,
      input.definition.slot,
      input.definition.visibilityMode,
      input.floor.sessionId,
      input.branchId,
    );
    const parentSnapshot = input.floor.parentFloorId
      ? this.getFloorSnapshotFromStorage(tx, {
          accountId: input.accountId,
          domainId: input.binding.domainId,
          floorId: input.floor.parentFloorId,
          namespace: input.definition.namespace,
          slot: input.definition.slot,
        })
      : null;

    const snapshotEnvelope: SessionStateFloorSnapshotEnvelope = {
      kind: "floor_snapshot",
      namespace: input.definition.namespace,
      slot: input.definition.slot,
      sessionId: input.floor.sessionId,
      branchId: input.floor.branchId,
      floorId: input.floor.id,
      visibilityMode: input.definition.visibilityMode,
      schemaVersion: input.definition.schemaVersion,
      present: false,
      value: null,
      sourceMutationIds: [],
      committedAt: input.committedAt,
    };

    if (applied) {
      snapshotEnvelope.present = applied.payload.present;
      snapshotEnvelope.value = applied.payload.value;
      snapshotEnvelope.sourceMutationIds = [applied.mutation.id];
    } else if (currentLiveHead && (!parentSnapshot || currentLiveHead.updatedAt >= parentSnapshot.committedAt)) {
      snapshotEnvelope.present = currentLiveHead.present;
      snapshotEnvelope.value = currentLiveHead.value;
      snapshotEnvelope.sourceMutationIds = currentLiveHead.lastMutationId ? [currentLiveHead.lastMutationId] : [];
    } else if (parentSnapshot) {
      snapshotEnvelope.present = parentSnapshot.present;
      snapshotEnvelope.value = parentSnapshot.value;
      snapshotEnvelope.sourceMutationIds = [...parentSnapshot.sourceMutationIds];
    } else if (currentLiveHead) {
      snapshotEnvelope.present = currentLiveHead.present;
      snapshotEnvelope.value = currentLiveHead.value;
      snapshotEnvelope.sourceMutationIds = currentLiveHead.lastMutationId ? [currentLiveHead.lastMutationId] : [];
    }

    try {
      this.getClientDataService(tx).upsertItem({
        accountId: input.accountId,
        domainId: input.binding.domainId,
        collectionName: SESSION_STATE_SNAPSHOT_COLLECTION,
        itemKey: this.buildSnapshotItemKey(input.definition.namespace, input.definition.slot, input.floor.id),
        valueJson: snapshotEnvelope,
      });
    } catch (error) {
      this.throwMappedClientDataStorageError(error, input.definition.namespace, input.definition.slot);
    }

    return {
      namespace: snapshotEnvelope.namespace,
      slot: snapshotEnvelope.slot,
      visibilityMode: snapshotEnvelope.visibilityMode,
      schemaVersion: snapshotEnvelope.schemaVersion,
      present: snapshotEnvelope.present,
      value: snapshotEnvelope.value,
      sessionId: snapshotEnvelope.sessionId,
      branchId: snapshotEnvelope.branchId,
      floorId: snapshotEnvelope.floorId,
      sourceMutationIds: snapshotEnvelope.sourceMutationIds,
      committedAt: snapshotEnvelope.committedAt,
    };
  }

  private findManagedDomainBinding(
    executor: AppDb | DbExecutor,
    accountId: string,
    sessionId: string,
    namespace: SessionStateNamespace,
  ): ClientDataManagedDomainRecord | null {
    return this.clientDataRepository(executor).getManagedDomainByHost({
      accountId,
      managerKind: SESSION_STATE_MANAGER_KIND,
      hostType: SESSION_STATE_HOST_TYPE,
      hostId: sessionId,
      stateNamespace: namespace,
    });
  }

  private ensureManagedDomainBinding(
    executor: AppDb | DbExecutor,
    accountId: string,
    sessionId: string,
    namespace: SessionStateNamespace,
  ): ClientDataManagedDomainRecord {
    const existingBinding = this.findManagedDomainBinding(executor, accountId, sessionId, namespace);
    if (existingBinding) {
      return existingBinding;
    }

    const clientDataRepository = this.clientDataRepository(executor);
    const clientDataService = this.getClientDataService(executor);
    const domainName = this.buildManagedDomainName(sessionId, namespace);
    let domain = clientDataRepository.getDomainByOwnerName({
      accountId,
      ownerType: this.managedOwnerType,
      ownerId: this.managedOwnerId,
      domainName,
    });

    if (!domain) {
      try {
        domain = clientDataService.createDomain({
          accountId,
          ownerType: this.managedOwnerType,
          ownerId: this.managedOwnerId,
          domainName,
          displayName: `Session State ${namespace}`,
          description: `Managed session state backing domain for session '${sessionId}' and namespace '${namespace}'`,
          actor: { actorType: "system:session_state", actorId: sessionId },
          requestId: `session-state-bootstrap:${sessionId}:${namespace}`,
        });
      } catch (error) {
        if (error instanceof ClientDataServiceError && error.code === "client_data_domain_name_conflict") {
          domain = clientDataRepository.getDomainByOwnerName({
            accountId,
            ownerType: this.managedOwnerType,
            ownerId: this.managedOwnerId,
            domainName,
          });
          if (!domain) {
            throw error;
          }
        } else {
          this.throwMappedClientDataStorageError(error, namespace);
        }
      }
    }

    this.ensureInternalCollections(executor, accountId, domain.id);

    return clientDataRepository.upsertManagedDomain({
      domainId: domain.id,
      accountId,
      managerKind: SESSION_STATE_MANAGER_KIND,
      hostType: SESSION_STATE_HOST_TYPE,
      hostId: sessionId,
      stateNamespace: namespace,
      requireCallerOwner: true,
      allowAutoCreateCollection: false,
      createdAt: this.now(),
      updatedAt: this.now(),
    });
  }

  private ensureInternalCollections(
    executor: AppDb | DbExecutor,
    accountId: string,
    domainId: string,
  ): void {
    this.ensureCollection(executor, accountId, domainId, SESSION_STATE_LIVE_COLLECTION);
    this.ensureCollection(executor, accountId, domainId, SESSION_STATE_SNAPSHOT_COLLECTION);
  }

  private ensureCollection(
    executor: AppDb | DbExecutor,
    accountId: string,
    domainId: string,
    collectionName: string,
  ): void {
    const repository = this.clientDataRepository(executor);
    const existing = repository.getCollectionByDomainName(domainId, collectionName);
    if (existing) {
      return;
    }

    try {
      this.getClientDataService(executor).createCollection({
        accountId,
        domainId,
        collectionName,
        description: `Managed session state internal collection '${collectionName}'`,
      });
    } catch (error) {
      if (error instanceof ClientDataServiceError && error.code === "client_data_collection_name_conflict") {
        return;
      }
      throw error;
    }
  }

  private requireSessionHost(
    executor: AppDb | DbExecutor,
    accountId: string,
    sessionId: string,
    options: { requireActive: boolean },
  ) {
    const session = this.sessionStateRepository(executor).getSessionById(sessionId);
    if (!session || session.accountId !== accountId) {
      throw new SessionStateServiceError(404, "session_state_host_not_found", `Session '${sessionId}' was not found for session state governance`);
    }
    if (options.requireActive && session.status !== "active") {
      throw new SessionStateServiceError(409, "session_state_host_archived", `Session '${sessionId}' is archived and cannot accept live state writes`);
    }
    return session;
  }

  private requireFloorInSession(
    executor: AppDb | DbExecutor,
    sessionId: string,
    floorId: string,
  ): SessionStateFloorHostRecord {
    const floor = this.sessionStateRepository(executor).getFloorById(floorId);
    if (!floor || floor.sessionId !== sessionId) {
      throw new SessionStateServiceError(404, "session_state_floor_not_found", `Floor '${floorId}' was not found in session '${sessionId}'`);
    }
    return floor;
  }

  private requireFloorBranchMatch(
    floor: SessionStateFloorHostRecord,
    branchId: string,
    label: string,
  ): SessionStateFloorHostRecord {
    if (floor.branchId !== branchId) {
      throw new SessionStateServiceError(
        409,
        "session_state_floor_branch_mismatch",
        `${label} '${floor.id}' belongs to branch '${floor.branchId}', expected '${branchId}'`,
      );
    }

    return floor;
  }

  private assertStagedMutationCommitContext(
    floor: SessionStateFloorHostRecord,
    definition: SessionStateSlotDefinition,
    mutation: SessionStateMutationView,
  ): void {
    const expectedLiveHeadKey = this.buildLiveHeadItemKey(
      definition.namespace,
      definition.slot,
      definition.visibilityMode,
      floor.sessionId,
      floor.branchId,
    );

    if (
      mutation.sessionId !== floor.sessionId
      || mutation.branchId !== floor.branchId
      || mutation.sourceFloorId !== floor.id
      || mutation.sourceSnapshotFloorId !== floor.id
      || mutation.liveHeadKey !== expectedLiveHeadKey
    ) {
      throw new SessionStateServiceError(
        409,
        "session_state_staged_mutation_context_mismatch",
        `Staged mutation '${mutation.id}' does not match commit context for floor '${floor.id}' in branch '${floor.branchId}'`,
      );
    }
  }

  private getFloorSnapshotFromStorage(
    executor: AppDb | DbExecutor,
    input: {
      accountId: string;
      domainId: string;
      floorId: string;
      namespace: SessionStateNamespace;
      slot: string;
    },
  ): SessionStateFloorSnapshotView | null {
    const item = this.getInternalItemByKeyOrNull(executor, {
      accountId: input.accountId,
      domainId: input.domainId,
      collectionName: SESSION_STATE_SNAPSHOT_COLLECTION,
      itemKey: this.buildSnapshotItemKey(input.namespace, input.slot, input.floorId),
    });
    return item ? this.parseFloorSnapshotEnvelope(item.valueJson) : null;
  }

  private getLiveHeadEnvelope(
    executor: AppDb | DbExecutor,
    accountId: string,
    domainId: string,
    namespace: SessionStateNamespace,
    slot: string,
    visibilityMode: SessionStateVisibilityMode,
    sessionId: string,
    branchId: string,
  ): SessionStateLiveHeadEnvelope | null {
    const item = this.getInternalItemByKeyOrNull(executor, {
      accountId,
      domainId,
      collectionName: SESSION_STATE_LIVE_COLLECTION,
      itemKey: this.buildLiveHeadItemKey(namespace, slot, visibilityMode, sessionId, branchId),
    });
    return item ? this.parseLiveHeadEnvelope(item.valueJson) : null;
  }

  private getInternalItemByKeyOrNull(
    executor: AppDb | DbExecutor,
    input: {
      accountId: string;
      domainId: string;
      collectionName: string;
      itemKey: string;
    },
  ): ClientDataItemRecord | null {
    try {
      return this.getClientDataService(executor).getItemByKey({
        accountId: input.accountId,
        domainId: input.domainId,
        collectionName: input.collectionName,
        itemKey: input.itemKey,
      });
    } catch (error) {
      if (error instanceof ClientDataServiceError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 解析 live head item 的 json payload 为结构化 envelope。
   * 公开给同一模块内的观察面 facade 使用，保证解析行为只有一份实现。
   */
  parseLiveHeadEnvelope(valueJson: string): SessionStateLiveHeadEnvelope | null {
    const record = asRecord(parseJsonField(valueJson));
    if (!record) {
      return null;
    }
    return {
      kind: "live_head",
      namespace: String(record.namespace) as SessionStateNamespace,
      slot: String(record.slot),
      sessionId: String(record.sessionId),
      branchId: typeof record.branchId === "string" ? record.branchId : null,
      visibilityMode: String(record.visibilityMode) as SessionStateVisibilityMode,
      schemaVersion: Number(record.schemaVersion ?? 1),
      present: Boolean(record.present),
      value: record.value ?? null,
      lastMutationId: typeof record.lastMutationId === "string" ? record.lastMutationId : null,
      sourceFloorId: typeof record.sourceFloorId === "string" ? record.sourceFloorId : null,
      updatedAt: Number(record.updatedAt ?? 0),
    };
  }

  /**
   * 解析 floor snapshot item 的 json payload 为结构化 view。
   * 公开给同一模块内的观察面 facade 使用，保证解析行为只有一份实现。
   */
  parseFloorSnapshotEnvelope(valueJson: string): SessionStateFloorSnapshotView | null {
    const record = asRecord(parseJsonField(valueJson));
    if (!record) {
      return null;
    }
    return {
      namespace: String(record.namespace) as SessionStateNamespace,
      slot: String(record.slot),
      visibilityMode: String(record.visibilityMode) as SessionStateVisibilityMode,
      schemaVersion: Number(record.schemaVersion ?? 1),
      present: Boolean(record.present),
      value: record.value ?? null,
      sessionId: String(record.sessionId),
      branchId: String(record.branchId),
      floorId: String(record.floorId),
      sourceMutationIds: Array.isArray(record.sourceMutationIds) ? record.sourceMutationIds.filter((entry): entry is string => typeof entry === "string") : [],
      committedAt: Number(record.committedAt ?? 0),
    };
  }

  /**
   * 解析 mutation 存储时的 json payload 为结构化 payload。
   * 公开给同一模块内的观察面 facade 使用，保证解析行为只有一份实现。
   */
  parseMutationPayload(payload: SessionStateMutationView["payload"] | string): SessionStateMutationPayload {
    if (typeof payload === "string") {
      const parsed = asRecord(parseJsonField(payload));
      return {
        present: parsed?.present !== false,
        value: parsed?.value ?? null,
      };
    }
    return {
      present: payload.present !== false,
      value: payload.value ?? null,
    };
  }

  private inflateMutation(mutation: SessionStateMutationView): SessionStateMutationView {
    return {
      ...mutation,
      payload: this.parseMutationPayload(mutation.payloadJson),
    };
  }

  private createMutationPayload(input: { present: boolean; value: unknown | null }): SessionStateMutationPayload {
    return {
      present: input.present,
      value: input.value ?? null,
    };
  }

  private requireSlotDefinition(namespace: SessionStateNamespace, slot: string): SessionStateSlotDefinition {
    try {
      return this.slotRegistry.require(namespace, slot);
    } catch {
      throw new SessionStateServiceError(404, "session_state_slot_not_registered", `Session state slot '${namespace}/${slot}' is not registered`);
    }
  }

  private listSlotDefinitionsForSession(
    accountId: string,
    sessionId: string,
    namespace?: SessionStateNamespace,
  ): SessionStateSlotDefinition[] {
    return [
      ...this.slotRegistry.list(namespace),
      ...(this.customNamespaceService?.listMaterializedSlotDefinitions(accountId, sessionId, namespace) ?? []),
    ].sort((left, right) => {
      const namespaceOrder = left.namespace.localeCompare(right.namespace);
      return namespaceOrder !== 0 ? namespaceOrder : left.slot.localeCompare(right.slot);
    });
  }

  private resolveReadableSlotDefinition(
    accountId: string,
    sessionId: string,
    namespace: SessionStateNamespace,
    slot: string,
  ): SessionStateSlotDefinition | null {
    const builtInDefinition = this.slotRegistry.get(namespace, slot);
    if (builtInDefinition) {
      return builtInDefinition;
    }
    if (this.isBuiltInNamespace(namespace)) {
      throw new SessionStateServiceError(404, "session_state_slot_not_registered", `Session state slot '${namespace}/${slot}' is not registered`);
    }
    return this.customNamespaceService?.getMaterializedSlotDefinition(accountId, sessionId, namespace, slot) ?? null;
  }

  private requireWritableSlotDefinition(
    accountId: string,
    sessionId: string,
    namespace: SessionStateNamespace,
    slot: string,
  ): SessionStateSlotDefinition {
    const builtInDefinition = this.slotRegistry.get(namespace, slot);
    if (builtInDefinition) {
      return builtInDefinition;
    }
    if (this.isBuiltInNamespace(namespace)) {
      throw new SessionStateServiceError(404, "session_state_slot_not_registered", `Session state slot '${namespace}/${slot}' is not registered`);
    }
    const customDefinition = this.customNamespaceService?.resolveWritableSlotDefinition(accountId, sessionId, namespace, slot);
    if (customDefinition) {
      return customDefinition;
    }
    throw new SessionStateServiceError(404, "session_state_namespace_not_registered", `Session state namespace '${namespace}' is not registered for session '${sessionId}'`);
  }

  private resolveReplaySafety(
    definition: SessionStateSlotDefinition,
    requestedReplaySafety?: SessionStateReplaySafety,
  ): SessionStateReplaySafety {
    const replaySafety = requestedReplaySafety ?? definition.defaultReplaySafety;
    if (this.getReplaySafetyRank(replaySafety) < this.getReplaySafetyRank(definition.defaultReplaySafety)) {
      throw new SessionStateServiceError(
        409,
        "session_state_replay_safety_loosening_forbidden",
        `Replay safety '${replaySafety}' cannot be looser than the slot default '${definition.defaultReplaySafety}'`,
      );
    }
    return replaySafety;
  }

  private ensureWriteModeAllowed(definition: SessionStateSlotDefinition, writeMode: SessionStateWriteMode): void {
    if (writeMode === definition.defaultWriteMode) {
      return;
    }
    if (definition.publicExposure.capabilities.allowedWriteModes.includes(writeMode)) {
      return;
    }
    if (definition.defaultWriteMode === "commit_bound" && writeMode === "direct") {
      return;
    }
    throw new SessionStateServiceError(
      409,
      "session_state_write_mode_forbidden",
      `Write mode '${writeMode}' is not allowed for slot '${definition.namespace}/${definition.slot}'`,
    );
  }

  private ensureClientWritableCustomSlot(definition: SessionStateSlotDefinition): void {
    if (
      definition.publicExposure.ownerKind === "custom"
      && definition.publicExposure.capabilities.clientWritable === true
    ) {
      return;
    }
    throw new SessionStateServiceError(
      409,
      "session_state_public_write_forbidden",
      `Client write is forbidden for slot '${definition.namespace}/${definition.slot}'`,
    );
  }

  private getReplaySafetyRank(replaySafety: SessionStateReplaySafety): number {
    switch (replaySafety) {
      case "safe":
        return 0;
      case "confirm_on_replay":
        return 1;
      case "never_auto_replay":
        return 2;
      case "uncertain":
        return 3;
    }
  }

  private assertPayloadWithinBudget(definition: SessionStateSlotDefinition, payload: SessionStateMutationPayload): void {
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf-8");
    if (bytes > definition.sizeBudgetBytes) {
      throw new SessionStateServiceError(
        409,
        "session_state_payload_too_large",
        `Session state payload for slot '${definition.namespace}/${definition.slot}' exceeds its size budget`,
      );
    }
  }

  private isBuiltInNamespace(namespace: SessionStateNamespace): boolean {
    return this.slotRegistry.list(namespace).length > 0;
  }

  private buildManagedDomainName(sessionId: string, namespace: SessionStateNamespace): string {
    return `session-state:${namespace}:${sessionId}`;
  }

  private buildLiveHeadItemKey(
    namespace: SessionStateNamespace,
    slot: string,
    visibilityMode: SessionStateVisibilityMode,
    sessionId: string,
    branchId: string,
  ): string {
    if (visibilityMode === "session_shared") {
      return `live:${namespace}:${slot}:session:${sessionId}`;
    }
    return `live:${namespace}:${slot}:branch:${branchId}`;
  }

  private buildSnapshotItemKey(namespace: SessionStateNamespace, slot: string, floorId: string): string {
    return `snapshot:${namespace}:${slot}:floor:${floorId}`;
  }

  private toSlotMapKey(namespace: SessionStateNamespace, slot: string): string {
    return `${namespace}::${slot}`;
  }

  private toDiffEntry(
    namespace: SessionStateNamespace,
    slot: string,
    left: SessionStateFloorSnapshotView | null,
    right: SessionStateFloorSnapshotView | null,
  ): SessionStateDiffEntry {
    const leftPresent = left?.present ?? false;
    const rightPresent = right?.present ?? false;
    const leftValue = left?.value ?? null;
    const rightValue = right?.value ?? null;
    const changeType = !leftPresent && rightPresent
      ? "added"
      : leftPresent && !rightPresent
        ? "removed"
        : this.valuesEqual(leftValue, rightValue)
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

  private valuesEqual(left: unknown, right: unknown): boolean {
    return stableStringify(left) === stableStringify(right);
  }

  private throwMappedClientDataStorageError(
    error: unknown,
    namespace: SessionStateNamespace,
    slot?: string,
  ): never {
    throw this.mapClientDataStorageError(error, namespace, slot) ?? error;
  }

  private mapClientDataStorageError(
    error: unknown,
    namespace: SessionStateNamespace,
    slot?: string,
  ): SessionStateServiceError | null {
    if (!(error instanceof ClientDataServiceError)) {
      return null;
    }

    switch (error.code) {
      case "client_data_account_domain_limit_exceeded":
        return new SessionStateServiceError(409, "session_state_namespace_count_limit_exceeded", `Session State namespace '${namespace}' cannot be materialized because the account has reached the managed namespace capacity`);
      case "client_data_domain_entries_quota_exceeded":
        return new SessionStateServiceError(409, "session_state_namespace_item_limit_exceeded", `Session State namespace '${namespace}' has reached its managed storage item limit`);
      case "client_data_domain_bytes_quota_exceeded":
        return new SessionStateServiceError(409, "session_state_namespace_byte_limit_exceeded", `Session State namespace '${namespace}' has reached its managed storage byte limit`);
      case "client_data_account_entries_quota_exceeded":
        return new SessionStateServiceError(409, "session_state_account_item_limit_exceeded", "Session State account storage item limit exceeded");
      case "client_data_account_bytes_quota_exceeded":
        return new SessionStateServiceError(409, "session_state_account_byte_limit_exceeded", "Session State account storage byte limit exceeded");
      case "client_data_item_too_large":
        return new SessionStateServiceError(
          409,
          "session_state_payload_too_large",
          slot
            ? `Session state payload for slot '${namespace}/${slot}' exceeds its size budget`
            : `Session state payload for namespace '${namespace}' exceeds its size budget`,
        );
      default:
        return null;
    }
  }

  private appendGovernanceAudit(
    executor: AppDb | DbExecutor,
    accountId: string,
    binding: ClientDataManagedDomainRecord,
    input: {
      action: string;
      targetType: string;
      targetId?: string | null;
      metadata?: unknown;
    },
  ): void {
    const domain = this.clientDataRepository(executor).getDomainById(binding.domainId);
    this.clientDataRepository(executor).appendAuditLog({
      accountId,
      domainId: binding.domainId,
      ownerType: domain?.ownerType ?? this.managedOwnerType,
      ownerId: domain?.ownerId ?? this.managedOwnerId,
      actorType: "system:session_state",
      actorId: binding.hostId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      requestId: null,
      metadataJson: input.metadata === undefined ? null : JSON.stringify(input.metadata),
      createdAt: this.now(),
    });
  }

  private executeTransaction<T>(action: (tx: DbExecutor) => T): T {
    return this.db.transaction((tx) => action(tx));
  }

  private getClientDataService(executor: AppDb | DbExecutor): ClientDataService {
    return new ClientDataService(executor, this.clientDataConfig, this.now);
  }

  private clientDataRepository(executor: AppDb | DbExecutor): ClientDataRepository {
    return new ClientDataRepository(executor);
  }

  private sessionStateRepository(executor: AppDb | DbExecutor): SessionStateRepository {
    return new SessionStateRepository(executor);
  }

  /**
   * 只读访问入口，专供 session-state 模块内部的观察面 facade 使用。
   *
   * 只暴露观察面需要的 helper 与 key 构造方法，不提供任何写路径。外部模块不应直接调用它。
   */
  getObservationAccess(): SessionStateObservationAccess {
    return {
      db: this.db,
      slotRegistry: this.slotRegistry,
      sessionStateRepository: (executor) => this.sessionStateRepository(executor),
      clientDataRepository: (executor) => this.clientDataRepository(executor),
      buildLiveHeadItemKey: (namespace, slot, visibilityMode, sessionId, branchId) =>
        this.buildLiveHeadItemKey(namespace, slot, visibilityMode, sessionId, branchId),
      buildSnapshotItemKey: (namespace, slot, floorId) => this.buildSnapshotItemKey(namespace, slot, floorId),
      requireSlotDefinition: (namespace, slot) => this.requireSlotDefinition(namespace, slot),
      findManagedDomainBinding: (executor, accountId, sessionId, namespace) =>
        this.findManagedDomainBinding(executor, accountId, sessionId, namespace),
    };
  }

}

export interface SessionStateObservationAccess {
  db: AppDb;
  slotRegistry: SessionStateSlotRegistry;
  sessionStateRepository: (executor: AppDb | DbExecutor) => SessionStateRepository;
  clientDataRepository: (executor: AppDb | DbExecutor) => ClientDataRepository;
  buildLiveHeadItemKey: (
    namespace: SessionStateNamespace,
    slot: string,
    visibilityMode: SessionStateVisibilityMode,
    sessionId: string,
    branchId: string,
  ) => string;
  buildSnapshotItemKey: (
    namespace: SessionStateNamespace,
    slot: string,
    floorId: string,
  ) => string;
  requireSlotDefinition: (namespace: SessionStateNamespace, slot: string) => SessionStateSlotDefinition;
  findManagedDomainBinding: (
    executor: AppDb | DbExecutor,
    accountId: string,
    sessionId: string,
    namespace: SessionStateNamespace,
  ) => ClientDataManagedDomainRecord | null;
}


export class SessionStateServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SessionStateServiceError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableStringify(value));
}

function buildDirectSessionStateOperationMetadata(
  present: boolean,
  mutation_status: "applied" | "uncertain",
): Record<string, unknown> {
  return {
    write_mode: "direct",
    operation: present ? "set" : "delete",
    mutation_status,
  };
}

function normalizeForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableStringify(item));
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeForStableStringify(record[key])]),
    );
  }

  return value;
}

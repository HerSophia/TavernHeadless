import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  ClientDataService,
  ClientDataServiceError,
  type ClientDataConfig,
} from "../client-data/client-data-service.js";
import {
  ClientDataRepository,
  type ClientDataDomainRecord,
  type ClientDataManagedDomainRecord,
} from "../client-data/client-data-repository.js";
import {
  SessionStateRepository,
  type SessionStateSessionHostRecord,
} from "./session-state-repository.js";
import type { SessionStateSlotRegistry } from "./session-state-slot-registry.js";
import { createDefaultSessionStateSlotRegistry } from "./session-state-slot-registry.js";
import type {
  SessionStateCustomNamespaceDefaultSlotTemplate,
  SessionStateLogicalOwnerType,
  SessionStateNamespace,
  SessionStateNamespaceRegistrationRecord,
  SessionStatePublicCustomNamespaceDefinition,
  SessionStatePublicSlotDefinition,
  SessionStateSlotDefinition,
  SessionStateSlotPublicExposure,
  SessionStateWriteMode,
} from "./session-state-types.js";
import {
  SESSION_STATE_HOST_TYPE,
  SESSION_STATE_INTERNAL_OWNER_ID,
  SESSION_STATE_INTERNAL_OWNER_TYPE,
  SESSION_STATE_LIVE_COLLECTION,
  SESSION_STATE_LOGICAL_OWNER_ID_PATTERN,
  SESSION_STATE_LOGICAL_OWNER_ID_PATTERN_HINT,
  SESSION_STATE_LOGICAL_OWNER_TYPE_PATTERN,
  SESSION_STATE_LOGICAL_OWNER_TYPE_PATTERN_HINT,
  SESSION_STATE_MANAGER_KIND,
  SESSION_STATE_NAMESPACE_PATTERN,
  SESSION_STATE_NAMESPACE_PATTERN_HINT,
  SESSION_STATE_SNAPSHOT_COLLECTION,
} from "./session-state-types.js";
import {
  appendSessionStateOperationLog,
  buildSessionStateNamespaceTargetId,
  toSessionStateNamespaceOperationRef,
  type SessionStateOperationLogContext,
} from "./session-state-operation-log.js";

export interface SessionStateCustomNamespaceServiceOptions {
  clientData: ClientDataConfig;
  slotRegistry?: SessionStateSlotRegistry;
  managedOwnerType?: "application" | "plugin";
  managedOwnerId?: string;
  now?: () => number;
}

const DEFAULT_CUSTOM_NAMESPACE_SLOT_TEMPLATE: SessionStateCustomNamespaceDefaultSlotTemplate = {
  defaultVisibilityMode: "fork_on_branch",
  defaultWriteMode: "direct",
  defaultReplaySafety: "safe",
  clientWritable: true,
  allowedWriteModes: ["direct", "commit_bound"],
  supportsSnapshot: true,
  supportsDiff: true,
  replayPolicySource: "system_default",
};

const DEFAULT_CUSTOM_SLOT_SCHEMA_VERSION = 1;

export class SessionStateCustomNamespaceService {
  private readonly clientDataConfig: ClientDataConfig;
  private readonly slotRegistry: SessionStateSlotRegistry;
  private readonly managedOwnerType: "application" | "plugin";
  private readonly managedOwnerId: string;
  private readonly now: () => number;
  private readonly reservedNamespaces: Set<string>;

  constructor(
    private readonly db: AppDb,
    options: SessionStateCustomNamespaceServiceOptions,
  ) {
    this.clientDataConfig = options.clientData;
    this.slotRegistry = options.slotRegistry ?? createDefaultSessionStateSlotRegistry();
    this.managedOwnerType = options.managedOwnerType ?? SESSION_STATE_INTERNAL_OWNER_TYPE;
    this.managedOwnerId = options.managedOwnerId ?? SESSION_STATE_INTERNAL_OWNER_ID;
    this.now = options.now ?? Date.now;
    this.reservedNamespaces = new Set(this.slotRegistry.list().map((definition) => definition.namespace));
  }

  registerNamespace(input: {
    accountId: string;
    sessionId: string;
    namespace: SessionStateNamespace;
    logicalOwnerType: SessionStateLogicalOwnerType;
    logicalOwnerId: string;
    operationLog?: SessionStateOperationLogContext;
  }): SessionStatePublicCustomNamespaceDefinition {
    const requestedNamespace = input.namespace.trim() || input.namespace;
    try {
      return this.executeTransaction((tx) => {
        const session = this.requireSessionHost(tx, input.accountId, input.sessionId, { requireActive: true });
        const namespace = this.normalizeNamespace(input.namespace);
        const logicalOwnerType = this.normalizeLogicalOwnerType(input.logicalOwnerType);
        const logicalOwnerId = this.normalizeLogicalOwnerId(input.logicalOwnerId);

        this.assertNamespaceIsNotReserved(namespace);

        const repository = this.sessionStateRepository(tx);
        const existing = repository.getNamespaceRegistration({
          accountId: session.accountId,
          sessionId: session.id,
          namespace,
        });
        if (existing) {
          throw new SessionStateCustomNamespaceServiceError(
            409,
            "session_state_namespace_already_registered",
            `Session State namespace '${namespace}' is already registered for session '${session.id}'`,
          );
        }

        const domain = this.ensureManagedDomain(tx, session.accountId, session.id, namespace);
        this.ensureManagedDomainBinding(tx, session.accountId, session.id, namespace, domain.id);

        try {
          const registration = repository.createNamespaceRegistration({
            id: nanoid(),
            accountId: session.accountId,
            sessionId: session.id,
            domainId: domain.id,
            namespace,
            logicalOwnerType,
            logicalOwnerId,
            defaultVisibilityMode: DEFAULT_CUSTOM_NAMESPACE_SLOT_TEMPLATE.defaultVisibilityMode,
            defaultWriteMode: DEFAULT_CUSTOM_NAMESPACE_SLOT_TEMPLATE.defaultWriteMode,
            defaultReplaySafety: DEFAULT_CUSTOM_NAMESPACE_SLOT_TEMPLATE.defaultReplaySafety,
            clientWritable: DEFAULT_CUSTOM_NAMESPACE_SLOT_TEMPLATE.clientWritable,
            allowedWriteModes: [...DEFAULT_CUSTOM_NAMESPACE_SLOT_TEMPLATE.allowedWriteModes],
            supportsSnapshot: DEFAULT_CUSTOM_NAMESPACE_SLOT_TEMPLATE.supportsSnapshot,
            supportsDiff: DEFAULT_CUSTOM_NAMESPACE_SLOT_TEMPLATE.supportsDiff,
            replayPolicySource: DEFAULT_CUSTOM_NAMESPACE_SLOT_TEMPLATE.replayPolicySource,
            createdAt: this.now(),
            updatedAt: this.now(),
          });
          if (input.operationLog) {
            appendSessionStateOperationLog(tx, {
              ...input.operationLog,
              accountId: session.accountId,
              action: "register_session_state_namespace",
              sessionId: session.id,
              targetType: "session_state_namespace",
              targetId: buildSessionStateNamespaceTargetId(session.id, namespace),
              beforeRef: null,
              afterRef: toSessionStateNamespaceOperationRef(registration),
              metadata: {
                namespace,
                logical_owner_type: logicalOwnerType,
                logical_owner_id: logicalOwnerId,
                default_visibility_mode: registration.defaultSlotTemplate.defaultVisibilityMode,
                default_write_mode: registration.defaultSlotTemplate.defaultWriteMode,
                default_replay_safety: registration.defaultSlotTemplate.defaultReplaySafety,
              },
            });
          }
          return this.toPublicNamespaceDefinition(registration);
        } catch (error) {
          throw mapNamespaceRegistrationConstraintError(error) ?? error;
        }
      });
    } catch (error) {
      throw mapNamespaceBootstrapStorageError(error, requestedNamespace) ?? error;
    }
  }

  listNamespaces(accountId: string, sessionId: string): SessionStatePublicCustomNamespaceDefinition[] {
    this.requireSessionHost(this.db, accountId, sessionId, { requireActive: false });
    const repository = this.sessionStateRepository(this.db);
    const registrations = repository.listNamespaceRegistrations({ accountId, sessionId });
    const materializedByNamespace = new Map<string, SessionStateSlotDefinition[]>();
    for (const definition of this.listMaterializedSlotDefinitions(accountId, sessionId)) {
      const current = materializedByNamespace.get(definition.namespace) ?? [];
      current.push(definition);
      materializedByNamespace.set(definition.namespace, current);
    }

    return registrations.map((registration) => this.toPublicNamespaceDefinition(
      registration,
      materializedByNamespace.get(registration.namespace) ?? [],
    ));
  }

  getNamespaceRegistration(
    accountId: string,
    sessionId: string,
    namespace: SessionStateNamespace,
  ): SessionStateNamespaceRegistrationRecord | null {
    this.requireSessionHost(this.db, accountId, sessionId, { requireActive: false });
    return this.sessionStateRepository(this.db).getNamespaceRegistration({
      accountId,
      sessionId,
      namespace,
    });
  }

  resolveWritableSlotDefinition(
    accountId: string,
    sessionId: string,
    namespace: SessionStateNamespace,
    slot: string,
  ): SessionStateSlotDefinition | null {
    const registration = this.getNamespaceRegistration(accountId, sessionId, namespace);
    return registration ? this.toSyntheticSlotDefinition(registration, slot) : null;
  }

  getMaterializedSlotDefinition(
    accountId: string,
    sessionId: string,
    namespace: SessionStateNamespace,
    slot: string,
  ): SessionStateSlotDefinition | null {
    this.requireSessionHost(this.db, accountId, sessionId, { requireActive: false });
    const repository = this.sessionStateRepository(this.db);
    const registration = repository.getNamespaceRegistration({ accountId, sessionId, namespace });
    if (!registration) {
      return null;
    }

    const materialized = repository.listMaterializedSlots({
      accountId,
      sessionId,
      namespace,
      slot,
      statuses: ["applied"],
    });
    return materialized.length > 0 ? this.toSyntheticSlotDefinition(registration, slot) : null;
  }

  listMaterializedSlotDefinitions(
    accountId: string,
    sessionId: string,
    namespace?: SessionStateNamespace,
  ): SessionStateSlotDefinition[] {
    this.requireSessionHost(this.db, accountId, sessionId, { requireActive: false });
    const repository = this.sessionStateRepository(this.db);
    const registrations = repository.listNamespaceRegistrations({ accountId, sessionId, namespace });
    if (registrations.length === 0) {
      return [];
    }

    const registrationsByNamespace = new Map(
      registrations.map((registration) => [registration.namespace, registration] as const),
    );

    return repository.listMaterializedSlots({
      accountId,
      sessionId,
      namespace,
      statuses: ["applied"],
    }).flatMap((materializedSlot) => {
      const registration = registrationsByNamespace.get(materializedSlot.namespace);
      return registration ? [this.toSyntheticSlotDefinition(registration, materializedSlot.slot)] : [];
    });
  }

  private toPublicNamespaceDefinition(
    registration: SessionStateNamespaceRegistrationRecord,
    slots: SessionStateSlotDefinition[] = [],
  ): SessionStatePublicCustomNamespaceDefinition {
    const effectiveTemplate = this.toEffectiveDefaultSlotTemplate(registration.defaultSlotTemplate);
    return {
      namespace: registration.namespace,
      ownerKind: "custom",
      logicalOwnerType: registration.logicalOwnerType,
      logicalOwnerId: registration.logicalOwnerId,
      defaultSlotTemplate: {
        defaultVisibilityMode: effectiveTemplate.defaultVisibilityMode,
        defaultWriteMode: effectiveTemplate.defaultWriteMode,
        defaultReplaySafety: effectiveTemplate.defaultReplaySafety,
        clientWritable: effectiveTemplate.clientWritable,
        allowedWriteModes: [...effectiveTemplate.allowedWriteModes],
        supportsSnapshot: effectiveTemplate.supportsSnapshot,
        supportsDiff: effectiveTemplate.supportsDiff,
        replayPolicySource: effectiveTemplate.replayPolicySource,
      },
      slots: slots.map((slotDefinition) => this.toPublicSlotDefinition(slotDefinition)),
    };
  }

  private toSyntheticSlotDefinition(
    registration: SessionStateNamespaceRegistrationRecord,
    slot: string,
  ): SessionStateSlotDefinition {
    const effectiveTemplate = this.toEffectiveDefaultSlotTemplate(registration.defaultSlotTemplate);
    return {
      namespace: registration.namespace,
      slot,
      visibilityMode: effectiveTemplate.defaultVisibilityMode,
      defaultWriteMode: effectiveTemplate.defaultWriteMode,
      defaultReplaySafety: effectiveTemplate.defaultReplaySafety,
      schemaVersion: DEFAULT_CUSTOM_SLOT_SCHEMA_VERSION,
      sizeBudgetBytes: this.clientDataConfig.defaultMaxItemSizeBytes,
      publicExposure: this.createCustomSlotPublicExposure(effectiveTemplate),
    };
  }

  private toEffectiveDefaultSlotTemplate(
    template: SessionStateNamespaceRegistrationRecord["defaultSlotTemplate"],
  ): SessionStateNamespaceRegistrationRecord["defaultSlotTemplate"] {
    const allowedWriteModes = Array.from(
      new Set<SessionStateWriteMode>([...template.allowedWriteModes, "commit_bound"]),
    );
    return { ...template, allowedWriteModes };
  }

  private createCustomSlotPublicExposure(
    template: SessionStateNamespaceRegistrationRecord["defaultSlotTemplate"],
  ): SessionStateSlotPublicExposure {
    return {
      ownerKind: "custom",
      exposureLifecycle: "public_stable",
      capabilities: {
        clientReadable: true,
        clientWritable: template.clientWritable,
        allowedWriteModes: [...template.allowedWriteModes],
        supportsSnapshot: template.supportsSnapshot,
        supportsDiff: template.supportsDiff,
      },
    };
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
      capabilities: { ...definition.publicExposure.capabilities, allowedWriteModes: [...definition.publicExposure.capabilities.allowedWriteModes] },
    };
  }

  private ensureManagedDomain(
    executor: AppDb | DbExecutor,
    accountId: string,
    sessionId: string,
    namespace: SessionStateNamespace,
  ): ClientDataDomainRecord {
    const repository = this.clientDataRepository(executor);
    const domainName = this.buildManagedDomainName(sessionId, namespace);
    let domain = repository.getDomainByOwnerName({
      accountId,
      ownerType: this.managedOwnerType,
      ownerId: this.managedOwnerId,
      domainName,
    });

    if (!domain) {
      try {
        domain = this.getClientDataService(executor).createDomain({
          accountId,
          ownerType: this.managedOwnerType,
          ownerId: this.managedOwnerId,
          domainName,
          displayName: `Session State ${namespace}`,
          description: `Managed session state backing domain for session '${sessionId}' and namespace '${namespace}'`,
          actor: { actorType: "system:session_state", actorId: sessionId },
          requestId: `session-state-namespace-register:${sessionId}:${namespace}`,
        });
      } catch (error) {
        if (error instanceof ClientDataServiceError && error.code === "client_data_domain_name_conflict") {
          domain = repository.getDomainByOwnerName({
            accountId,
            ownerType: this.managedOwnerType,
            ownerId: this.managedOwnerId,
            domainName,
          });
          if (!domain) {
            throw error;
          }
        } else {
          throw mapNamespaceBootstrapStorageError(error, namespace) ?? error;
        }
      }
    }

    if (!domain) {
      throw new SessionStateCustomNamespaceServiceError(
        500,
        "session_state_namespace_domain_resolution_failed",
        `Failed to resolve backing domain for session-state namespace '${namespace}'`,
      );
    }

    this.ensureInternalCollections(executor, accountId, domain.id);
    return domain;
  }

  private ensureManagedDomainBinding(
    executor: AppDb | DbExecutor,
    accountId: string,
    sessionId: string,
    namespace: SessionStateNamespace,
    domainId: string,
  ): ClientDataManagedDomainRecord {
    return this.clientDataRepository(executor).upsertManagedDomain({
      domainId,
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

  private buildManagedDomainName(sessionId: string, namespace: SessionStateNamespace): string {
    return `session-state:${namespace}:${sessionId}`;
  }

  private requireSessionHost(
    executor: AppDb | DbExecutor,
    accountId: string,
    sessionId: string,
    options: { requireActive: boolean },
  ): SessionStateSessionHostRecord {
    const session = this.sessionStateRepository(executor).getSessionById(sessionId);
    if (!session || session.accountId !== accountId) {
      throw new SessionStateCustomNamespaceServiceError(404, "not_found", "Resource not found");
    }
    if (options.requireActive && session.status !== "active") {
      throw new SessionStateCustomNamespaceServiceError(
        409,
        "session_state_host_archived",
        `Session '${sessionId}' is archived and cannot accept session-state namespace registrations`,
      );
    }
    return session;
  }

  private normalizeRequiredString(value: string, fieldName: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new SessionStateCustomNamespaceServiceError(400, "invalid_request", `Field '${fieldName}' cannot be empty`);
    }
    return normalized;
  }

  private normalizeNamespace(value: string): SessionStateNamespace {
    const normalized = this.normalizeRequiredString(value, "namespace");
    if (!SESSION_STATE_NAMESPACE_PATTERN.test(normalized)) {
      throw new SessionStateCustomNamespaceServiceError(
        400,
        "session_state_namespace_invalid",
        `Field 'namespace' must use ${SESSION_STATE_NAMESPACE_PATTERN_HINT}`,
      );
    }

    return normalized as SessionStateNamespace;
  }

  private normalizeLogicalOwnerType(value: string): SessionStateLogicalOwnerType {
    const normalized = this.normalizeRequiredString(value, "logical_owner_type");
    if (!SESSION_STATE_LOGICAL_OWNER_TYPE_PATTERN.test(normalized)) {
      throw new SessionStateCustomNamespaceServiceError(
        400,
        "session_state_logical_owner_type_invalid",
        `Field 'logical_owner_type' must use ${SESSION_STATE_LOGICAL_OWNER_TYPE_PATTERN_HINT}`,
      );
    }

    return normalized as SessionStateLogicalOwnerType;
  }

  private normalizeLogicalOwnerId(value: string): string {
    const normalized = this.normalizeRequiredString(value, "logical_owner_id");
    if (!SESSION_STATE_LOGICAL_OWNER_ID_PATTERN.test(normalized)) {
      throw new SessionStateCustomNamespaceServiceError(
        400,
        "session_state_logical_owner_id_invalid",
        `Field 'logical_owner_id' must use ${SESSION_STATE_LOGICAL_OWNER_ID_PATTERN_HINT}`,
      );
    }

    return normalized;
  }

  private assertNamespaceIsNotReserved(namespace: SessionStateNamespace): void {
    if ([...this.reservedNamespaces].some((reservedNamespace) => namespace === reservedNamespace || namespace.startsWith(`${reservedNamespace}.`))) {
      throw new SessionStateCustomNamespaceServiceError(
        409,
        "session_state_namespace_reserved",
        `Session State namespace '${namespace}' is reserved`,
      );
    }
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
}

export class SessionStateCustomNamespaceServiceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SessionStateCustomNamespaceServiceError";
  }
}

function mapNamespaceRegistrationConstraintError(error: unknown): SessionStateCustomNamespaceServiceError | null {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("session_state_namespace_registration_account_session_namespace_uq")
    || message.includes("session_state_namespace_registration.account_id, session_state_namespace_registration.session_id, session_state_namespace_registration.namespace")
  ) {
    return new SessionStateCustomNamespaceServiceError(
      409,
      "session_state_namespace_already_registered",
      "Session State namespace is already registered for the session",
    );
  }
  if (
    message.includes("session_state_namespace_registration_domain_id_uq")
    || message.includes("session_state_namespace_registration.domain_id")
  ) {
    return new SessionStateCustomNamespaceServiceError(
      409,
      "session_state_namespace_already_registered",
      "Session State namespace backing domain is already registered",
    );
  }
  return null;
}

function mapNamespaceBootstrapStorageError(
  error: unknown,
  namespace: string,
): SessionStateCustomNamespaceServiceError | null {
  if (!(error instanceof ClientDataServiceError)) {
    return null;
  }

  if (error.code === "client_data_account_domain_limit_exceeded") {
    return new SessionStateCustomNamespaceServiceError(
      409,
      "session_state_namespace_count_limit_exceeded",
      `Session State namespace '${namespace}' cannot be registered because the account has reached the managed namespace capacity`,
    );
  }
  return null;
}

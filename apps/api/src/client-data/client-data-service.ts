import { Buffer } from "node:buffer";

import type { AppDb, DbExecutor } from "../db/client.js";
import { parseJsonField, stringifyJsonField } from "../lib/http.js";
import {
  ClientDataRepository,
  type ClientDataAuditLogRecord,
  type ClientDataCollectionRecord,
  type ClientDataDomainGrantRecord,
  type ClientDataDomainRecord,
  type ClientDataItemRecord,
} from "./client-data-repository.js";
import type { ClientDataCallerOwner } from "./client-data-auth.js";

export interface ClientDataConfig {
  defaultMaxItemSizeBytes: number;
  defaultQuotaMaxEntries: number;
  defaultQuotaMaxBytes: number;
  maxDomainsPerAccount: number;
  maxTotalEntriesPerAccount: number;
  maxTotalBytesPerAccount: number;
  domainPurgeGracePeriodMs?: number;
}

export interface ClientDataDomainDetail extends ClientDataDomainRecord {
  quotaUsage: {
    entryCount: number;
    byteCount: number;
  };
  restorableUntil: number | null;
}

export interface ClientDataExportSnapshot {
  domain: {
    id: string;
    ownerType: "application" | "plugin";
    ownerId: string;
    domainName: string;
    displayName: string | null;
    description: string | null;
    createdAt: number;
  };
  collections: ClientDataImportCollectionSnapshot[];
  exportedAt: number;
}

export interface ClientDataImportCollectionSnapshot {
  collectionName: string;
  description: string | null;
  defaultExpiresTtlMs: number | null;
  maxItemSizeBytes: number | null;
  metadataJson: unknown;
  items: ClientDataImportItemSnapshot[];
}

export interface ClientDataImportItemSnapshot {
  itemKey: string;
  valueJson: unknown;
  version?: number;
  expiresAt: number | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface ClientDataImportPayload {
  domain: {
    ownerType: "application" | "plugin";
    ownerId: string;
    domainName: string;
    displayName?: string | null;
    description?: string | null;
  };
  collections: ClientDataImportCollectionSnapshot[];
}

export interface ClientDataImportResult {
  domain: ClientDataDomainRecord;
  collections: ClientDataCollectionRecord[];
  summary: {
    collectionsCreated: number;
    itemsCreated: number;
    itemsUpdated: number;
    itemsSkipped: number;
    importedItemCount: number;
    importedByteCount: number;
    conflictPolicy: "fail" | "overwrite" | "skip";
  };
}

export interface ClientDataAuditActor {
  actorType: string;
  actorId: string | null;
}

const MAX_IMPORT_ITEMS = 1_000;
const MAX_IMPORT_PAYLOAD_BYTES = 10 * 1024 * 1024;

export class ClientDataService {
  private readonly repository: ClientDataRepository;

  constructor(
    private readonly db: AppDb | DbExecutor,
    private readonly config: ClientDataConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.repository = new ClientDataRepository(db);
  }

  createDomain(input: {
    accountId: string;
    ownerType: "application" | "plugin";
    ownerId: string;
    domainName: string;
    displayName?: string;
    description?: string;
    actor?: ClientDataAuditActor;
    requestId?: string | null;
  }): ClientDataDomainRecord {
    const existingDomainCount = this.repository.countActiveDomainsByAccount(input.accountId);
    if (existingDomainCount >= this.config.maxDomainsPerAccount) {
      throw new ClientDataServiceError(409, "client_data_account_domain_limit_exceeded", "Client data domain limit exceeded for account");
    }

    let created: ClientDataDomainRecord;
    try {
      created = this.repository.createDomain({
        accountId: input.accountId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        domainName: input.domainName,
        displayName: input.displayName,
        description: input.description,
        quotaMaxEntries: this.config.defaultQuotaMaxEntries,
        quotaMaxBytes: this.config.defaultQuotaMaxBytes,
        now: this.now(),
      });
    } catch (error) {
      throw mapClientDataConstraintError(error) ?? error;
    }

    this.appendAuditLog({
      accountId: created.accountId,
      domain: created,
      actor: input.actor,
      action: "domain.create",
      targetType: "domain",
      targetId: created.id,
      requestId: input.requestId ?? null,
      metadata: {
        owner_type: created.ownerType,
        owner_id: created.ownerId,
        domain_name: created.domainName,
      },
    });

    return created;
  }

  listDomains(input: {
    accountId: string;
    ownerType?: "application" | "plugin";
    ownerId?: string;
    status?: "active" | "suspended" | "deleted";
    limit: number;
    offset: number;
    sortBy: "updated_at" | "created_at" | "domain_name";
    sortOrder: "asc" | "desc";
  }) {
    const managedDomainIds = this.repository.listManagedDomainIdsByAccount(input.accountId);
    return this.repository.listDomains({
      ...input,
      excludeDomainIds: managedDomainIds,
    });
  }

  getOwnedDomainDetail(accountId: string, domainId: string): ClientDataDomainDetail {
    const domain = this.requireReadableDomain(this.requireOwnedDomain(accountId, domainId));
    return {
      ...domain,
      quotaUsage: {
        entryCount: domain.currentEntryCount,
        byteCount: domain.currentByteCount,
      },
      restorableUntil: domain.deletedAt === null ? null : domain.deletedAt + (this.config.domainPurgeGracePeriodMs ?? 0),
    };
  }

  updateDomain(input: {
    accountId: string;
    domainId: string;
    displayName?: string | null;
    description?: string | null;
    ifVersion?: number;
    actor?: ClientDataAuditActor;
    requestId?: string | null;
  }): ClientDataDomainRecord {
    const domain = this.requireReadableDomain(this.requireOwnedDomain(input.accountId, input.domainId));
    const updated = this.repository.updateDomain({
      domainId: input.domainId,
      displayName: input.displayName,
      description: input.description,
      ifVersion: input.ifVersion,
      now: this.now(),
    });
    if (!updated) {
      if (input.ifVersion !== undefined) {
        throw new ClientDataServiceError(409, "client_data_version_conflict", "Client data domain version conflict");
      }
      throw new ClientDataServiceError(404, "not_found", "Client data domain not found");
    }

    this.appendAuditLog({
      accountId: updated.accountId,
      domain: updated,
      actor: input.actor,
      action: "domain.update",
      targetType: "domain",
      targetId: updated.id,
      requestId: input.requestId ?? null,
      metadata: {
        previous_display_name: domain.displayName,
        previous_description: domain.description,
        display_name: updated.displayName,
        description: updated.description,
        if_version: input.ifVersion ?? null,
      },
    });

    return updated;
  }

  updateDomainQuota(input: {
    accountId: string;
    role: "admin" | "user";
    domainId: string;
    quotaMaxEntries: number;
    quotaMaxBytes: number;
    actor?: ClientDataAuditActor;
    requestId?: string | null;
  }): ClientDataDomainRecord {
    if (input.role !== "admin") {
      throw new ClientDataServiceError(403, "client_data_domain_quota_forbidden", "Only admin can update client data domain quota");
    }
    const domain = this.requireOwnedDomain(input.accountId, input.domainId);
    if (input.quotaMaxEntries < domain.currentEntryCount || input.quotaMaxBytes < domain.currentByteCount) {
      throw new ClientDataServiceError(409, "client_data_domain_quota_below_usage", "Client data domain quota cannot be lower than current usage");
    }
    const updated = this.repository.updateDomainQuota({
      domainId: input.domainId,
      quotaMaxEntries: input.quotaMaxEntries,
      quotaMaxBytes: input.quotaMaxBytes,
      now: this.now(),
    });
    if (!updated) {
      throw new ClientDataServiceError(404, "not_found", "Client data domain not found");
    }

    this.appendAuditLog({
      accountId: updated.accountId,
      domain: updated,
      actor: input.actor,
      action: "domain.quota.update",
      targetType: "domain",
      targetId: updated.id,
      requestId: input.requestId ?? null,
      metadata: {
        previous_quota_max_entries: domain.quotaMaxEntries,
        previous_quota_max_bytes: domain.quotaMaxBytes,
        quota_max_entries: updated.quotaMaxEntries,
        quota_max_bytes: updated.quotaMaxBytes,
      },
    });

    return updated;
  }

  deleteDomain(accountId: string, domainId: string, actor?: ClientDataAuditActor, requestId?: string | null): ClientDataDomainRecord {
    this.requireOwnedDomain(accountId, domainId);
    const deleted = this.repository.softDeleteDomain(domainId, this.now());
    if (!deleted) {
      throw new ClientDataServiceError(404, "not_found", "Client data domain not found");
    }

    this.appendAuditLog({
      accountId: deleted.accountId,
      domain: deleted,
      actor,
      action: "domain.delete",
      targetType: "domain",
      targetId: deleted.id,
      requestId: requestId ?? null,
      metadata: {
        status: deleted.status,
        deleted_at: deleted.deletedAt,
      },
    });

    return deleted;
  }

  restoreDomain(accountId: string, domainId: string, actor?: ClientDataAuditActor, requestId?: string | null): ClientDataDomainRecord {
    const domain = this.requireOwnedDomain(accountId, domainId);
    if (domain.status !== "deleted" || domain.deletedAt === null) {
      throw new ClientDataServiceError(409, "client_data_domain_restore_invalid_state", "Client data domain is not restorable");
    }
    const gracePeriodMs = this.config.domainPurgeGracePeriodMs ?? 0;
    if (gracePeriodMs <= 0 || this.now() > domain.deletedAt + gracePeriodMs) {
      throw new ClientDataServiceError(409, "client_data_domain_restore_expired", "Client data domain restore grace period has expired");
    }
    if (this.repository.hasActiveDomainWithOwnerName({
      accountId: domain.accountId,
      ownerType: domain.ownerType,
      ownerId: domain.ownerId,
      domainName: domain.domainName,
      excludeDomainId: domain.id,
    })) {
      throw new ClientDataServiceError(409, "client_data_domain_restore_conflict", "Client data domain restore conflicts with an existing active domain");
    }
    const restored = this.repository.restoreDomain({ domainId: domain.id, now: this.now() });
    if (!restored) {
      throw new ClientDataServiceError(404, "not_found", "Client data domain not found");
    }

    this.appendAuditLog({
      accountId: restored.accountId,
      domain: restored,
      actor,
      action: "domain.restore",
      targetType: "domain",
      targetId: restored.id,
      requestId: requestId ?? null,
      metadata: {
        previous_deleted_at: domain.deletedAt,
      },
    });

    return restored;
  }

  deleteDomainsByOwner(input: { accountId: string; ownerType: "application" | "plugin"; ownerId: string; actor?: ClientDataAuditActor; requestId?: string | null }): ClientDataDomainRecord[] {
    this.assertRawOwnerDeletionAllowed(input.accountId, input.ownerType, input.ownerId);
    const deleted = this.repository.softDeleteDomainsByOwner({
      accountId: input.accountId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      now: this.now(),
    });
    if (deleted.length > 0) {
      this.appendAuditLog({
        accountId: input.accountId,
        domain: null,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        actor: input.actor,
        action: "domain.owner.bulk_delete",
        targetType: "owner",
        targetId: input.ownerId,
        requestId: input.requestId ?? null,
        metadata: {
          owner_type: input.ownerType,
          owner_id: input.ownerId,
          deleted_domain_ids: deleted.map((domain) => domain.id),
        },
      });
    }
    return deleted;
  }

  exportDomain(accountId: string, domainId: string, actor?: ClientDataAuditActor, requestId?: string | null): ClientDataExportSnapshot {
    const domain = this.requireReadableDomain(this.requireOwnedDomain(accountId, domainId));
    const collections = this.repository.listItemsForExport(domain.id).map((entry) => ({
      collectionName: entry.collection.collectionName,
      description: entry.collection.description,
      defaultExpiresTtlMs: entry.collection.defaultExpiresTtlMs,
      maxItemSizeBytes: entry.collection.maxItemSizeBytes,
      metadataJson: parseJsonField(entry.collection.metadataJson),
      items: entry.items.map((item) => ({
        itemKey: item.itemKey,
        valueJson: parseJsonField(item.valueJson),
        version: item.version,
        expiresAt: item.expiresAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    }));

    const snapshot = {
      domain: {
        id: domain.id,
        ownerType: domain.ownerType,
        ownerId: domain.ownerId,
        domainName: domain.domainName,
        displayName: domain.displayName,
        description: domain.description,
        createdAt: domain.createdAt,
      },
      collections,
      exportedAt: this.now(),
    };

    this.appendAuditLog({
      accountId: domain.accountId,
      domain,
      actor,
      action: "domain.export",
      targetType: "domain",
      targetId: domain.id,
      requestId: requestId ?? null,
      metadata: {
        collection_count: collections.length,
      },
    });

    return snapshot;
  }

  importIntoDomain(input: {
    accountId: string;
    domainId: string;
    conflictPolicy: "fail" | "overwrite" | "skip";
    payload: ClientDataImportPayload;
    actor?: ClientDataAuditActor;
    requestId?: string | null;
  }): ClientDataImportResult {
    validateImportPayload(input.payload);

    return this.executeTransaction((tx) => {
      const service = new ClientDataService(tx, this.config, this.now);
      const domain = service.requireWritableDomain(service.requireOwnedDomain(input.accountId, input.domainId));
      const sourceDomain = input.payload.domain;
      if (
        sourceDomain.ownerType !== domain.ownerType
        || sourceDomain.ownerId !== domain.ownerId
        || sourceDomain.domainName !== domain.domainName
      ) {
        throw new ClientDataServiceError(409, "client_data_import_domain_mismatch", "Client data import payload domain does not match target domain");
      }
      const result = service.applyImportToDomain({
        accountId: input.accountId,
        domain,
        conflictPolicy: input.conflictPolicy,
        payload: input.payload,
      });
      service.appendAuditLog({
        accountId: result.domain.accountId,
        domain: result.domain,
        actor: input.actor,
        action: "domain.import",
        targetType: "domain",
        targetId: result.domain.id,
        requestId: input.requestId ?? null,
        metadata: {
          conflict_policy: result.summary.conflictPolicy,
          collections_created: result.summary.collectionsCreated,
          items_created: result.summary.itemsCreated,
          items_updated: result.summary.itemsUpdated,
          items_skipped: result.summary.itemsSkipped,
        },
      });
      return result;
    });
  }

  importAsNewDomain(input: {
    accountId: string;
    conflictPolicy: "fail" | "overwrite" | "skip";
    payload: ClientDataImportPayload;
    actor?: ClientDataAuditActor;
    requestId?: string | null;
  }): ClientDataImportResult {
    validateImportPayload(input.payload);

    return this.executeTransaction((tx) => {
      const service = new ClientDataService(tx, this.config, this.now);
      const payloadDomain = input.payload.domain;
      const domain = service.createDomain({
        accountId: input.accountId,
        ownerType: payloadDomain.ownerType,
        ownerId: payloadDomain.ownerId,
        domainName: payloadDomain.domainName,
        displayName: payloadDomain.displayName ?? undefined,
        description: payloadDomain.description ?? undefined,
        actor: input.actor,
        requestId: input.requestId ?? null,
      });
      const result = service.applyImportToDomain({
        accountId: input.accountId,
        domain,
        conflictPolicy: input.conflictPolicy,
        payload: input.payload,
      });
      service.appendAuditLog({
        accountId: result.domain.accountId,
        domain: result.domain,
        actor: input.actor,
        action: "domain.import",
        targetType: "domain",
        targetId: result.domain.id,
        requestId: input.requestId ?? null,
        metadata: {
          conflict_policy: result.summary.conflictPolicy,
          collections_created: result.summary.collectionsCreated,
          items_created: result.summary.itemsCreated,
          items_updated: result.summary.itemsUpdated,
          items_skipped: result.summary.itemsSkipped,
          import_mode: "new_domain",
        },
      });
      return result;
    });
  }

  createCollection(input: {
    accountId: string;
    domainId: string;
    collectionName: string;
    description?: string;
    defaultExpiresTtlMs?: number | null;
    maxItemSizeBytes?: number | null;
    metadataJson?: unknown;
  }): ClientDataCollectionRecord {
    const domain = this.requireWritableDomain(this.requireOwnedDomain(input.accountId, input.domainId));
    if (input.collectionName.length > 128) {
      throw new ClientDataServiceError(400, "validation_error", "collection_name must be 128 characters or less");
    }
    try {
      return this.repository.createCollection({
        domainId: domain.id,
        collectionName: input.collectionName,
        description: input.description,
        defaultExpiresTtlMs: input.defaultExpiresTtlMs,
        maxItemSizeBytes: input.maxItemSizeBytes,
        metadataJson: stringifyJsonField(input.metadataJson),
        now: this.now(),
      });
    } catch (error) {
      throw mapClientDataConstraintError(error) ?? error;
    }
  }

  listCollections(accountId: string, domainId: string): ClientDataCollectionRecord[] {
    const domain = this.requireReadableDomain(this.requireOwnedDomain(accountId, domainId));
    return this.repository.listCollections(domain.id);
  }

  getCollectionDetail(accountId: string, domainId: string, collectionId: string): ClientDataCollectionRecord {
    this.requireReadableDomain(this.requireOwnedDomain(accountId, domainId));
    return this.requireOwnedCollection(domainId, collectionId);
  }

  updateCollection(input: {
    accountId: string;
    domainId: string;
    collectionId: string;
    description?: string | null;
    defaultExpiresTtlMs?: number | null;
    maxItemSizeBytes?: number | null;
    metadataJson?: unknown;
    ifVersion?: number;
  }): ClientDataCollectionRecord {
    this.requireWritableDomain(this.requireOwnedDomain(input.accountId, input.domainId));
    this.requireOwnedCollection(input.domainId, input.collectionId);
    const updated = this.repository.updateCollection({
      collectionId: input.collectionId,
      description: input.description,
      defaultExpiresTtlMs: input.defaultExpiresTtlMs,
      maxItemSizeBytes: input.maxItemSizeBytes,
      metadataJson: input.metadataJson === undefined ? undefined : stringifyJsonField(input.metadataJson),
      ifVersion: input.ifVersion,
      now: this.now(),
    });
    if (!updated) {
      if (input.ifVersion !== undefined) {
        throw new ClientDataServiceError(409, "client_data_version_conflict", "Client data collection version conflict");
      }
      throw new ClientDataServiceError(404, "not_found", "Client data collection not found");
    }
    return updated;
  }

  deleteCollection(accountId: string, domainId: string, collectionId: string): ClientDataCollectionRecord {
    const domain = this.requireWritableDomain(this.requireOwnedDomain(accountId, domainId));
    const collection = this.requireOwnedCollection(domain.id, collectionId);
    const removedItems = this.repository.deleteItemsByCollectionId(collection.id);
    const deleted = this.repository.deleteCollection(collection.id);
    if (!deleted) {
      throw new ClientDataServiceError(404, "not_found", "Client data collection not found");
    }
    this.repository.updateDomainCounters(domain.id, -removedItems.length, -sumByteSize(removedItems), this.now());
    return deleted;
  }

  listItems(input: {
    accountId: string;
    domainId: string;
    collectionId?: string;
    itemKeyPrefix?: string;
    updatedAfter?: number;
    updatedBefore?: number;
    expiresAfter?: number;
    expiresBefore?: number;
    expired?: boolean;
    limit: number;
    offset: number;
    sortBy: "updated_at" | "created_at" | "item_key";
    sortOrder: "asc" | "desc";
  }) {
    const domain = this.requireReadableDomain(this.requireOwnedDomain(input.accountId, input.domainId));
    if (input.collectionId) {
      this.requireOwnedCollection(domain.id, input.collectionId);
    }
    return this.repository.listItems({
      domainId: domain.id,
      collectionId: input.collectionId,
      itemKeyPrefix: input.itemKeyPrefix,
      updatedAfter: input.updatedAfter,
      updatedBefore: input.updatedBefore,
      expiresAfter: input.expiresAfter,
      expiresBefore: input.expiresBefore,
      expired: input.expired,
      now: this.now(),
      limit: input.limit,
      offset: input.offset,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    });
  }

  getItemDetail(accountId: string, domainId: string, itemId: string): ClientDataItemRecord {
    this.requireReadableDomain(this.requireOwnedDomain(accountId, domainId));
    const item = this.repository.getItemById(itemId);
    if (!item || item.domainId !== domainId) {
      throw new ClientDataServiceError(404, "not_found", "Client data item not found");
    }
    return item;
  }

  getItemByKey(input: {
    accountId: string;
    domainId: string;
    collectionName: string;
    itemKey: string;
  }): ClientDataItemRecord {
    const domain = this.requireReadableDomain(this.requireOwnedDomain(input.accountId, input.domainId));
    const collection = this.repository.getCollectionByDomainName(domain.id, input.collectionName);
    if (!collection) {
      throw new ClientDataServiceError(404, "not_found", "Client data collection not found");
    }
    const item = this.repository.getItemByCollectionKey(collection.id, input.itemKey);
    if (!item) {
      throw new ClientDataServiceError(404, "not_found", "Client data item not found");
    }
    return item;
  }

  upsertItem(input: {
    accountId: string;
    domainId: string;
    collectionName: string;
    itemKey: string;
    valueJson: unknown;
    expiresAt?: number | null;
    ifVersion?: number;
  }): { action: "created" | "updated"; item: ClientDataItemRecord; collection: ClientDataCollectionRecord } {
    return this.upsertItemsBatch({
      accountId: input.accountId,
      domainId: input.domainId,
      items: [input],
    }).results[0]!;
  }

  upsertItemsBatch(input: {
    accountId: string;
    domainId: string;
    items: Array<{
      collectionName: string;
      itemKey: string;
      valueJson: unknown;
      expiresAt?: number | null;
      ifVersion?: number;
    }>;
  }): {
    results: Array<{ action: "created" | "updated"; item: ClientDataItemRecord; collection: ClientDataCollectionRecord }>;
  } {
    if (input.items.length === 0 || input.items.length > 100) {
      throw new ClientDataServiceError(400, "validation_error", "items length must be between 1 and 100");
    }

    return this.executeTransaction((tx) => {
      const service = new ClientDataService(tx, this.config, this.now);
      const domain = service.requireWritableDomain(service.requireOwnedDomain(input.accountId, input.domainId));
      const accountUsage = service.repository.getAccountUsageTotals(input.accountId);
      const results: Array<{ action: "created" | "updated"; item: ClientDataItemRecord; collection: ClientDataCollectionRecord }> = [];
      let accountEntries = accountUsage.totalEntries;
      let accountBytes = accountUsage.totalBytes;
      let domainEntries = domain.currentEntryCount;
      let domainBytes = domain.currentByteCount;

      for (const itemInput of input.items) {
        if (itemInput.collectionName.length > 128) {
          throw new ClientDataServiceError(400, "validation_error", "collection_name must be 128 characters or less");
        }
        if (itemInput.itemKey.length > 256) {
          throw new ClientDataServiceError(400, "validation_error", "item_key must be 256 characters or less");
        }

        let collection = service.repository.getCollectionByDomainName(domain.id, itemInput.collectionName);
        if (!collection) {
          try {
            collection = service.repository.createCollection({
              domainId: domain.id,
              collectionName: itemInput.collectionName,
              now: service.now(),
            });
          } catch (error) {
            const mappedError = mapClientDataConstraintError(error);
            if (!(mappedError instanceof ClientDataServiceError) || mappedError.code !== "client_data_collection_name_conflict") {
              throw mappedError ?? error;
            }
            collection = service.repository.getCollectionByDomainName(domain.id, itemInput.collectionName);
            if (!collection) {
              throw mappedError;
            }
          }
        }

        const valueJsonString = JSON.stringify(itemInput.valueJson);
        const byteSize = Buffer.byteLength(valueJsonString, "utf-8");
        const maxItemSizeBytes = collection.maxItemSizeBytes ?? this.config.defaultMaxItemSizeBytes;
        if (byteSize > maxItemSizeBytes) {
          throw new ClientDataServiceError(409, "client_data_item_too_large", "Client data item exceeds size limit");
        }

        const existing = service.repository.getItemByCollectionKey(collection.id, itemInput.itemKey);
        const expiresAt = resolveExpiresAt(itemInput.expiresAt, collection.defaultExpiresTtlMs, service.now());

        if (!existing) {
          if (domainEntries + 1 > domain.quotaMaxEntries) {
            throw new ClientDataServiceError(409, "client_data_domain_entries_quota_exceeded", "Client data domain entry quota exceeded");
          }
          if (domainBytes + byteSize > domain.quotaMaxBytes) {
            throw new ClientDataServiceError(409, "client_data_domain_bytes_quota_exceeded", "Client data domain byte quota exceeded");
          }
          if (accountEntries + 1 > this.config.maxTotalEntriesPerAccount) {
            throw new ClientDataServiceError(409, "client_data_account_entries_quota_exceeded", "Client data account entry quota exceeded");
          }
          if (accountBytes + byteSize > this.config.maxTotalBytesPerAccount) {
            throw new ClientDataServiceError(409, "client_data_account_bytes_quota_exceeded", "Client data account byte quota exceeded");
          }

          const created = service.repository.createItem({
            domainId: domain.id,
            collectionId: collection.id,
            itemKey: itemInput.itemKey,
            valueJson: valueJsonString,
            byteSize,
            expiresAt,
            now: service.now(),
          });
          service.repository.updateCollectionCounters(collection.id, 1, byteSize, service.now());
          service.repository.updateDomainCounters(domain.id, 1, byteSize, service.now());
          accountEntries += 1;
          accountBytes += byteSize;
          domainEntries += 1;
          domainBytes += byteSize;
          collection = service.requireOwnedCollection(domain.id, collection.id);
          results.push({ action: "created", item: created, collection });
          continue;
        }

        const deltaBytes = byteSize - existing.byteSize;
        if (domainBytes + deltaBytes > domain.quotaMaxBytes) {
          throw new ClientDataServiceError(409, "client_data_domain_bytes_quota_exceeded", "Client data domain byte quota exceeded");
        }
        if (accountBytes + deltaBytes > this.config.maxTotalBytesPerAccount) {
          throw new ClientDataServiceError(409, "client_data_account_bytes_quota_exceeded", "Client data account byte quota exceeded");
        }

        const updated = service.repository.updateItem({
          itemId: existing.id,
          valueJson: valueJsonString,
          ifVersion: itemInput.ifVersion,
          byteSize,
          expiresAt,
          now: service.now(),
        });
        if (!updated) {
          if (itemInput.ifVersion !== undefined) {
            throw new ClientDataServiceError(409, "client_data_version_conflict", "Client data item version conflict");
          }
          throw new ClientDataServiceError(500, "internal_error", "Failed to update client data item");
        }
        service.repository.updateCollectionCounters(collection.id, 0, deltaBytes, service.now());
        service.repository.updateDomainCounters(domain.id, 0, deltaBytes, service.now());
        accountBytes += deltaBytes;
        domainBytes += deltaBytes;
        collection = service.requireOwnedCollection(domain.id, collection.id);
        results.push({ action: "updated", item: updated, collection });
      }

      return { results };
    });
  }

  deleteItem(accountId: string, domainId: string, itemId: string): ClientDataItemRecord {
    const domain = this.requireWritableDomain(this.requireOwnedDomain(accountId, domainId));
    const item = this.getItemDetail(accountId, domain.id, itemId);
    const collection = this.requireOwnedCollection(domain.id, item.collectionId);
    const deleted = this.repository.deleteItem(item.id);
    if (!deleted) {
      throw new ClientDataServiceError(404, "not_found", "Client data item not found");
    }
    this.repository.updateCollectionCounters(collection.id, -1, -item.byteSize, this.now());
    this.repository.updateDomainCounters(domain.id, -1, -item.byteSize, this.now());
    return deleted;
  }

  deleteItemsBatch(input: { accountId: string; domainId: string; itemIds?: string[]; collectionId?: string }): ClientDataItemRecord[] {
    const domain = this.requireWritableDomain(this.requireOwnedDomain(input.accountId, input.domainId));
    if (!input.itemIds?.length && !input.collectionId) {
      throw new ClientDataServiceError(400, "validation_error", "Either item_ids or collection_id is required");
    }

    if (input.collectionId) {
      const collection = this.requireOwnedCollection(domain.id, input.collectionId);
      const deleted = this.repository.deleteItemsByCollectionId(collection.id);
      if (deleted.length > 0) {
        this.repository.updateCollectionCounters(collection.id, -deleted.length, -sumByteSize(deleted), this.now());
        this.repository.updateDomainCounters(domain.id, -deleted.length, -sumByteSize(deleted), this.now());
      }
      return deleted;
    }

    const deleted = this.repository.deleteItemsByIds(domain.id, input.itemIds ?? []);
    if (deleted.length > 0) {
      const group = new Map<string, { count: number; bytes: number }>();
      for (const item of deleted) {
        const current = group.get(item.collectionId) ?? { count: 0, bytes: 0 };
        current.count += 1;
        current.bytes += item.byteSize;
        group.set(item.collectionId, current);
      }
      for (const [collectionId, counters] of group.entries()) {
        this.repository.updateCollectionCounters(collectionId, -counters.count, -counters.bytes, this.now());
      }
      this.repository.updateDomainCounters(domain.id, -deleted.length, -sumByteSize(deleted), this.now());
    }
    return deleted;
  }

  listDomainGrants(input: {
    accountId: string;
    domainId: string;
    callerOwner: ClientDataCallerOwner | null;
  }): ClientDataDomainGrantRecord[] {
    const domain = this.requireManagedDomain(input.accountId, input.domainId, input.callerOwner);
    return this.repository.listDomainGrants(domain.id);
  }

  createDomainGrant(input: {
    accountId: string;
    domainId: string;
    callerOwner: ClientDataCallerOwner | null;
    granteeOwnerType: "application" | "plugin";
    granteeOwnerId: string;
    canRead: boolean;
    canWrite: boolean;
    canDelete: boolean;
    canList: boolean;
    expiresAt?: number | null;
    actor?: ClientDataAuditActor;
    requestId?: string | null;
  }): ClientDataDomainGrantRecord {
    const domain = this.requireManagedDomain(input.accountId, input.domainId, input.callerOwner);
    if (input.granteeOwnerType === domain.ownerType && input.granteeOwnerId === domain.ownerId) {
      throw new ClientDataServiceError(409, "client_data_domain_grant_owner_redundant", "Domain owner does not require an explicit grant");
    }

    let created: ClientDataDomainGrantRecord;
    try {
      created = this.repository.createDomainGrant({
        accountId: input.accountId,
        domainId: domain.id,
        granteeOwnerType: input.granteeOwnerType,
        granteeOwnerId: input.granteeOwnerId,
        canRead: input.canRead,
        canWrite: input.canWrite,
        canDelete: input.canDelete,
        canList: input.canList,
        expiresAt: input.expiresAt,
        now: this.now(),
      });
    } catch (error) {
      throw mapClientDataConstraintError(error) ?? error;
    }

    this.appendAuditLog({
      accountId: domain.accountId,
      domain,
      actor: input.actor,
      action: "grant.create",
      targetType: "grant",
      targetId: created.id,
      requestId: input.requestId ?? null,
      metadata: {
        grantee_owner_type: created.granteeOwnerType,
        grantee_owner_id: created.granteeOwnerId,
        can_read: created.canRead,
        can_write: created.canWrite,
        can_delete: created.canDelete,
        can_list: created.canList,
        expires_at: created.expiresAt,
      },
    });

    return created;
  }

  updateDomainGrant(input: {
    accountId: string;
    domainId: string;
    grantId: string;
    callerOwner: ClientDataCallerOwner | null;
    canRead?: boolean;
    canWrite?: boolean;
    canDelete?: boolean;
    canList?: boolean;
    expiresAt?: number | null;
    actor?: ClientDataAuditActor;
    requestId?: string | null;
  }): ClientDataDomainGrantRecord {
    const domain = this.requireManagedDomain(input.accountId, input.domainId, input.callerOwner);
    const existing = this.requireOwnedGrant(domain.id, input.grantId);
    const updated = this.repository.updateDomainGrant({
      grantId: input.grantId,
      canRead: input.canRead,
      canWrite: input.canWrite,
      canDelete: input.canDelete,
      canList: input.canList,
      expiresAt: input.expiresAt,
      now: this.now(),
    });
    if (!updated) {
      throw new ClientDataServiceError(404, "not_found", "Client data domain grant not found");
    }

    this.appendAuditLog({
      accountId: domain.accountId,
      domain,
      actor: input.actor,
      action: "grant.update",
      targetType: "grant",
      targetId: updated.id,
      requestId: input.requestId ?? null,
      metadata: {
        previous: existing,
        current: updated,
      },
    });

    return updated;
  }

  deleteDomainGrant(input: {
    accountId: string;
    domainId: string;
    grantId: string;
    callerOwner: ClientDataCallerOwner | null;
    actor?: ClientDataAuditActor;
    requestId?: string | null;
  }): ClientDataDomainGrantRecord {
    const domain = this.requireManagedDomain(input.accountId, input.domainId, input.callerOwner);
    this.requireOwnedGrant(domain.id, input.grantId);
    const deleted = this.repository.deleteDomainGrant(input.grantId);
    if (!deleted) {
      throw new ClientDataServiceError(404, "not_found", "Client data domain grant not found");
    }

    this.appendAuditLog({
      accountId: domain.accountId,
      domain,
      actor: input.actor,
      action: "grant.delete",
      targetType: "grant",
      targetId: deleted.id,
      requestId: input.requestId ?? null,
      metadata: {
        grantee_owner_type: deleted.granteeOwnerType,
        grantee_owner_id: deleted.granteeOwnerId,
      },
    });

    return deleted;
  }

  listAuditLogs(input: {
    accountId: string;
    domainId: string;
    callerOwner: ClientDataCallerOwner | null;
    actorType?: string;
    action?: string;
    limit: number;
    offset: number;
    sortOrder: "asc" | "desc";
  }): { rows: ClientDataAuditLogRecord[]; total: number } {
    const domain = this.requireManagedDomain(input.accountId, input.domainId, input.callerOwner);
    return this.repository.listAuditLogs({
      domainId: domain.id,
      actorType: input.actorType,
      action: input.action,
      limit: input.limit,
      offset: input.offset,
      sortOrder: input.sortOrder,
    });
  }

  assertRawDomainAccessAllowed(accountId: string, domainId: string): ClientDataDomainRecord {
    const domain = this.requireOwnedDomain(accountId, domainId);
    if (this.repository.getManagedDomainByDomainId(domain.id)) {
      throw new ClientDataServiceError(
        403,
        "client_data_managed_domain_raw_access_forbidden",
        "Managed client data domains must be accessed through their governance service",
      );
    }
    return domain;
  }

  assertRawOwnerDeletionAllowed(accountId: string, ownerType: "application" | "plugin", ownerId: string): void {
    const managedDomainIds = new Set(this.repository.listManagedDomainIdsByAccount(accountId));
    const candidateDomains = this.repository.listDomains({
      accountId,
      ownerType,
      ownerId,
      limit: this.config.maxDomainsPerAccount + 1,
      offset: 0,
      sortBy: "updated_at",
      sortOrder: "desc",
    }).rows;

    if (candidateDomains.some((domain) => managedDomainIds.has(domain.id))) {
      throw new ClientDataServiceError(
        403,
        "client_data_managed_domain_raw_access_forbidden",
        "Managed client data domains must be accessed through their governance service",
      );
    }
  }

  authorizeDomainAccess(input: {
    accountId: string;
    domainId: string;
    callerOwner: ClientDataCallerOwner | null;
    permission: "read" | "write" | "delete" | "list";
  }): ClientDataDomainRecord {
    const domain = this.requireOwnedDomain(input.accountId, input.domainId);
    if (!input.callerOwner) {
      return input.permission === "write" || input.permission === "delete"
        ? this.requireWritableDomain(domain)
        : this.requireReadableDomain(domain);
    }

    if (domain.ownerType === input.callerOwner.ownerType && domain.ownerId === input.callerOwner.ownerId) {
      return input.permission === "write" || input.permission === "delete"
        ? this.requireWritableDomain(domain)
        : this.requireReadableDomain(domain);
    }

    const grant = this.repository.findGrantForOwner({
      domainId: domain.id,
      granteeOwnerType: input.callerOwner.ownerType,
      granteeOwnerId: input.callerOwner.ownerId,
      now: this.now(),
    });
    if (!grant) {
      throw new ClientDataServiceError(403, "client_data_domain_forbidden", "Client data domain access is not granted for caller owner");
    }

    const allowed = input.permission === "read"
      ? grant.canRead
      : input.permission === "write"
        ? grant.canWrite
        : input.permission === "delete"
          ? grant.canDelete
          : grant.canList;
    if (!allowed) {
      throw new ClientDataServiceError(403, "client_data_domain_forbidden", "Client data domain access is not granted for caller owner");
    }

    return input.permission === "write" || input.permission === "delete"
      ? this.requireWritableDomain(domain)
      : this.requireReadableDomain(domain);
  }

  requireOwnedDomain(accountId: string, domainId: string): ClientDataDomainRecord {
    const domain = this.repository.getDomainById(domainId);
    if (!domain || domain.accountId !== accountId) {
      throw new ClientDataServiceError(404, "not_found", "Client data domain not found");
    }
    return domain;
  }

  requireReadableDomain(domain: ClientDataDomainRecord): ClientDataDomainRecord {
    if (domain.status === "deleted") {
      throw new ClientDataServiceError(410, "client_data_domain_deleted", "Client data domain has been deleted");
    }
    return domain;
  }

  requireWritableDomain(domain: ClientDataDomainRecord): ClientDataDomainRecord {
    const readableDomain = this.requireReadableDomain(domain);
    if (readableDomain.status === "suspended") {
      throw new ClientDataServiceError(409, "client_data_domain_suspended", "Client data domain is suspended for write operations");
    }
    return readableDomain;
  }

  requireOwnedCollection(domainId: string, collectionId: string): ClientDataCollectionRecord {
    const collection = this.repository.getCollectionById(collectionId);
    if (!collection || collection.domainId !== domainId) {
      throw new ClientDataServiceError(404, "not_found", "Client data collection not found");
    }
    return collection;
  }

  private requireManagedDomain(
    accountId: string,
    domainId: string,
    callerOwner: ClientDataCallerOwner | null,
  ): ClientDataDomainRecord {
    const domain = this.requireOwnedDomain(accountId, domainId);
    if (!callerOwner) {
      return domain;
    }
    if (domain.ownerType === callerOwner.ownerType && domain.ownerId === callerOwner.ownerId) {
      return domain;
    }
    throw new ClientDataServiceError(403, "client_data_domain_grant_manage_forbidden", "Only domain owner can manage grants or audit logs");
  }

  private requireOwnedGrant(domainId: string, grantId: string): ClientDataDomainGrantRecord {
    const grant = this.repository.getDomainGrantById(grantId);
    if (!grant || grant.domainId !== domainId) {
      throw new ClientDataServiceError(404, "not_found", "Client data domain grant not found");
    }
    return grant;
  }

  private applyImportToDomain(input: {
    accountId: string;
    domain: ClientDataDomainRecord;
    conflictPolicy: "fail" | "overwrite" | "skip";
    payload: ClientDataImportPayload;
  }): ClientDataImportResult {
    const accountUsage = this.repository.getAccountUsageTotals(input.accountId);
    const collections: ClientDataCollectionRecord[] = [];
    let collectionsCreated = 0;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let itemsSkipped = 0;
    let importedItemCount = 0;
    let importedByteCount = 0;
    let accountEntries = accountUsage.totalEntries;
    let accountBytes = accountUsage.totalBytes;
    let domainEntries = input.domain.currentEntryCount;
    let domainBytes = input.domain.currentByteCount;

    for (const collectionInput of input.payload.collections) {
      let collection = this.repository.getCollectionByDomainName(input.domain.id, collectionInput.collectionName);
      if (!collection) {
        collection = this.repository.createCollection({
          domainId: input.domain.id,
          collectionName: collectionInput.collectionName,
          description: collectionInput.description ?? undefined,
          defaultExpiresTtlMs: collectionInput.defaultExpiresTtlMs,
          maxItemSizeBytes: collectionInput.maxItemSizeBytes,
          metadataJson: stringifyJsonField(collectionInput.metadataJson),
          now: this.now(),
        });
        collectionsCreated += 1;
      }

      if (
        collectionInput.description !== collection.description
        || collectionInput.defaultExpiresTtlMs !== collection.defaultExpiresTtlMs
        || collectionInput.maxItemSizeBytes !== collection.maxItemSizeBytes
        || stringifyJsonField(collectionInput.metadataJson) !== collection.metadataJson
      ) {
        const updatedCollection = this.repository.updateCollection({
          collectionId: collection.id,
          description: collectionInput.description,
          defaultExpiresTtlMs: collectionInput.defaultExpiresTtlMs,
          maxItemSizeBytes: collectionInput.maxItemSizeBytes,
          metadataJson: stringifyJsonField(collectionInput.metadataJson),
          now: this.now(),
        });
        if (!updatedCollection) {
          throw new ClientDataServiceError(500, "internal_error", "Failed to update imported client data collection metadata");
        }
        collection = updatedCollection;
      }

      const maxItemSizeBytes = collection.maxItemSizeBytes ?? this.config.defaultMaxItemSizeBytes;

      for (const itemInput of collectionInput.items) {
        const itemValueJson = JSON.stringify(itemInput.valueJson);
        const byteSize = Buffer.byteLength(itemValueJson, "utf-8");
        if (byteSize > maxItemSizeBytes) {
          throw new ClientDataServiceError(409, "client_data_item_too_large", "Client data item exceeds size limit");
        }

        const existing = this.repository.getItemByCollectionKey(collection.id, itemInput.itemKey);
        if (existing && input.conflictPolicy === "fail") {
          throw new ClientDataServiceError(409, "client_data_import_conflict", "Client data import conflict detected");
        }
        if (existing && input.conflictPolicy === "skip") {
          itemsSkipped += 1;
          continue;
        }

        if (!existing) {
          if (domainEntries + 1 > input.domain.quotaMaxEntries) {
            throw new ClientDataServiceError(409, "client_data_domain_entries_quota_exceeded", "Client data domain entry quota exceeded");
          }
          if (domainBytes + byteSize > input.domain.quotaMaxBytes) {
            throw new ClientDataServiceError(409, "client_data_domain_bytes_quota_exceeded", "Client data domain byte quota exceeded");
          }
          if (accountEntries + 1 > this.config.maxTotalEntriesPerAccount) {
            throw new ClientDataServiceError(409, "client_data_account_entries_quota_exceeded", "Client data account entry quota exceeded");
          }
          if (accountBytes + byteSize > this.config.maxTotalBytesPerAccount) {
            throw new ClientDataServiceError(409, "client_data_account_bytes_quota_exceeded", "Client data account byte quota exceeded");
          }

          this.repository.createItem({
            domainId: input.domain.id,
            collectionId: collection.id,
            itemKey: itemInput.itemKey,
            valueJson: itemValueJson,
            byteSize,
            expiresAt: itemInput.expiresAt,
            now: this.now(),
          });
          this.repository.updateCollectionCounters(collection.id, 1, byteSize, this.now());
          this.repository.updateDomainCounters(input.domain.id, 1, byteSize, this.now());
          accountEntries += 1;
          accountBytes += byteSize;
          domainEntries += 1;
          domainBytes += byteSize;
          importedItemCount += 1;
          importedByteCount += byteSize;
          itemsCreated += 1;
          continue;
        }

        const deltaBytes = byteSize - existing.byteSize;
        if (domainBytes + deltaBytes > input.domain.quotaMaxBytes) {
          throw new ClientDataServiceError(409, "client_data_domain_bytes_quota_exceeded", "Client data domain byte quota exceeded");
        }
        if (accountBytes + deltaBytes > this.config.maxTotalBytesPerAccount) {
          throw new ClientDataServiceError(409, "client_data_account_bytes_quota_exceeded", "Client data account byte quota exceeded");
        }

        const updated = this.repository.updateItem({
          itemId: existing.id,
          valueJson: itemValueJson,
          byteSize,
          expiresAt: itemInput.expiresAt,
          now: this.now(),
        });
        if (!updated) {
          throw new ClientDataServiceError(500, "internal_error", "Failed to update imported client data item");
        }
        this.repository.updateCollectionCounters(collection.id, 0, deltaBytes, this.now());
        this.repository.updateDomainCounters(input.domain.id, 0, deltaBytes, this.now());
        accountBytes += deltaBytes;
        domainBytes += deltaBytes;
        importedItemCount += 1;
        importedByteCount += byteSize;
        itemsUpdated += 1;
      }

      collections.push(this.requireOwnedCollection(input.domain.id, collection.id));
    }

    return {
      domain: this.requireOwnedDomain(input.accountId, input.domain.id),
      collections,
      summary: {
        collectionsCreated,
        itemsCreated,
        itemsUpdated,
        itemsSkipped,
        importedItemCount,
        importedByteCount,
        conflictPolicy: input.conflictPolicy,
      },
    };
  }

  private appendAuditLog(input: {
    accountId: string;
    domain: ClientDataDomainRecord | null;
    ownerType?: "application" | "plugin" | null;
    ownerId?: string | null;
    actor?: ClientDataAuditActor;
    action: string;
    targetType: string;
    targetId?: string | null;
    requestId?: string | null;
    metadata?: unknown;
  }): void {
    this.repository.appendAuditLog({
      accountId: input.accountId,
      domainId: input.domain?.id ?? null,
      ownerType: input.domain?.ownerType ?? input.ownerType ?? null,
      ownerId: input.domain?.ownerId ?? input.ownerId ?? null,
      actorType: input.actor?.actorType ?? "account",
      actorId: input.actor?.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      requestId: input.requestId ?? null,
      metadataJson: input.metadata === undefined ? null : stringifyJsonField(input.metadata),
      createdAt: this.now(),
    });
  }

  private executeTransaction<T>(action: (tx: DbExecutor) => T): T {
    if (hasTransaction(this.db)) {
      return this.db.transaction((tx) => action(tx));
    }
    return action(this.db);
  }
}

export class ClientDataServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ClientDataServiceError";
  }
}

function hasTransaction(db: AppDb | DbExecutor): db is AppDb {
  return typeof (db as AppDb).transaction === "function";
}

function resolveExpiresAt(expiresAt: number | null | undefined, defaultExpiresTtlMs: number | null, now: number): number | null {
  if (expiresAt !== undefined) {
    return expiresAt;
  }
  if (defaultExpiresTtlMs !== null && defaultExpiresTtlMs !== undefined) {
    return now + defaultExpiresTtlMs;
  }
  return null;
}

function sumByteSize(items: ClientDataItemRecord[]): number {
  return items.reduce((sum, item) => sum + item.byteSize, 0);
}

function validateImportPayload(payload: ClientDataImportPayload): void {
  if (payload.domain.ownerId.trim().length === 0 || payload.domain.domainName.trim().length === 0) {
    throw new ClientDataServiceError(400, "validation_error", "Client data import payload domain is invalid");
  }

  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf-8");
  if (payloadBytes > MAX_IMPORT_PAYLOAD_BYTES) {
    throw new ClientDataServiceError(400, "client_data_import_payload_too_large", "Client data import payload exceeds size limit");
  }

  let itemCount = 0;
  for (const collection of payload.collections) {
    if (collection.collectionName.trim().length === 0 || collection.collectionName.length > 128) {
      throw new ClientDataServiceError(400, "validation_error", "collection_name must be between 1 and 128 characters");
    }
    for (const item of collection.items) {
      itemCount += 1;
      if (item.itemKey.trim().length === 0 || item.itemKey.length > 256) {
        throw new ClientDataServiceError(400, "validation_error", "item_key must be between 1 and 256 characters");
      }
    }
  }

  if (itemCount > MAX_IMPORT_ITEMS) {
    throw new ClientDataServiceError(400, "client_data_import_item_limit_exceeded", "Client data import item count exceeds limit");
  }
}

function mapClientDataConstraintError(error: unknown): ClientDataServiceError | null {
  const code = typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : null;
  if (!code?.startsWith("SQLITE_CONSTRAINT")) {
    return null;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("client_data_domain_owner_name_uq") || message.includes("client_data_domain.account_id, client_data_domain.owner_type, client_data_domain.owner_id, client_data_domain.domain_name")) {
    return new ClientDataServiceError(409, "client_data_domain_name_conflict", "Client data domain owner/name already exists");
  }

  if (message.includes("client_data_collection_domain_name_uq") || message.includes("client_data_collection.domain_id, client_data_collection.collection_name")) {
    return new ClientDataServiceError(409, "client_data_collection_name_conflict", "Client data collection name already exists in domain");
  }

  if (message.includes("client_data_domain_grant_unique_uq") || message.includes("client_data_domain_grant.domain_id, client_data_domain_grant.grantee_owner_type, client_data_domain_grant.grantee_owner_id")) {
    return new ClientDataServiceError(409, "client_data_domain_grant_conflict", "Client data domain grant already exists for grantee owner");
  }

  if (message.includes("client_data_managed_domain_account_manager_host_namespace_uq") || message.includes("client_data_managed_domain.account_id, client_data_managed_domain.manager_kind, client_data_managed_domain.host_type, client_data_managed_domain.host_id, client_data_managed_domain.state_namespace")) {
    return new ClientDataServiceError(409, "client_data_managed_domain_conflict", "Client data managed domain registry already exists for host namespace");
  }

  return null;
}

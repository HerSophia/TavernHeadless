import { Buffer } from "node:buffer";

import type { AppDb, DbExecutor } from "../db/client.js";
import { parseJsonField, stringifyJsonField } from "../lib/http.js";
import { ClientDataRepository, type ClientDataCollectionRecord, type ClientDataDomainRecord, type ClientDataItemRecord } from "./client-data-repository.js";

export interface ClientDataConfig {
  defaultMaxItemSizeBytes: number;
  defaultQuotaMaxEntries: number;
  defaultQuotaMaxBytes: number;
  maxDomainsPerAccount: number;
  maxTotalEntriesPerAccount: number;
  maxTotalBytesPerAccount: number;
}

export interface ClientDataDomainDetail extends ClientDataDomainRecord {
  quotaUsage: {
    entryCount: number;
    byteCount: number;
  };
}

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
  }): ClientDataDomainRecord {
    const existingDomainCount = this.repository.countActiveDomainsByAccount(input.accountId);
    if (existingDomainCount >= this.config.maxDomainsPerAccount) {
      throw new ClientDataServiceError(409, "client_data_account_domain_limit_exceeded", "Client data domain limit exceeded for account");
    }

    return this.repository.createDomain({
      ...input,
      quotaMaxEntries: this.config.defaultQuotaMaxEntries,
      quotaMaxBytes: this.config.defaultQuotaMaxBytes,
      now: this.now(),
    });
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
    return this.repository.listDomains(input);
  }

  getOwnedDomainDetail(accountId: string, domainId: string): ClientDataDomainDetail {
    const domain = this.requireReadableDomain(this.requireOwnedDomain(accountId, domainId));
    return {
      ...domain,
      quotaUsage: {
        entryCount: domain.currentEntryCount,
        byteCount: domain.currentByteCount,
      },
    };
  }

  updateDomain(input: {
    accountId: string;
    domainId: string;
    displayName?: string | null;
    description?: string | null;
  }): ClientDataDomainRecord {
    this.requireReadableDomain(this.requireOwnedDomain(input.accountId, input.domainId));
    const updated = this.repository.updateDomain({
      domainId: input.domainId,
      displayName: input.displayName,
      description: input.description,
      now: this.now(),
    });
    if (!updated) {
      throw new ClientDataServiceError(404, "not_found", "Client data domain not found");
    }
    return updated;
  }

  deleteDomain(accountId: string, domainId: string): ClientDataDomainRecord {
    this.requireOwnedDomain(accountId, domainId);
    const deleted = this.repository.softDeleteDomain(domainId, this.now());
    if (!deleted) {
      throw new ClientDataServiceError(404, "not_found", "Client data domain not found");
    }
    return deleted;
  }

  deleteDomainsByOwner(input: { accountId: string; ownerType: "application" | "plugin"; ownerId: string }): ClientDataDomainRecord[] {
    return this.repository.softDeleteDomainsByOwner({ ...input, now: this.now() });
  }

  exportDomain(accountId: string, domainId: string) {
    const domain = this.requireReadableDomain(this.requireOwnedDomain(accountId, domainId));
    const collections = this.repository.listItemsForExport(domain.id).map((entry) => ({
      collection_name: entry.collection.collectionName,
      description: entry.collection.description,
      default_expires_ttl_ms: entry.collection.defaultExpiresTtlMs,
      max_item_size_bytes: entry.collection.maxItemSizeBytes,
      metadata_json: parseJsonField(entry.collection.metadataJson),
      items: entry.items.map((item) => ({
        item_key: item.itemKey,
        value_json: parseJsonField(item.valueJson),
        version: item.version,
        expires_at: item.expiresAt,
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      })),
    }));

    return {
      domain: {
        id: domain.id,
        owner_type: domain.ownerType,
        owner_id: domain.ownerId,
        domain_name: domain.domainName,
        display_name: domain.displayName,
        description: domain.description,
        created_at: domain.createdAt,
      },
      collections,
      exported_at: this.now(),
    };
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
    return this.repository.createCollection({
      domainId: domain.id,
      collectionName: input.collectionName,
      description: input.description,
      defaultExpiresTtlMs: input.defaultExpiresTtlMs,
      maxItemSizeBytes: input.maxItemSizeBytes,
      metadataJson: stringifyJsonField(input.metadataJson),
      now: this.now(),
    });
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
  }): ClientDataCollectionRecord {
    this.requireWritableDomain(this.requireOwnedDomain(input.accountId, input.domainId));
    this.requireOwnedCollection(input.domainId, input.collectionId);
    const updated = this.repository.updateCollection({
      collectionId: input.collectionId,
      description: input.description,
      defaultExpiresTtlMs: input.defaultExpiresTtlMs,
      maxItemSizeBytes: input.maxItemSizeBytes,
      metadataJson: input.metadataJson === undefined ? undefined : stringifyJsonField(input.metadataJson),
      now: this.now(),
    });
    if (!updated) {
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
          collection = service.repository.createCollection({
            domainId: domain.id,
            collectionName: itemInput.collectionName,
            now: service.now(),
          });
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

        if (itemInput.ifVersion !== undefined && itemInput.ifVersion !== existing.version) {
          throw new ClientDataServiceError(409, "client_data_version_conflict", "Client data item version conflict");
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
          byteSize,
          expiresAt,
          now: service.now(),
        });
        if (!updated) {
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

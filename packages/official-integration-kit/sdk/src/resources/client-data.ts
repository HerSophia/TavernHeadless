import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { buildQueryString, compactObject, readArray, readBoolean, readNullableNumber, readNullableString, readNumber, readRecord, readString } from "./utils.js";

export type ClientDataOwnerType = "application" | "plugin";
export type ClientDataDomainStatus = "active" | "suspended" | "deleted";
export type ClientDataCallerOwner = {
  ownerType: ClientDataOwnerType;
  ownerId: string;
};


export type ClientDataDomainRecord = {
  id: string;
  ownerType: ClientDataOwnerType;
  ownerId: string;
  domainName: string;
  displayName: string | null;
  description: string | null;
  status: ClientDataDomainStatus;
  version: number;
  quotaMaxEntries: number;
  quotaMaxBytes: number;
  currentEntryCount: number;
  currentByteCount: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type ClientDataDomainDetail = ClientDataDomainRecord & {
  quotaUsage: {
    entryCount: number;
    byteCount: number;
  };
  restorableUntil: number | null;
};

export type ClientDataCollectionRecord = {
  id: string;
  domainId: string;
  collectionName: string;
  description: string | null;
  defaultExpiresTtlMs: number | null;
  maxItemSizeBytes: number | null;
  version: number;
  metadataJson: unknown;
  itemCount: number;
  byteCount: number;
  createdAt: number;
  updatedAt: number;
};

export type ClientDataItemRecord = {
  id: string;
  domainId: string;
  collectionId: string;
  itemKey: string;
  valueJson: unknown;
  byteSize: number;
  version: number;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ClientDataGrantRecord = {
  id: string;
  domainId: string;
  granteeOwnerType: ClientDataOwnerType;
  granteeOwnerId: string;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canList: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
};

export type ClientDataAuditLogRecord = {
  id: string;
  accountId: string;
  domainId: string | null;
  ownerType: ClientDataOwnerType | null;
  ownerId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  requestId: string | null;
  metadataJson: unknown;
  createdAt: number;
};

export type ClientDataDomainsListResult = {
  data: ClientDataDomainRecord[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    sortBy: string;
    sortOrder: "asc" | "desc";
  };
};

export type ClientDataAuditLogsListResult = {
  data: ClientDataAuditLogRecord[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    sortBy: string;
    sortOrder: "asc" | "desc";
  };
};

export type ClientDataItemsListResult = {
  data: ClientDataItemRecord[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    sortBy: string;
    sortOrder: "asc" | "desc";
  };
};

export type ClientDataExportResult = {
  domain: {
    id: string;
    ownerType: ClientDataOwnerType;
    ownerId: string;
    domainName: string;
    displayName: string | null;
    description: string | null;
    createdAt: number;
  };
  collections: Array<{
    collectionName: string;
    description: string | null;
    defaultExpiresTtlMs: number | null;
    maxItemSizeBytes: number | null;
    metadataJson: unknown;
    items: Array<{
      itemKey: string;
      valueJson: unknown;
      version: number;
      expiresAt: number | null;
      createdAt: number;
      updatedAt: number;
    }>;
  }>;
  exportedAt: number;
};

export type ClientDataImportPayload = {
  domain: {
    ownerType: ClientDataOwnerType;
    ownerId: string;
    domainName: string;
    displayName?: string | null;
    description?: string | null;
  };
  collections: Array<{
    collectionName: string;
    description: string | null;
    defaultExpiresTtlMs: number | null;
    maxItemSizeBytes: number | null;
    metadataJson: unknown;
    items: Array<{
      itemKey: string;
      valueJson: unknown;
      version?: number;
      expiresAt: number | null;
      createdAt?: number;
      updatedAt?: number;
    }>;
  }>;
};

export type ClientDataImportResult = {
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
};

export type ClientDataResource = {
  domains: {
    create(options: {
      accountId?: AccountIdHint;
      ownerType: ClientDataOwnerType;
      ownerId: string;
      domainName: string;
      displayName?: string;
      description?: string;
    }): Promise<ClientDataDomainRecord>;
    list(options?: {
      accountId?: AccountIdHint;
      ownerType?: ClientDataOwnerType;
      ownerId?: string;
      status?: ClientDataDomainStatus;
      limit?: number;
      offset?: number;
      sortBy?: "updated_at" | "created_at" | "domain_name";
      sortOrder?: "asc" | "desc";
    }): Promise<ClientDataDomainsListResult>;
    getDetail(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string }): Promise<ClientDataDomainDetail>;
    update(options: {
      accountId?: AccountIdHint;
      callerOwner?: ClientDataCallerOwner;
      domainId: string;
      displayName?: string | null;
      description?: string | null;
      ifVersion?: number;
    }): Promise<ClientDataDomainRecord>;
    updateQuota(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string; quotaMaxEntries: number; quotaMaxBytes: number }): Promise<ClientDataDomainRecord>;
    restore(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string }): Promise<ClientDataDomainRecord>;
    import(options: {
      accountId?: AccountIdHint;
      callerOwner?: ClientDataCallerOwner;
      domainId: string;
      conflictPolicy: "fail" | "overwrite" | "skip";
      payload: ClientDataImportPayload;
    }): Promise<ClientDataImportResult>;
    importAsNew(options: { accountId?: AccountIdHint; conflictPolicy: "fail" | "overwrite" | "skip"; payload: ClientDataImportPayload }): Promise<ClientDataImportResult>;
    remove(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string }): Promise<boolean>;
    removeByOwner(options: { accountId?: AccountIdHint; ownerType: ClientDataOwnerType; ownerId: string }): Promise<ClientDataDomainRecord[]>;
    export(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string }): Promise<ClientDataExportResult>;
  };
  collections: {
    create(options: {
      accountId?: AccountIdHint;
      callerOwner?: ClientDataCallerOwner;
      domainId: string;
      collectionName: string;
      description?: string;
      defaultExpiresTtlMs?: number | null;
      maxItemSizeBytes?: number | null;
      metadataJson?: unknown;
    }): Promise<ClientDataCollectionRecord>;
    list(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string }): Promise<ClientDataCollectionRecord[]>;
    getDetail(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string; collectionId: string }): Promise<ClientDataCollectionRecord>;
    update(options: {
      accountId?: AccountIdHint;
      callerOwner?: ClientDataCallerOwner;
      domainId: string;
      collectionId: string;
      description?: string | null;
      defaultExpiresTtlMs?: number | null;
      maxItemSizeBytes?: number | null;
      metadataJson?: unknown;
      ifVersion?: number;
    }): Promise<ClientDataCollectionRecord>;
    remove(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string; collectionId: string }): Promise<boolean>;
  };
  items: {
    list(options: {
      accountId?: AccountIdHint;
      callerOwner?: ClientDataCallerOwner;
      domainId: string;
      collectionId?: string;
      itemKeyPrefix?: string;
      updatedAfter?: number;
      updatedBefore?: number;
      expiresAfter?: number;
      expiresBefore?: number;
      expired?: boolean;
      limit?: number;
      offset?: number;
      sortBy?: "updated_at" | "created_at" | "item_key";
      sortOrder?: "asc" | "desc";
    }): Promise<ClientDataItemsListResult>;
    getDetail(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string; itemId: string }): Promise<ClientDataItemRecord>;
    getByKey(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string; collectionName: string; itemKey: string }): Promise<ClientDataItemRecord>;
    upsert(options: {
      accountId?: AccountIdHint;
      callerOwner?: ClientDataCallerOwner;
      domainId: string;
      collectionName: string;
      itemKey: string;
      valueJson: unknown;
      expiresAt?: number | null;
      ifVersion?: number;
    }): Promise<{ action: string; collection: ClientDataCollectionRecord; item: ClientDataItemRecord }>;
    upsertBatch(options: {
      accountId?: AccountIdHint;
      callerOwner?: ClientDataCallerOwner;
      domainId: string;
      items: Array<{
        collectionName: string;
        itemKey: string;
        valueJson: unknown;
        expiresAt?: number | null;
        ifVersion?: number;
      }>;
    }): Promise<{ results: Array<{ action: string; collection: ClientDataCollectionRecord; item: ClientDataItemRecord }> }>;
    remove(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string; itemId: string }): Promise<boolean>;
    removeBatch(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string; itemIds?: string[]; collectionId?: string }): Promise<Array<{ id: string; collectionId: string; itemKey: string }>>;
  };
  grants: {
    list(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string }): Promise<ClientDataGrantRecord[]>;
    create(options: {
      accountId?: AccountIdHint;
      callerOwner?: ClientDataCallerOwner;
      domainId: string;
      granteeOwnerType: ClientDataOwnerType;
      granteeOwnerId: string;
      canRead: boolean;
      canWrite: boolean;
      canDelete: boolean;
      canList: boolean;
      expiresAt?: number | null;
    }): Promise<ClientDataGrantRecord>;
    update(options: {
      accountId?: AccountIdHint;
      callerOwner?: ClientDataCallerOwner;
      domainId: string;
      grantId: string;
      canRead?: boolean;
      canWrite?: boolean;
      canDelete?: boolean;
      canList?: boolean;
      expiresAt?: number | null;
    }): Promise<ClientDataGrantRecord>;
    remove(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string; grantId: string }): Promise<boolean>;
  };
  auditLogs: {
    list(options: { accountId?: AccountIdHint; callerOwner?: ClientDataCallerOwner; domainId: string; actorType?: string; action?: string; limit?: number; offset?: number; sortOrder?: "asc" | "desc" }): Promise<ClientDataAuditLogsListResult>;
  };
};

function buildClientDataHeaders(
  accountId?: AccountIdHint,
  callerOwner?: ClientDataCallerOwner,
): Record<string, string> | undefined {
  const headers = {
    ...(buildAccountHeaders(accountId) ?? {}),
    ...(callerOwner
      ? {
          "x-client-owner-type": callerOwner.ownerType,
          "x-client-owner-id": callerOwner.ownerId,
        }
      : {}),
  };

  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function createClientDataResource(client: TransportClient): ClientDataResource {
  return {
    domains: {
      async create(options) {
        const response = await client.fetchJson<Record<string, unknown>>("/client-data/domains", {
          method: "POST",
          headers: buildAccountHeaders(options.accountId),
          body: compactObject({
            owner_type: options.ownerType,
            owner_id: options.ownerId,
            domain_name: options.domainName,
            display_name: options.displayName,
            description: options.description,
          }),
        });
        return requireDomain(readRecord(response.body)?.data, "Client data domain create returned an invalid payload");
      },
      async list(options = {}) {
        const query = buildQueryString({
          owner_type: options.ownerType,
          owner_id: options.ownerId,
          status: options.status,
          limit: options.limit ?? 100,
          offset: options.offset ?? 0,
          sort_by: options.sortBy ?? "updated_at",
          sort_order: options.sortOrder ?? "desc",
        });
        const pathname = query ? `/client-data/domains?${query}` : "/client-data/domains";
        const response = await client.fetchJson<Record<string, unknown>>(pathname, {
          method: "GET",
          headers: buildAccountHeaders(options.accountId),
        });
        return {
          data: readArray(readRecord(response.body)?.data).map(mapDomain).filter((item): item is ClientDataDomainRecord => item !== null),
          meta: mapListMeta(readRecord(response.body)?.meta),
        };
      },
      async getDetail(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}`, {
          method: "GET",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return requireDomainDetail(readRecord(response.body)?.data, "Client data domain detail returned an invalid payload");
      },
      async update(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}`, {
          method: "PATCH",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
          body: compactObject({
            display_name: options.displayName,
            description: options.description,
            if_version: options.ifVersion,
          }),
        });
        return requireDomain(readRecord(response.body)?.data, "Client data domain update returned an invalid payload");
      },
      async updateQuota(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/quota`, {
          method: "PATCH",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
          body: compactObject({
            quota_max_entries: options.quotaMaxEntries,
            quota_max_bytes: options.quotaMaxBytes,
          }),
        });
        return requireDomain(readRecord(response.body)?.data, "Client data domain quota update returned an invalid payload");
      },
      async restore(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/restore`, {
          method: "POST",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return requireDomain(readRecord(response.body)?.data, "Client data domain restore returned an invalid payload");
      },
      async import(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/import`, {
          method: "POST",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
          body: {
            conflict_policy: options.conflictPolicy,
            payload: toImportPayloadBody(options.payload),
          },
        });
        return requireImportResult(readRecord(response.body)?.data, "Client data domain import returned an invalid payload");
      },
      async importAsNew(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/import`, {
          method: "POST",
          headers: buildAccountHeaders(options.accountId),
          body: {
            conflict_policy: options.conflictPolicy,
            payload: toImportPayloadBody(options.payload),
          },
        });
        return requireImportResult(readRecord(response.body)?.data, "Client data domain import-as-new returned an invalid payload");
      },
      async remove(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}`, {
          method: "DELETE",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
      },
      async removeByOwner(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/owners/${encodeURIComponent(options.ownerType)}/${encodeURIComponent(options.ownerId)}/domains`, {
          method: "DELETE",
          headers: buildAccountHeaders(options.accountId),
        });
        return readArray(readRecord(response.body)?.data).map(mapDomain).filter((item): item is ClientDataDomainRecord => item !== null);
      },
      async export(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/export`, {
          method: "GET",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return requireExportResult(readRecord(response.body)?.data, "Client data export returned an invalid payload");
      },
    },
    collections: {
      async create(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/collections`, {
          method: "POST",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
          body: compactObject({
            collection_name: options.collectionName,
            description: options.description,
            default_expires_ttl_ms: options.defaultExpiresTtlMs,
            max_item_size_bytes: options.maxItemSizeBytes,
            metadata_json: options.metadataJson,
          }),
        });
        return requireCollection(readRecord(response.body)?.data, "Client data collection create returned an invalid payload");
      },
      async list(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/collections`, {
          method: "GET",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return readArray(readRecord(response.body)?.data).map(mapCollection).filter((item): item is ClientDataCollectionRecord => item !== null);
      },
      async getDetail(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/collections/${encodeURIComponent(options.collectionId)}`, {
          method: "GET",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return requireCollection(readRecord(response.body)?.data, "Client data collection detail returned an invalid payload");
      },
      async update(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/collections/${encodeURIComponent(options.collectionId)}`, {
          method: "PATCH",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
          body: compactObject({
            description: options.description,
            default_expires_ttl_ms: options.defaultExpiresTtlMs,
            max_item_size_bytes: options.maxItemSizeBytes,
            metadata_json: options.metadataJson,
            if_version: options.ifVersion,
          }),
        });
        return requireCollection(readRecord(response.body)?.data, "Client data collection update returned an invalid payload");
      },
      async remove(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/collections/${encodeURIComponent(options.collectionId)}`, {
          method: "DELETE",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
      },
    },
    items: {
      async list(options) {
        const query = buildQueryString({
          collection_id: options.collectionId,
          item_key_prefix: options.itemKeyPrefix,
          updated_after: options.updatedAfter,
          updated_before: options.updatedBefore,
          expires_after: options.expiresAfter,
          expires_before: options.expiresBefore,
          expired: options.expired,
          limit: options.limit ?? 100,
          offset: options.offset ?? 0,
          sort_by: options.sortBy ?? "updated_at",
          sort_order: options.sortOrder ?? "desc",
        });
        const pathname = query
          ? `/client-data/domains/${encodeURIComponent(options.domainId)}/items?${query}`
          : `/client-data/domains/${encodeURIComponent(options.domainId)}/items`;
        const response = await client.fetchJson<Record<string, unknown>>(pathname, {
          method: "GET",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return {
          data: readArray(readRecord(response.body)?.data).map(mapItem).filter((item): item is ClientDataItemRecord => item !== null),
          meta: mapListMeta(readRecord(response.body)?.meta),
        };
      },
      async getDetail(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/items/${encodeURIComponent(options.itemId)}`, {
          method: "GET",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return requireItem(readRecord(response.body)?.data, "Client data item detail returned an invalid payload");
      },
      async getByKey(options) {
        const query = buildQueryString({
          collection_name: options.collectionName,
          item_key: options.itemKey,
        });
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/items/by-key?${query}`, {
          method: "GET",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return requireItem(readRecord(response.body)?.data, "Client data item by-key lookup returned an invalid payload");
      },
      async upsert(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/items`, {
          method: "PUT",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
          body: compactObject({
            collection_name: options.collectionName,
            item_key: options.itemKey,
            value_json: options.valueJson,
            expires_at: options.expiresAt,
            if_version: options.ifVersion,
          }),
        });
        return requireItemMutation(readRecord(response.body)?.data, "Client data item upsert returned an invalid payload");
      },
      async upsertBatch(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/items/batch`, {
          method: "PUT",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
          body: {
            items: options.items.map((item) => compactObject({
              collection_name: item.collectionName,
              item_key: item.itemKey,
              value_json: item.valueJson,
              expires_at: item.expiresAt,
              if_version: item.ifVersion,
            })),
          },
        });
        const data = readRecord(readRecord(response.body)?.data);
        return {
          results: readArray(data?.results).map(mapItemMutation).filter((item): item is { action: string; collection: ClientDataCollectionRecord; item: ClientDataItemRecord } => item !== null),
        };
      },
      async remove(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/items/${encodeURIComponent(options.itemId)}`, {
          method: "DELETE",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
      },
      async removeBatch(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/items/delete-batch`, {
          method: "POST",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
          body: compactObject({
            item_ids: options.itemIds,
            collection_id: options.collectionId,
          }),
        });
        return readArray(readRecord(response.body)?.data).map((value) => {
          const record = readRecord(value);
          if (!record) {
            return null;
          }
          return {
            id: readString(record.id),
            collectionId: readString(record.collection_id),
            itemKey: readString(record.item_key),
          };
        }).filter((item): item is { id: string; collectionId: string; itemKey: string } => item !== null);
      },
    },
    grants: {
      async list(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/grants`, {
          method: "GET",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return readArray(readRecord(response.body)?.data).map(mapGrant).filter((item): item is ClientDataGrantRecord => item !== null);
      },
      async create(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/grants`, {
          method: "POST",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
          body: compactObject({
            grantee_owner_type: options.granteeOwnerType,
            grantee_owner_id: options.granteeOwnerId,
            can_read: options.canRead,
            can_write: options.canWrite,
            can_delete: options.canDelete,
            can_list: options.canList,
            expires_at: options.expiresAt,
          }),
        });
        return requireGrant(readRecord(response.body)?.data, "Client data grant create returned an invalid payload");
      },
      async update(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/grants/${encodeURIComponent(options.grantId)}`, {
          method: "PATCH",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
          body: compactObject({
            can_read: options.canRead,
            can_write: options.canWrite,
            can_delete: options.canDelete,
            can_list: options.canList,
            expires_at: options.expiresAt,
          }),
        });
        return requireGrant(readRecord(response.body)?.data, "Client data grant update returned an invalid payload");
      },
      async remove(options) {
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/grants/${encodeURIComponent(options.grantId)}`, {
          method: "DELETE",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
      },
    },
    auditLogs: {
      async list(options) {
        const query = buildQueryString({
          actor_type: options.actorType,
          action: options.action,
          limit: options.limit ?? 100,
          offset: options.offset ?? 0,
          sort_by: "created_at",
          sort_order: options.sortOrder ?? "desc",
        });
        const response = await client.fetchJson<Record<string, unknown>>(`/client-data/domains/${encodeURIComponent(options.domainId)}/audit-logs?${query}`, {
          method: "GET",
          headers: buildClientDataHeaders(options.accountId, options.callerOwner),
        });
        return {
          data: readArray(readRecord(response.body)?.data).map(mapAuditLog).filter((item): item is ClientDataAuditLogRecord => item !== null),
          meta: mapListMeta(readRecord(response.body)?.meta),
        };
      },
    },
  };
}

function mapListMeta(value: unknown) {
  const record = readRecord(value);
  return {
    total: readNumber(record?.total),
    limit: readNumber(record?.limit),
    offset: readNumber(record?.offset),
    hasMore: readBoolean(record?.has_more),
    sortBy: readString(record?.sort_by),
    sortOrder: readString(record?.sort_order, "desc") as "asc" | "desc",
  };
}

function mapDomain(value: unknown): ClientDataDomainRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  return {
    id: readString(record.id),
    ownerType: readString(record.owner_type) as ClientDataOwnerType,
    ownerId: readString(record.owner_id),
    domainName: readString(record.domain_name),
    displayName: readNullableString(record.display_name),
    description: readNullableString(record.description),
    status: readString(record.status) as ClientDataDomainStatus,
    version: readNumber(record.version),
    quotaMaxEntries: readNumber(record.quota_max_entries),
    quotaMaxBytes: readNumber(record.quota_max_bytes),
    currentEntryCount: readNumber(record.current_entry_count),
    currentByteCount: readNumber(record.current_byte_count),
    createdAt: readNumber(record.created_at),
    updatedAt: readNumber(record.updated_at),
    deletedAt: readNullableNumber(record.deleted_at),
  };
}

function mapDomainDetail(value: unknown): ClientDataDomainDetail | null {
  const domain = mapDomain(value);
  const record = readRecord(value);
  const quotaUsage = readRecord(record?.quota_usage);
  if (!domain) {
    return null;
  }
  return {
    ...domain,
    quotaUsage: {
      entryCount: readNumber(quotaUsage?.entry_count),
      byteCount: readNumber(quotaUsage?.byte_count),
    },
    restorableUntil: readNullableNumber(record?.restorable_until),
  };
}

function mapCollection(value: unknown): ClientDataCollectionRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  return {
    id: readString(record.id),
    domainId: readString(record.domain_id),
    collectionName: readString(record.collection_name),
    description: readNullableString(record.description),
    defaultExpiresTtlMs: readNullableNumber(record.default_expires_ttl_ms),
    maxItemSizeBytes: readNullableNumber(record.max_item_size_bytes),
    version: readNumber(record.version),
    metadataJson: record.metadata_json ?? null,
    itemCount: readNumber(record.item_count),
    byteCount: readNumber(record.byte_count),
    createdAt: readNumber(record.created_at),
    updatedAt: readNumber(record.updated_at),
  };
}

function mapItem(value: unknown): ClientDataItemRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  return {
    id: readString(record.id),
    domainId: readString(record.domain_id),
    collectionId: readString(record.collection_id),
    itemKey: readString(record.item_key),
    valueJson: record.value_json ?? null,
    byteSize: readNumber(record.byte_size),
    version: readNumber(record.version),
    expiresAt: readNullableNumber(record.expires_at),
    createdAt: readNumber(record.created_at),
    updatedAt: readNumber(record.updated_at),
  };
}

function mapGrant(value: unknown): ClientDataGrantRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  return {
    id: readString(record.id),
    domainId: readString(record.domain_id),
    granteeOwnerType: readString(record.grantee_owner_type) as ClientDataOwnerType,
    granteeOwnerId: readString(record.grantee_owner_id),
    canRead: readBoolean(record.can_read),
    canWrite: readBoolean(record.can_write),
    canDelete: readBoolean(record.can_delete),
    canList: readBoolean(record.can_list),
    createdAt: readNumber(record.created_at),
    updatedAt: readNumber(record.updated_at),
    expiresAt: readNullableNumber(record.expires_at),
  };
}

function mapAuditLog(value: unknown): ClientDataAuditLogRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  return {
    id: readString(record.id),
    accountId: readString(record.account_id),
    domainId: readNullableString(record.domain_id),
    ownerType: readNullableString(record.owner_type) as ClientDataOwnerType | null,
    ownerId: readNullableString(record.owner_id),
    actorType: readString(record.actor_type),
    actorId: readNullableString(record.actor_id),
    action: readString(record.action),
    targetType: readString(record.target_type),
    targetId: readNullableString(record.target_id),
    requestId: readNullableString(record.request_id),
    metadataJson: record.metadata_json ?? null,
    createdAt: readNumber(record.created_at),
  };
}

function mapItemMutation(value: unknown) {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  const collection = mapCollection(record.collection);
  const item = mapItem(record.item);
  if (!collection || !item) {
    return null;
  }
  return {
    action: readString(record.action),
    collection,
    item,
  };
}

function requireDomain(value: unknown, message: string): ClientDataDomainRecord {
  const payload = mapDomain(value);
  if (!payload) {
    throw new Error(message);
  }
  return payload;
}

function requireDomainDetail(value: unknown, message: string): ClientDataDomainDetail {
  const payload = mapDomainDetail(value);
  if (!payload) {
    throw new Error(message);
  }
  return payload;
}

function requireCollection(value: unknown, message: string): ClientDataCollectionRecord {
  const payload = mapCollection(value);
  if (!payload) {
    throw new Error(message);
  }
  return payload;
}

function requireItem(value: unknown, message: string): ClientDataItemRecord {
  const payload = mapItem(value);
  if (!payload) {
    throw new Error(message);
  }
  return payload;
}

function requireItemMutation(value: unknown, message: string): { action: string; collection: ClientDataCollectionRecord; item: ClientDataItemRecord } {
  const payload = mapItemMutation(value);
  if (!payload) {
    throw new Error(message);
  }
  return payload;
}

function requireGrant(value: unknown, message: string): ClientDataGrantRecord {
  const payload = mapGrant(value);
  if (!payload) {
    throw new Error(message);
  }
  return payload;
}

function requireExportResult(value: unknown, message: string): ClientDataExportResult {
  const record = readRecord(value);
  const domain = readRecord(record?.domain);
  if (!record || !domain) {
    throw new Error(message);
  }
  return {
    domain: {
      id: readString(domain.id),
      ownerType: readString(domain.owner_type) as ClientDataOwnerType,
      ownerId: readString(domain.owner_id),
      domainName: readString(domain.domain_name),
      displayName: readNullableString(domain.display_name),
      description: readNullableString(domain.description),
      createdAt: readNumber(domain.created_at),
    },
    collections: readArray(record.collections).map((value) => {
      const collection = readRecord(value);
      const items = readArray(collection?.items);
      return {
        collectionName: readString(collection?.collection_name),
        description: readNullableString(collection?.description),
        defaultExpiresTtlMs: readNullableNumber(collection?.default_expires_ttl_ms),
        maxItemSizeBytes: readNullableNumber(collection?.max_item_size_bytes),
        metadataJson: collection?.metadata_json ?? null,
        items: items.map((itemValue) => {
          const item = readRecord(itemValue);
          return {
            itemKey: readString(item?.item_key),
            valueJson: item?.value_json ?? null,
            version: readNumber(item?.version),
            expiresAt: readNullableNumber(item?.expires_at),
            createdAt: readNumber(item?.created_at),
            updatedAt: readNumber(item?.updated_at),
          };
        }),
      };
    }),
    exportedAt: readNumber(record.exported_at),
  };
}

function requireImportResult(value: unknown, message: string): ClientDataImportResult {
  const record = readRecord(value);
  const domain = mapDomain(record?.domain);
  const collections = readArray(record?.collections).map(mapCollection).filter((item): item is ClientDataCollectionRecord => item !== null);
  const summary = readRecord(record?.summary);
  if (!record || !domain || !summary) {
    throw new Error(message);
  }
  return {
    domain,
    collections,
    summary: {
      collectionsCreated: readNumber(summary.collections_created),
      itemsCreated: readNumber(summary.items_created),
      itemsUpdated: readNumber(summary.items_updated),
      itemsSkipped: readNumber(summary.items_skipped),
      importedItemCount: readNumber(summary.imported_item_count),
      importedByteCount: readNumber(summary.imported_byte_count),
      conflictPolicy: readString(summary.conflict_policy) as "fail" | "overwrite" | "skip",
    },
  };
}

function toImportPayloadBody(payload: ClientDataImportPayload) {
  return {
    domain: compactObject({
      owner_type: payload.domain.ownerType,
      owner_id: payload.domain.ownerId,
      domain_name: payload.domain.domainName,
      display_name: payload.domain.displayName,
      description: payload.domain.description,
    }),
    collections: payload.collections.map((collection) => ({
      collection_name: collection.collectionName,
      description: collection.description,
      default_expires_ttl_ms: collection.defaultExpiresTtlMs,
      max_item_size_bytes: collection.maxItemSizeBytes,
      metadata_json: collection.metadataJson,
      items: collection.items.map((item) => compactObject({
        item_key: item.itemKey,
        value_json: item.valueJson,
        version: item.version,
        expires_at: item.expiresAt,
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      })),
    })),
  };
}

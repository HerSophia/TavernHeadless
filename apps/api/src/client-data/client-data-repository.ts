import { and, asc, count, desc, eq, gte, inArray, isNull, isNotNull, like, lte, lt, not, or, sql, sum } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  clientDataAuditLogs,
  clientDataCollections,
  clientDataDomainGrants,
  clientDataDomains,
  clientDataItems,
} from "../db/schema.js";

export type ClientDataDb = AppDb | DbExecutor;

export interface ClientDataDomainRecord {
  id: string;
  accountId: string;
  ownerType: "application" | "plugin";
  ownerId: string;
  domainName: string;
  displayName: string | null;
  description: string | null;
  status: "active" | "suspended" | "deleted";
  version: number;
  quotaMaxEntries: number;
  quotaMaxBytes: number;
  currentEntryCount: number;
  currentByteCount: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface ClientDataCollectionRecord {
  id: string;
  domainId: string;
  collectionName: string;
  description: string | null;
  defaultExpiresTtlMs: number | null;
  maxItemSizeBytes: number | null;
  version: number;
  metadataJson: string | null;
  itemCount: number;
  byteCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ClientDataItemRecord {
  id: string;
  domainId: string;
  collectionId: string;
  itemKey: string;
  valueJson: string;
  byteSize: number;
  version: number;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ClientDataDomainGrantRecord {
  id: string;
  accountId: string;
  domainId: string;
  granteeOwnerType: "application" | "plugin";
  granteeOwnerId: string;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canList: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

export interface ClientDataAuditLogRecord {
  id: string;
  accountId: string;
  domainId: string | null;
  ownerType: "application" | "plugin" | null;
  ownerId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  requestId: string | null;
  metadataJson: string | null;
  createdAt: number;
}

export interface ClientDataDomainListOptions {
  accountId: string;
  ownerType?: "application" | "plugin";
  ownerId?: string;
  status?: "active" | "suspended" | "deleted";
  limit: number;
  offset: number;
  sortBy: "updated_at" | "created_at" | "domain_name";
  sortOrder: "asc" | "desc";
}

export interface ClientDataItemListOptions {
  domainId: string;
  collectionId?: string;
  itemKeyPrefix?: string;
  updatedAfter?: number;
  updatedBefore?: number;
  expiresAfter?: number;
  expiresBefore?: number;
  expired?: boolean;
  now?: number;
  limit: number;
  offset: number;
  sortBy: "updated_at" | "created_at" | "item_key";
  sortOrder: "asc" | "desc";
}

export interface ClientDataAuditLogListOptions {
  domainId: string;
  actorType?: string;
  action?: string;
  limit: number;
  offset: number;
  sortOrder: "asc" | "desc";
}

export class ClientDataRepository {
  constructor(private readonly db: ClientDataDb) {}

  createDomain(input: {
    accountId: string;
    ownerType: "application" | "plugin";
    ownerId: string;
    domainName: string;
    displayName?: string;
    description?: string;
    quotaMaxEntries: number;
    quotaMaxBytes: number;
    now: number;
  }): ClientDataDomainRecord {
    const row = this.db.insert(clientDataDomains).values({
      id: nanoid(),
      accountId: input.accountId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      domainName: input.domainName,
      displayName: input.displayName ?? null,
      description: input.description ?? null,
      version: 1,
      quotaMaxEntries: input.quotaMaxEntries,
      quotaMaxBytes: input.quotaMaxBytes,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    }).returning().get();

    return toDomainRecord(row);
  }

  listDomains(options: ClientDataDomainListOptions): { rows: ClientDataDomainRecord[]; total: number } {
    const filters = [eq(clientDataDomains.accountId, options.accountId)];

    if (options.ownerType) {
      filters.push(eq(clientDataDomains.ownerType, options.ownerType));
    }
    if (options.ownerId) {
      filters.push(eq(clientDataDomains.ownerId, options.ownerId));
    }
    if (options.status) {
      filters.push(eq(clientDataDomains.status, options.status));
    }

    const whereClause = filters.length === 1 ? filters[0] : and(...filters);
    const orderBy = resolveDomainOrderBy(options.sortBy, options.sortOrder);

    const rows = this.db.select().from(clientDataDomains).where(whereClause).orderBy(orderBy).limit(options.limit).offset(options.offset).all();
    const totalRow = this.db.select({ value: count() }).from(clientDataDomains).where(whereClause).get();

    return {
      rows: rows.map(toDomainRecord),
      total: totalRow?.value ?? 0,
    };
  }

  getDomainById(domainId: string): ClientDataDomainRecord | null {
    const row = this.db.select().from(clientDataDomains).where(eq(clientDataDomains.id, domainId)).limit(1).get();
    return row ? toDomainRecord(row) : null;
  }

  getDomainByOwnerName(input: {
    accountId: string;
    ownerType: "application" | "plugin";
    ownerId: string;
    domainName: string;
  }): ClientDataDomainRecord | null {
    const row = this.db.select().from(clientDataDomains).where(and(
      eq(clientDataDomains.accountId, input.accountId),
      eq(clientDataDomains.ownerType, input.ownerType),
      eq(clientDataDomains.ownerId, input.ownerId),
      eq(clientDataDomains.domainName, input.domainName),
      isNull(clientDataDomains.deletedAt),
    )).limit(1).get();

    return row ? toDomainRecord(row) : null;
  }

  updateDomain(input: {
    domainId: string;
    displayName?: string | null;
    description?: string | null;
    ifVersion?: number;
    now: number;
  }): ClientDataDomainRecord | null {
    const values: Record<string, unknown> = {
      updatedAt: input.now,
      version: sql`${clientDataDomains.version} + 1`,
    };

    if (input.displayName !== undefined) {
      values.displayName = input.displayName;
    }
    if (input.description !== undefined) {
      values.description = input.description;
    }

    const filters = [eq(clientDataDomains.id, input.domainId)];
    if (input.ifVersion !== undefined) {
      filters.push(eq(clientDataDomains.version, input.ifVersion));
    }

    const row = this.db.update(clientDataDomains).set(values).where(
      filters.length === 1 ? filters[0]! : and(...filters)
    ).returning().get();
    return row ? toDomainRecord(row) : null;
  }

  updateDomainQuota(input: {
    domainId: string;
    quotaMaxEntries: number;
    quotaMaxBytes: number;
    now: number;
  }): ClientDataDomainRecord | null {
    const row = this.db.update(clientDataDomains).set({
      quotaMaxEntries: input.quotaMaxEntries,
      quotaMaxBytes: input.quotaMaxBytes,
      updatedAt: input.now,
      version: sql`${clientDataDomains.version} + 1`,
    }).where(eq(clientDataDomains.id, input.domainId)).returning().get();
    return row ? toDomainRecord(row) : null;
  }

  softDeleteDomain(domainId: string, now: number): ClientDataDomainRecord | null {
    const row = this.db.update(clientDataDomains).set({
      status: "deleted",
      deletedAt: now,
      updatedAt: now,
      version: sql`${clientDataDomains.version} + 1`,
    }).where(eq(clientDataDomains.id, domainId)).returning().get();
    return row ? toDomainRecord(row) : null;
  }

  softDeleteDomainsByOwner(input: {
    accountId: string;
    ownerType: "application" | "plugin";
    ownerId: string;
    now: number;
  }): ClientDataDomainRecord[] {
    const rows = this.db.update(clientDataDomains).set({
      status: "deleted",
      deletedAt: input.now,
      updatedAt: input.now,
      version: sql`${clientDataDomains.version} + 1`,
    }).where(and(
      eq(clientDataDomains.accountId, input.accountId),
      eq(clientDataDomains.ownerType, input.ownerType),
      eq(clientDataDomains.ownerId, input.ownerId),
      isNull(clientDataDomains.deletedAt),
    )).returning().all();

    return rows.map(toDomainRecord);
  }

  restoreDomain(input: {
    domainId: string;
    now: number;
  }): ClientDataDomainRecord | null {
    const row = this.db.update(clientDataDomains).set({
      status: "active",
      deletedAt: null,
      updatedAt: input.now,
      version: sql`${clientDataDomains.version} + 1`,
    }).where(and(
      eq(clientDataDomains.id, input.domainId),
      eq(clientDataDomains.status, "deleted"),
      isNotNull(clientDataDomains.deletedAt),
    )).returning().get();
    return row ? toDomainRecord(row) : null;
  }

  hasActiveDomainWithOwnerName(input: {
    accountId: string;
    ownerType: "application" | "plugin";
    ownerId: string;
    domainName: string;
    excludeDomainId?: string;
  }): boolean {
    const rows = this.db.select({ id: clientDataDomains.id }).from(clientDataDomains).where(and(
      eq(clientDataDomains.accountId, input.accountId),
      eq(clientDataDomains.ownerType, input.ownerType),
      eq(clientDataDomains.ownerId, input.ownerId),
      eq(clientDataDomains.domainName, input.domainName),
      isNull(clientDataDomains.deletedAt),
    )).all();
    return rows.some((row) => row.id !== input.excludeDomainId);
  }

  countActiveDomainsByAccount(accountId: string): number {
    const row = this.db.select({ value: count() }).from(clientDataDomains).where(and(
      eq(clientDataDomains.accountId, accountId),
      isNull(clientDataDomains.deletedAt),
    )).get();

    return row?.value ?? 0;
  }

  getAccountUsageTotals(accountId: string): { totalEntries: number; totalBytes: number } {
    const row = this.db.select({
      totalEntries: sum(clientDataDomains.currentEntryCount),
      totalBytes: sum(clientDataDomains.currentByteCount),
    }).from(clientDataDomains).where(and(
      eq(clientDataDomains.accountId, accountId),
      isNull(clientDataDomains.deletedAt),
    )).get();

    return {
      totalEntries: Number(row?.totalEntries ?? 0),
      totalBytes: Number(row?.totalBytes ?? 0),
    };
  }

  createCollection(input: {
    domainId: string;
    collectionName: string;
    description?: string;
    defaultExpiresTtlMs?: number | null;
    maxItemSizeBytes?: number | null;
    metadataJson?: string | null;
    now: number;
  }): ClientDataCollectionRecord {
    const row = this.db.insert(clientDataCollections).values({
      id: nanoid(),
      domainId: input.domainId,
      collectionName: input.collectionName,
      description: input.description ?? null,
      defaultExpiresTtlMs: input.defaultExpiresTtlMs ?? null,
      maxItemSizeBytes: input.maxItemSizeBytes ?? null,
      version: 1,
      metadataJson: input.metadataJson ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    }).returning().get();

    return toCollectionRecord(row);
  }

  getCollectionById(collectionId: string): ClientDataCollectionRecord | null {
    const row = this.db.select().from(clientDataCollections).where(eq(clientDataCollections.id, collectionId)).limit(1).get();
    return row ? toCollectionRecord(row) : null;
  }

  getCollectionByDomainName(domainId: string, collectionName: string): ClientDataCollectionRecord | null {
    const row = this.db.select().from(clientDataCollections).where(and(
      eq(clientDataCollections.domainId, domainId),
      eq(clientDataCollections.collectionName, collectionName),
    )).limit(1).get();
    return row ? toCollectionRecord(row) : null;
  }

  listCollections(domainId: string): ClientDataCollectionRecord[] {
    return this.db.select().from(clientDataCollections).where(eq(clientDataCollections.domainId, domainId)).orderBy(desc(clientDataCollections.updatedAt)).all().map(toCollectionRecord);
  }

  updateCollection(input: {
    collectionId: string;
    description?: string | null;
    defaultExpiresTtlMs?: number | null;
    maxItemSizeBytes?: number | null;
    metadataJson?: string | null;
    ifVersion?: number;
    now: number;
  }): ClientDataCollectionRecord | null {
    const values: Record<string, unknown> = {
      updatedAt: input.now,
      version: sql`${clientDataCollections.version} + 1`,
    };
    if (input.description !== undefined) values.description = input.description;
    if (input.defaultExpiresTtlMs !== undefined) values.defaultExpiresTtlMs = input.defaultExpiresTtlMs;
    if (input.maxItemSizeBytes !== undefined) values.maxItemSizeBytes = input.maxItemSizeBytes;
    if (input.metadataJson !== undefined) values.metadataJson = input.metadataJson;

    const filters = [eq(clientDataCollections.id, input.collectionId)];
    if (input.ifVersion !== undefined) {
      filters.push(eq(clientDataCollections.version, input.ifVersion));
    }

    const row = this.db.update(clientDataCollections).set(values).where(filters.length === 1 ? filters[0]! : and(...filters)).returning().get();
    return row ? toCollectionRecord(row) : null;
  }

  deleteCollection(collectionId: string): ClientDataCollectionRecord | null {
    const row = this.db.delete(clientDataCollections).where(eq(clientDataCollections.id, collectionId)).returning().get();
    return row ? toCollectionRecord(row) : null;
  }

  listItems(options: ClientDataItemListOptions): { rows: ClientDataItemRecord[]; total: number } {
    const filters = [eq(clientDataItems.domainId, options.domainId)];
    if (options.collectionId) {
      filters.push(eq(clientDataItems.collectionId, options.collectionId));
    }
    if (options.itemKeyPrefix) {
      filters.push(like(clientDataItems.itemKey, `${escapeLikePattern(options.itemKeyPrefix)}%`));
    }
    if (options.updatedAfter !== undefined) {
      filters.push(gte(clientDataItems.updatedAt, options.updatedAfter));
    }
    if (options.updatedBefore !== undefined) {
      filters.push(lte(clientDataItems.updatedAt, options.updatedBefore));
    }
    if (options.expiresAfter !== undefined) {
      filters.push(and(isNotNull(clientDataItems.expiresAt), gte(clientDataItems.expiresAt, options.expiresAfter))!);
    }
    if (options.expiresBefore !== undefined) {
      filters.push(and(isNotNull(clientDataItems.expiresAt), lte(clientDataItems.expiresAt, options.expiresBefore))!);
    }
    if (options.expired === true) {
      filters.push(and(isNotNull(clientDataItems.expiresAt), lt(clientDataItems.expiresAt, options.now ?? Date.now()))!);
    }
    if (options.expired === false) {
      filters.push(not(and(isNotNull(clientDataItems.expiresAt), lt(clientDataItems.expiresAt, options.now ?? Date.now()))!));
    }
    const whereClause = filters.length === 1 ? filters[0] : and(...filters);
    const orderBy = resolveItemOrderBy(options.sortBy, options.sortOrder);

    const rows = this.db.select().from(clientDataItems).where(whereClause).orderBy(orderBy).limit(options.limit).offset(options.offset).all();
    const totalRow = this.db.select({ value: count() }).from(clientDataItems).where(whereClause).get();

    return {
      rows: rows.map(toItemRecord),
      total: totalRow?.value ?? 0,
    };
  }

  getItemById(itemId: string): ClientDataItemRecord | null {
    const row = this.db.select().from(clientDataItems).where(eq(clientDataItems.id, itemId)).limit(1).get();
    return row ? toItemRecord(row) : null;
  }

  getItemByCollectionKey(collectionId: string, itemKey: string): ClientDataItemRecord | null {
    const row = this.db.select().from(clientDataItems).where(and(
      eq(clientDataItems.collectionId, collectionId),
      eq(clientDataItems.itemKey, itemKey),
    )).limit(1).get();
    return row ? toItemRecord(row) : null;
  }

  createItem(input: {
    domainId: string;
    collectionId: string;
    itemKey: string;
    valueJson: string;
    byteSize: number;
    expiresAt: number | null;
    now: number;
  }): ClientDataItemRecord {
    const row = this.db.insert(clientDataItems).values({
      id: nanoid(),
      domainId: input.domainId,
      collectionId: input.collectionId,
      itemKey: input.itemKey,
      valueJson: input.valueJson,
      byteSize: input.byteSize,
      expiresAt: input.expiresAt,
      createdAt: input.now,
      updatedAt: input.now,
      version: 1,
    }).returning().get();

    return toItemRecord(row);
  }

  updateItem(input: {
    itemId: string;
    valueJson: string;
    byteSize: number;
    expiresAt: number | null;
    now: number;
  }): ClientDataItemRecord | null {
    const row = this.db.update(clientDataItems).set({
      valueJson: input.valueJson,
      byteSize: input.byteSize,
      expiresAt: input.expiresAt,
      updatedAt: input.now,
      version: sql`${clientDataItems.version} + 1`,
    }).where(eq(clientDataItems.id, input.itemId)).returning().get();

    return row ? toItemRecord(row) : null;
  }

  deleteItem(itemId: string): ClientDataItemRecord | null {
    const row = this.db.delete(clientDataItems).where(eq(clientDataItems.id, itemId)).returning().get();
    return row ? toItemRecord(row) : null;
  }

  deleteItemsByIds(domainId: string, itemIds: string[]): ClientDataItemRecord[] {
    if (itemIds.length === 0) {
      return [];
    }
    return this.db.delete(clientDataItems).where(and(
      eq(clientDataItems.domainId, domainId),
      inArray(clientDataItems.id, itemIds),
    )).returning().all().map(toItemRecord);
  }

  deleteItemsByCollectionId(collectionId: string): ClientDataItemRecord[] {
    return this.db.delete(clientDataItems).where(eq(clientDataItems.collectionId, collectionId)).returning().all().map(toItemRecord);
  }

  updateDomainCounters(domainId: string, deltaEntries: number, deltaBytes: number, now: number): void {
    this.db.update(clientDataDomains).set({
      currentEntryCount: sql`${clientDataDomains.currentEntryCount} + ${deltaEntries}`,
      currentByteCount: sql`${clientDataDomains.currentByteCount} + ${deltaBytes}`,
      updatedAt: now,
    }).where(eq(clientDataDomains.id, domainId)).run();
  }

  updateCollectionCounters(collectionId: string, deltaEntries: number, deltaBytes: number, now: number): void {
    this.db.update(clientDataCollections).set({
      itemCount: sql`${clientDataCollections.itemCount} + ${deltaEntries}`,
      byteCount: sql`${clientDataCollections.byteCount} + ${deltaBytes}`,
      updatedAt: now,
    }).where(eq(clientDataCollections.id, collectionId)).run();
  }

  listItemsForExport(domainId: string): Array<{ collection: ClientDataCollectionRecord; items: ClientDataItemRecord[] }> {
    const collections = this.listCollections(domainId);
    return collections.map((collection) => ({
      collection,
      items: this.db.select().from(clientDataItems).where(eq(clientDataItems.collectionId, collection.id)).orderBy(asc(clientDataItems.createdAt)).all().map(toItemRecord),
    }));
  }

  listExpiredItems(now: number, batchSize: number): ClientDataItemRecord[] {
    return this.db.select().from(clientDataItems).where(and(
      isNotNull(clientDataItems.expiresAt),
      lt(clientDataItems.expiresAt, now),
    )).limit(batchSize).all().map(toItemRecord);
  }

  listPurgeableDomains(cutoff: number): ClientDataDomainRecord[] {
    return this.db.select().from(clientDataDomains).where(and(
      eq(clientDataDomains.status, "deleted"),
      isNotNull(clientDataDomains.deletedAt),
      lt(clientDataDomains.deletedAt, cutoff),
    )).all().map(toDomainRecord);
  }

  hardDeleteDomain(domainId: string): ClientDataDomainRecord | null {
    const row = this.db.delete(clientDataDomains).where(eq(clientDataDomains.id, domainId)).returning().get();
    return row ? toDomainRecord(row) : null;
  }

  createDomainGrant(input: {
    accountId: string;
    domainId: string;
    granteeOwnerType: "application" | "plugin";
    granteeOwnerId: string;
    canRead: boolean;
    canWrite: boolean;
    canDelete: boolean;
    canList: boolean;
    expiresAt?: number | null;
    now: number;
  }): ClientDataDomainGrantRecord {
    const row = this.db.insert(clientDataDomainGrants).values({
      id: nanoid(),
      accountId: input.accountId,
      domainId: input.domainId,
      granteeOwnerType: input.granteeOwnerType,
      granteeOwnerId: input.granteeOwnerId,
      canRead: input.canRead,
      canWrite: input.canWrite,
      canDelete: input.canDelete,
      canList: input.canList,
      expiresAt: input.expiresAt ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    }).returning().get();
    return toDomainGrantRecord(row);
  }

  listDomainGrants(domainId: string): ClientDataDomainGrantRecord[] {
    return this.db.select().from(clientDataDomainGrants)
      .where(eq(clientDataDomainGrants.domainId, domainId))
      .orderBy(desc(clientDataDomainGrants.updatedAt))
      .all()
      .map(toDomainGrantRecord);
  }

  getDomainGrantById(grantId: string): ClientDataDomainGrantRecord | null {
    const row = this.db.select().from(clientDataDomainGrants).where(eq(clientDataDomainGrants.id, grantId)).limit(1).get();
    return row ? toDomainGrantRecord(row) : null;
  }

  updateDomainGrant(input: {
    grantId: string;
    canRead?: boolean;
    canWrite?: boolean;
    canDelete?: boolean;
    canList?: boolean;
    expiresAt?: number | null;
    now: number;
  }): ClientDataDomainGrantRecord | null {
    const values: Record<string, unknown> = { updatedAt: input.now };
    if (input.canRead !== undefined) values.canRead = input.canRead;
    if (input.canWrite !== undefined) values.canWrite = input.canWrite;
    if (input.canDelete !== undefined) values.canDelete = input.canDelete;
    if (input.canList !== undefined) values.canList = input.canList;
    if (input.expiresAt !== undefined) values.expiresAt = input.expiresAt;

    const row = this.db.update(clientDataDomainGrants)
      .set(values)
      .where(eq(clientDataDomainGrants.id, input.grantId))
      .returning()
      .get();
    return row ? toDomainGrantRecord(row) : null;
  }

  deleteDomainGrant(grantId: string): ClientDataDomainGrantRecord | null {
    const row = this.db.delete(clientDataDomainGrants).where(eq(clientDataDomainGrants.id, grantId)).returning().get();
    return row ? toDomainGrantRecord(row) : null;
  }

  findGrantForOwner(input: {
    domainId: string;
    granteeOwnerType: "application" | "plugin";
    granteeOwnerId: string;
    now: number;
  }): ClientDataDomainGrantRecord | null {
    const row = this.db.select().from(clientDataDomainGrants).where(and(
      eq(clientDataDomainGrants.domainId, input.domainId),
      eq(clientDataDomainGrants.granteeOwnerType, input.granteeOwnerType),
      eq(clientDataDomainGrants.granteeOwnerId, input.granteeOwnerId),
      or(isNull(clientDataDomainGrants.expiresAt), gte(clientDataDomainGrants.expiresAt, input.now)),
    )).limit(1).get();
    return row ? toDomainGrantRecord(row) : null;
  }

  appendAuditLog(input: {
    accountId: string;
    domainId?: string | null;
    ownerType?: "application" | "plugin" | null;
    ownerId?: string | null;
    actorType: string;
    actorId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    requestId?: string | null;
    metadataJson?: string | null;
    createdAt: number;
  }): ClientDataAuditLogRecord {
    const row = this.db.insert(clientDataAuditLogs).values({
      id: nanoid(),
      accountId: input.accountId,
      domainId: input.domainId ?? null,
      ownerType: input.ownerType ?? null,
      ownerId: input.ownerId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      requestId: input.requestId ?? null,
      metadataJson: input.metadataJson ?? null,
      createdAt: input.createdAt,
    }).returning().get();
    return toAuditLogRecord(row);
  }

  listAuditLogs(options: ClientDataAuditLogListOptions): { rows: ClientDataAuditLogRecord[]; total: number } {
    const filters = [eq(clientDataAuditLogs.domainId, options.domainId)];
    if (options.actorType) {
      filters.push(eq(clientDataAuditLogs.actorType, options.actorType));
    }
    if (options.action) {
      filters.push(eq(clientDataAuditLogs.action, options.action));
    }
    const whereClause = filters.length === 1 ? filters[0] : and(...filters);
    const orderBy = options.sortOrder === "asc" ? asc(clientDataAuditLogs.createdAt) : desc(clientDataAuditLogs.createdAt);

    const rows = this.db.select().from(clientDataAuditLogs).where(whereClause).orderBy(orderBy).limit(options.limit).offset(options.offset).all();
    const totalRow = this.db.select({ value: count() }).from(clientDataAuditLogs).where(whereClause).get();

    return {
      rows: rows.map(toAuditLogRecord),
      total: totalRow?.value ?? 0,
    };
  }
}

function toDomainRecord(row: typeof clientDataDomains.$inferSelect): ClientDataDomainRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    domainName: row.domainName,
    displayName: row.displayName ?? null,
    description: row.description ?? null,
    status: row.status,
    version: row.version,
    quotaMaxEntries: row.quotaMaxEntries,
    quotaMaxBytes: row.quotaMaxBytes,
    currentEntryCount: row.currentEntryCount,
    currentByteCount: row.currentByteCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  };
}

function toCollectionRecord(row: typeof clientDataCollections.$inferSelect): ClientDataCollectionRecord {
  return {
    id: row.id,
    domainId: row.domainId,
    collectionName: row.collectionName,
    description: row.description ?? null,
    defaultExpiresTtlMs: row.defaultExpiresTtlMs ?? null,
    maxItemSizeBytes: row.maxItemSizeBytes ?? null,
    version: row.version,
    metadataJson: row.metadataJson ?? null,
    itemCount: row.itemCount,
    byteCount: row.byteCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toItemRecord(row: typeof clientDataItems.$inferSelect): ClientDataItemRecord {
  return {
    id: row.id,
    domainId: row.domainId,
    collectionId: row.collectionId,
    itemKey: row.itemKey,
    valueJson: row.valueJson,
    byteSize: row.byteSize,
    version: row.version,
    expiresAt: row.expiresAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDomainGrantRecord(row: typeof clientDataDomainGrants.$inferSelect): ClientDataDomainGrantRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    domainId: row.domainId,
    granteeOwnerType: row.granteeOwnerType,
    granteeOwnerId: row.granteeOwnerId,
    canRead: row.canRead,
    canWrite: row.canWrite,
    canDelete: row.canDelete,
    canList: row.canList,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt ?? null,
  };
}

function toAuditLogRecord(row: typeof clientDataAuditLogs.$inferSelect): ClientDataAuditLogRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    domainId: row.domainId ?? null,
    ownerType: row.ownerType ?? null,
    ownerId: row.ownerId ?? null,
    actorType: row.actorType,
    actorId: row.actorId ?? null,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId ?? null,
    requestId: row.requestId ?? null,
    metadataJson: row.metadataJson ?? null,
    createdAt: row.createdAt,
  };
}

function resolveDomainOrderBy(sortBy: ClientDataDomainListOptions["sortBy"], sortOrder: ClientDataDomainListOptions["sortOrder"]) {
  const column = sortBy === "created_at"
    ? clientDataDomains.createdAt
    : sortBy === "domain_name"
      ? clientDataDomains.domainName
      : clientDataDomains.updatedAt;

  return sortOrder === "asc" ? asc(column) : desc(column);
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function resolveItemOrderBy(sortBy: ClientDataItemListOptions["sortBy"], sortOrder: ClientDataItemListOptions["sortOrder"]) {
  const column = sortBy === "created_at"
    ? clientDataItems.createdAt
    : sortBy === "item_key"
      ? clientDataItems.itemKey
      : clientDataItems.updatedAt;

  return sortOrder === "asc" ? asc(column) : desc(column);
}

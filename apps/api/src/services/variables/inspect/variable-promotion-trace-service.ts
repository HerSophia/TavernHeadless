import { and, asc, eq } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../../../db/client.js";
import { variablePromotionTraces } from "../../../db/schema.js";
import { OwnedPageRepository } from "../../owned-resource-repositories.js";
import { VariableServiceError } from "../../variable-service-errors.js";
import type { PageVariablePromotionTraceSnapshot, VariablePromotionTraceRecord } from "../contracts.js";

function toVariablePromotionTraceRecord(
  row: typeof variablePromotionTraces.$inferSelect,
): VariablePromotionTraceRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    sessionId: row.sessionId,
    branchId: row.branchId,
    floorId: row.floorId,
    pageId: row.pageId,
    stagedWriteId: row.stagedWriteId,
    key: row.key,
    fromScope: row.fromScope,
    fromScopeId: row.fromScopeId,
    toScope: row.toScope,
    toScopeId: row.toScopeId,
    conflictPolicy: row.conflictPolicy,
    sourceVariableId: row.sourceVariableId,
    targetVariableId: row.targetVariableId,
    value: JSON.parse(row.valueJson),
    createdAt: row.createdAt,
  };
}

export class VariablePromotionTraceService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  getPageSnapshot(accountId: string, pageId: string): PageVariablePromotionTraceSnapshot {
    const page = new OwnedPageRepository(this.db).getContextById(accountId, pageId);
    if (!page) {
      throw new VariableServiceError("variable_host_not_found", `Page '${pageId}' not found`);
    }

    const items = this.db
      .select()
      .from(variablePromotionTraces)
      .where(and(
        eq(variablePromotionTraces.accountId, accountId),
        eq(variablePromotionTraces.pageId, pageId),
      ))
      .orderBy(asc(variablePromotionTraces.createdAt), asc(variablePromotionTraces.id))
      .all()
      .map(toVariablePromotionTraceRecord);

    return {
      pageId: page.id,
      floorId: page.floorId,
      sessionId: page.sessionId,
      branchId: page.branchId,
      items,
    };
  }
}

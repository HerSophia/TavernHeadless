import type { FastifyRequest } from "fastify";

import type { DbExecutor } from "../db/client.js";
import {
  OperationLogService,
  operationActorFromRequest,
  operationRequestIdFromRequest,
  type OperationLogActor,
} from "./operation-log-service.js";
import { VcDiffService } from "./vc-diff-service.js";

export type PromptAssetOperationKind = "preset" | "worldbook" | "regex_profile";

export type PromptAssetOperationRow = {
  id: string;
  name: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  version: number;
};

export type PromptAssetVersionOperationRow = {
  id: string;
  versionNo: number;
  contentHash: string;
  parentVersionId: string | null;
  createdByOperationId: string | null;
  createdAt: number;
};

export type AppendPromptAssetOperationLogInput = {
  operationId?: string;
  accountId: string;
  action: string;
  assetKind: PromptAssetOperationKind;
  assetId: string;
  beforeRef?: unknown;
  afterRef?: unknown;
  metadata?: unknown;
  createdAt?: number;
};

export type AppendPromptAssetOperationLogForActorInput = OperationLogActor & {
  operationId?: string;
  accountId: string;
  requestId?: string | null;
  sourceType: string;
  action: string;
  assetKind: PromptAssetOperationKind;
  assetId: string;
  sessionId?: string | null;
  branchId?: string | null;
  floorId?: string | null;
  runId?: string | null;
  beforeRef?: unknown;
  afterRef?: unknown;
  metadata?: unknown;
  createdAt?: number;
};

export function toPromptAssetOperationRef(
  kind: PromptAssetOperationKind,
  row: PromptAssetOperationRow,
  version?: PromptAssetVersionOperationRow | null,
): Record<string, unknown> {
  return {
    asset_kind: kind,
    asset_id: row.id,
    name: row.name,
    source: row.source,
    version: row.version,
    version_id: version?.id ?? null,
    version_no: version?.versionNo ?? row.version,
    content_hash: version?.contentHash ?? null,
    parent_version_id: version?.parentVersionId ?? null,
    created_by_operation_id: version?.createdByOperationId ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function appendPromptAssetOperationLog(
  tx: DbExecutor,
  request: FastifyRequest,
  input: AppendPromptAssetOperationLogInput,
): void {
  appendPromptAssetOperationLogForActor(tx, {
    operationId: input.operationId,
    ...operationActorFromRequest(request),
    accountId: input.accountId,
    requestId: operationRequestIdFromRequest(request),
    sourceType: "http",
    action: input.action,
    assetKind: input.assetKind,
    assetId: input.assetId,
    beforeRef: input.beforeRef,
    afterRef: input.afterRef,
    metadata: input.metadata,
    createdAt: input.createdAt,
  });
}

export function appendPromptAssetOperationLogForActor(
  tx: DbExecutor,
  input: AppendPromptAssetOperationLogForActorInput,
): void {
  const beforeRef = input.beforeRef ?? null;
  const afterRef = input.afterRef ?? null;

  new OperationLogService(tx).append({
    id: input.operationId,
    accountId: input.accountId,
    actorType: input.actorType,
    actorId: input.actorId,
    requestId: input.requestId,
    sourceType: input.sourceType,
    action: input.action,
    status: "succeeded",
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    runId: input.runId,
    targetType: input.assetKind,
    targetId: input.assetId,
    beforeRef,
    afterRef,
    diff: new VcDiffService().diff(beforeRef, afterRef),
    metadata: input.metadata,
    createdAt: input.createdAt,
  });
}

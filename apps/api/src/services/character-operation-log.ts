import type { FastifyRequest } from "fastify";

import type { DbExecutor } from "../db/client.js";
import {
  OperationLogService,
  operationActorFromRequest,
  operationRequestIdFromRequest,
  type OperationLogActor,
} from "./operation-log-service.js";
import { VcDiffService } from "./vc-diff-service.js";

export type CharacterVersionOperationRow = {
  id: string;
  versionNo: number;
  contentHash: string;
  createdByOperationId?: string | null;
};

export type AppendCharacterOperationLogInput = {
  operationId?: string;
  accountId: string;
  action: string;
  characterId: string;
  sessionId?: string | null;
  branchId?: string | null;
  floorId?: string | null;
  runId?: string | null;
  beforeRef?: unknown;
  afterRef?: unknown;
  metadata?: unknown;
  createdAt?: number;
};

export type AppendCharacterOperationLogForActorInput = OperationLogActor & AppendCharacterOperationLogInput & {
  requestId?: string | null;
  sourceType: string;
};

export function toCharacterOperationRef(
  characterId: string,
  version?: CharacterVersionOperationRow | null,
  options: { rolledBackFromVersionId?: string | null } = {},
): Record<string, unknown> {
  return {
    character_id: characterId,
    character_version_id: version?.id ?? null,
    version_no: version?.versionNo ?? null,
    content_hash: version?.contentHash ?? null,
    created_by_operation_id: version?.createdByOperationId ?? null,
    ...(options.rolledBackFromVersionId !== undefined
      ? { rolled_back_from_version_id: options.rolledBackFromVersionId }
      : {}),
  };
}

export function appendCharacterOperationLog(
  tx: DbExecutor,
  request: FastifyRequest,
  input: AppendCharacterOperationLogInput,
): void {
  appendCharacterOperationLogForActor(tx, {
    operationId: input.operationId,
    ...operationActorFromRequest(request),
    accountId: input.accountId,
    requestId: operationRequestIdFromRequest(request),
    sourceType: "http",
    action: input.action,
    characterId: input.characterId,
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    runId: input.runId,
    beforeRef: input.beforeRef,
    afterRef: input.afterRef,
    metadata: input.metadata,
    createdAt: input.createdAt,
  });
}

export function appendCharacterOperationLogForActor(
  tx: DbExecutor,
  input: AppendCharacterOperationLogForActorInput,
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
    targetType: "character",
    targetId: input.characterId,
    beforeRef,
    afterRef,
    diff: new VcDiffService().diff(beforeRef, afterRef),
    metadata: input.metadata,
    createdAt: input.createdAt,
  });
}

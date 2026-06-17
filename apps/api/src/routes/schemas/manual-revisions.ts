import { z } from "zod";

import type {
  CommittedContentManualRevisionRecord,
  CommittedContentManualRevisionTimeline,
} from "../../services/committed-content-manual-revision-service.js";

export const manualRevisionBodySchema = z.object({
  content: z.string().min(1),
  expected_latest_revision_no: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).optional(),
}).strict();

export const manualRevisionBodyJsonSchema = {
  type: "object",
  required: ["content", "expected_latest_revision_no"],
  properties: {
    content: { type: "string", minLength: 1 },
    expected_latest_revision_no: { type: "integer", minimum: 0 },
    reason: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const manualRevisionRecordJsonSchema = {
  type: "object",
  required: [
    "id",
    "session_id",
    "branch_id",
    "floor_id",
    "page_id",
    "message_id",
    "requested_target_kind",
    "requested_target_id",
    "revision_no",
    "original_content",
    "previous_content",
    "edited_content",
    "reason",
    "actor_type",
    "actor_id",
    "actor_account_id",
    "actor_client_id",
    "operation_log_id",
    "created_at",
  ],
  properties: {
    id: { type: "string" },
    session_id: { type: "string" },
    branch_id: { type: "string" },
    floor_id: { type: "string" },
    page_id: { type: "string" },
    message_id: { type: "string" },
    requested_target_kind: { type: "string", enum: ["message", "page"] },
    requested_target_id: { type: "string" },
    revision_no: { type: "integer", minimum: 1 },
    original_content: { type: "string" },
    previous_content: { type: "string" },
    edited_content: { type: "string" },
    reason: { anyOf: [{ type: "string" }, { type: "null" }] },
    actor_type: { type: "string", enum: ["account", "client"] },
    actor_id: { type: "string" },
    actor_account_id: { type: "string" },
    actor_client_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    operation_log_id: { type: "string" },
    created_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const manualRevisionTimelineJsonSchema = {
  type: "object",
  required: [
    "target_kind",
    "target_id",
    "session_id",
    "branch_id",
    "floor_id",
    "page_id",
    "message_id",
    "current_content",
    "current_token_count",
    "latest_revision_no",
    "items",
  ],
  properties: {
    target_kind: { type: "string", enum: ["message", "page"] },
    target_id: { type: "string" },
    session_id: { type: "string" },
    branch_id: { type: "string" },
    floor_id: { type: "string" },
    page_id: { type: "string" },
    message_id: { type: "string" },
    current_content: { type: "string" },
    current_token_count: { type: "integer", minimum: 0 },
    latest_revision_no: { type: "integer", minimum: 0 },
    items: { type: "array", items: manualRevisionRecordJsonSchema },
  },
  additionalProperties: false,
} as const;

export const manualRevisionResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: manualRevisionTimelineJsonSchema,
  },
  additionalProperties: false,
} as const;

export function toManualRevisionRecordResponse(row: CommittedContentManualRevisionRecord) {
  return {
    id: row.id,
    session_id: row.sessionId,
    branch_id: row.branchId,
    floor_id: row.floorId,
    page_id: row.pageId,
    message_id: row.messageId,
    requested_target_kind: row.requestedTargetKind,
    requested_target_id: row.requestedTargetId,
    revision_no: row.revisionNo,
    original_content: row.originalContent,
    previous_content: row.previousContent,
    edited_content: row.editedContent,
    reason: row.reason,
    actor_type: row.actorType,
    actor_id: row.actorId,
    actor_account_id: row.actorAccountId,
    actor_client_id: row.actorClientId,
    operation_log_id: row.operationLogId,
    created_at: row.createdAt,
  };
}

export function toManualRevisionTimelineResponse(row: CommittedContentManualRevisionTimeline) {
  return {
    target_kind: row.targetKind,
    target_id: row.targetId,
    session_id: row.sessionId,
    branch_id: row.branchId,
    floor_id: row.floorId,
    page_id: row.pageId,
    message_id: row.messageId,
    current_content: row.currentContent,
    current_token_count: row.currentTokenCount,
    latest_revision_no: row.latestRevisionNo,
    items: row.items.map(toManualRevisionRecordResponse),
  };
}

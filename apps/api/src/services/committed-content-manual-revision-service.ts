import { asc, desc, eq } from "drizzle-orm";
import { SimpleTokenCounter, type TokenCounter } from "@tavern/core";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  committedContentManualRevisions,
  floors,
  messagePages,
  messages,
  sessions,
} from "../db/schema.js";
import type { AuthenticatedAuthContext } from "../plugins/auth.js";
import { OperationLogService } from "./operation-log-service.js";
import { VcDiffService } from "./vc-diff-service.js";

const EDITABLE_MESSAGE_ROLES = new Set<typeof messages.$inferSelect.role>([
  "user",
  "assistant",
  "narrator",
]);

export type CommittedContentManualRevisionTargetKind = "message" | "page";

export type CommittedContentManualRevisionServiceErrorCode =
  | "not_found"
  | "manual_revision_invalid_state"
  | "manual_revision_shape_not_supported"
  | "manual_revision_conflict";

export class CommittedContentManualRevisionServiceError extends Error {
  constructor(
    public readonly statusCode: 404 | 409,
    public readonly code: CommittedContentManualRevisionServiceErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CommittedContentManualRevisionServiceError";
  }
}

export type CommittedContentManualRevisionActor = Pick<
  AuthenticatedAuthContext,
  "actorType" | "actorId" | "actorAccountId" | "actorClientId"
>;

export interface ApplyCommittedContentManualRevisionInput {
  actor: CommittedContentManualRevisionActor;
  content: string;
  expectedLatestRevisionNo: number;
  reason?: string | null;
  requestId?: string | null;
  targetId: string;
  targetKind: CommittedContentManualRevisionTargetKind;
}

export interface CommittedContentManualRevisionServiceOptions {
  now?: () => number;
  tokenCounter?: TokenCounter;
}

export interface CommittedContentManualRevisionRecord {
  id: string;
  sessionId: string;
  branchId: string;
  floorId: string;
  pageId: string;
  messageId: string;
  requestedTargetKind: CommittedContentManualRevisionTargetKind;
  requestedTargetId: string;
  revisionNo: number;
  originalContent: string;
  previousContent: string;
  editedContent: string;
  reason: string | null;
  actorType: "account" | "client";
  actorId: string;
  actorAccountId: string;
  actorClientId: string | null;
  operationLogId: string;
  createdAt: number;
}

export interface CommittedContentManualRevisionTimeline {
  targetKind: CommittedContentManualRevisionTargetKind;
  targetId: string;
  sessionId: string;
  branchId: string;
  floorId: string;
  pageId: string;
  messageId: string;
  currentContent: string;
  currentTokenCount: number;
  latestRevisionNo: number;
  items: CommittedContentManualRevisionRecord[];
}

type QueryExecutor = AppDb | DbExecutor;
type ManualRevisionRow = typeof committedContentManualRevisions.$inferSelect;

type ResolvedManualRevisionTarget = {
  accountId: string;
  workspaceId: string | null;
  projectId: string | null;
  sessionId: string;
  branchId: string;
  floorId: string;
  pageId: string;
  messageId: string;
  floorState: typeof floors.$inferSelect.state;
  floorSupersededAt: number | null;
  pageKind: typeof messagePages.$inferSelect.pageKind;
  role: typeof messages.$inferSelect.role;
  isHidden: boolean;
  content: string;
  tokenCount: number;
};

export class CommittedContentManualRevisionService {
  private readonly now: () => number;
  private readonly tokenCounter: TokenCounter;

  constructor(
    private readonly db: AppDb,
    options: CommittedContentManualRevisionServiceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.tokenCounter = options.tokenCounter ?? new SimpleTokenCounter();
  }

  getMessageTimeline(messageId: string): CommittedContentManualRevisionTimeline {
    const target = resolveMessageTarget(this.db, messageId);
    const rows = listRevisionRows(this.db, target.messageId);
    return buildTimeline("message", messageId, target, rows);
  }

  getPageTimeline(pageId: string): CommittedContentManualRevisionTimeline {
    const target = resolvePageTarget(this.db, pageId);
    const rows = listRevisionRows(this.db, target.messageId);
    return buildTimeline("page", pageId, target, rows);
  }

  applyManualRevision(input: ApplyCommittedContentManualRevisionInput): CommittedContentManualRevisionTimeline {
    try {
      return this.db.transaction((tx) => {
        const target = input.targetKind === "message"
          ? resolveMessageTarget(tx, input.targetId)
          : resolvePageTarget(tx, input.targetId);
        const existingRows = listRevisionRows(tx, target.messageId);
        const latestRevisionNo = existingRows.at(-1)?.revisionNo ?? 0;

        if (latestRevisionNo !== input.expectedLatestRevisionNo) {
          throw new CommittedContentManualRevisionServiceError(
            409,
            "manual_revision_conflict",
            "Committed content manual revision conflict",
            {
              current_content: target.content,
              current_token_count: target.tokenCount,
              current_latest_revision_no: latestRevisionNo,
              expected_latest_revision_no: input.expectedLatestRevisionNo,
              message_id: target.messageId,
              page_id: target.pageId,
              floor_id: target.floorId,
            },
          );
        }

        const createdAt = this.now();
        const currentTokenCount = this.tokenCounter.count(input.content);
        const revisionId = nanoid();
        const operationLogId = nanoid();
        const normalizedReason = normalizeReason(input.reason);
        const latestRow = existingRows.at(-1) ?? null;
        const revisionNo = latestRevisionNo + 1;
        const revisionRow = tx
          .insert(committedContentManualRevisions)
          .values({
                     id: revisionId,
            sessionId: target.sessionId,
            branchId: target.branchId,
            floorId: target.floorId,
            pageId: target.pageId,
            messageId: target.messageId,
            requestedTargetKind: input.targetKind,
            requestedTargetId: input.targetId,
            revisionNo,
            originalContent: latestRow?.originalContent ?? target.content,
            previousContent: target.content,
            editedContent: input.content,
            reason: normalizedReason,
            actorType: input.actor.actorType,
            actorId: input.actor.actorId,
            actorAccountId: input.actor.actorAccountId,
            actorClientId: input.actor.actorClientId,
            operationLogId: null,
            createdAt,
          })
          .returning()
          .get();

        tx
          .update(messages)
          .set({
            content: input.content,
            tokenCount: currentTokenCount,
          })
          .where(eq(messages.id, target.messageId))
          .run();

        tx
          .update(messagePages)
          .set({ updatedAt: createdAt })
          .where(eq(messagePages.id, target.pageId))
          .run();

        const beforeRef = toOperationLogRef(target, input.targetKind, input.targetId, target.content, target.tokenCount);
        const afterRef = toOperationLogRef(target, input.targetKind, input.targetId, input.content, currentTokenCount, revisionNo);

        new OperationLogService(tx).append({
          id: operationLogId,
          accountId: target.accountId,
          workspaceId: target.workspaceId,
          projectId: target.projectId,
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          actorAccountId: input.actor.actorAccountId,
          actorClientId: input.actor.actorClientId,
          requestId: normalizeNullableString(input.requestId),
          sourceType: "http",
          action: "message.manual_revision.apply",
          status: "succeeded",
          reason: normalizedReason,
          sessionId: target.sessionId,
          branchId: target.branchId,
          floorId: target.floorId,
          targetType: "message_manual_revision",
          targetId: revisionId,
          beforeRef,
          afterRef,
          diff: new VcDiffService().diff(beforeRef, afterRef),
          metadata: {
            route: input.targetKind === "message"
              ? "POST /messages/:id/manual-revisions"
              : "POST /pages/:id/manual-revisions",
            requested_target_kind: input.targetKind,
            requested_target_id: input.targetId,
            revision_id: revisionId,
            revision_no: revisionNo,
            message_id: target.messageId,
            page_id: target.pageId,
            floor_id: target.floorId,
            session_id: target.sessionId,
            branch_id: target.branchId,
            expected_latest_revision_no: input.expectedLatestRevisionNo,
          },
          createdAt,
        });

        tx
          .update(committedContentManualRevisions)
          .set({ operationLogId })
          .where(eq(committedContentManualRevisions.id, revisionId))
          .run();

        const timelineRows = [...existingRows.map(toRevisionRecord), {
          id: revisionRow.id,
          sessionId: revisionRow.sessionId,
          branchId: revisionRow.branchId,
          floorId: revisionRow.floorId,
          pageId: revisionRow.pageId,
          messageId: revisionRow.messageId,
          requestedTargetKind: revisionRow.requestedTargetKind,
          requestedTargetId: revisionRow.requestedTargetId,
          revisionNo: revisionRow.revisionNo,
          originalContent: revisionRow.originalContent,
          previousContent: revisionRow.previousContent,
          editedContent: revisionRow.editedContent,
          reason: revisionRow.reason,
          actorType: revisionRow.actorType,
          actorId: revisionRow.actorId,
          actorAccountId: revisionRow.actorAccountId,
          actorClientId: revisionRow.actorClientId,
          operationLogId,
          createdAt: revisionRow.createdAt,
        } satisfies CommittedContentManualRevisionRecord];
        return {
          targetKind: input.targetKind,
          targetId: input.targetId,
          sessionId: target.sessionId,
          branchId: target.branchId,
          floorId: target.floorId,
          pageId: target.pageId,
          messageId: target.messageId,
          currentContent: input.content,
          currentTokenCount,
          latestRevisionNo: revisionNo,
          items: timelineRows,
        };
      });
    } catch (error) {
      if (error instanceof CommittedContentManualRevisionServiceError) {
        throw error;
      }
      if (isManualRevisionConflictConstraintError(error)) {
        throw new CommittedContentManualRevisionServiceError(
          409,
          "manual_revision_conflict",
          "Committed content manual revision conflict",
        );
      }
      throw error;
    }
  }
}

function resolveMessageTarget(executor: QueryExecutor, messageId: string): ResolvedManualRevisionTarget {
  const row = executor
    .select({
      accountId: sessions.accountId,
      workspaceId: sessions.workspaceId,
      projectId: sessions.projectId,
      sessionId: sessions.id,
      branchId: floors.branchId,
      floorId: floors.id,
      pageId: messagePages.id,
      messageId: messages.id,
      floorState: floors.state,
      floorSupersededAt: floors.supersededAt,
      pageKind: messagePages.pageKind,
      role: messages.role,
      isHidden: messages.isHidden,
      content: messages.content,
      tokenCount: messages.tokenCount,
    })
    .from(messages)
    .innerJoin(messagePages, eq(messages.pageId, messagePages.id))
    .innerJoin(floors, eq(messagePages.floorId, floors.id))
    .innerJoin(sessions, eq(floors.sessionId, sessions.id))
    .where(eq(messages.id, messageId))
    .limit(1)
    .get();

  if (!row) {
    throw new CommittedContentManualRevisionServiceError(404, "not_found", "Message not found");
  }

  assertEditableTarget(row, "message", messageId);
  return row;
}

function resolvePageTarget(executor: QueryExecutor, pageId: string): ResolvedManualRevisionTarget {
  const rows = executor
    .select({
      accountId: sessions.accountId,
      workspaceId: sessions.workspaceId,
      projectId: sessions.projectId,
      sessionId: sessions.id,
      branchId: floors.branchId,
      floorId: floors.id,
      pageId: messagePages.id,
      messageId: messages.id,
      floorState: floors.state,
      floorSupersededAt: floors.supersededAt,
      pageKind: messagePages.pageKind,
      role: messages.role,
      isHidden: messages.isHidden,
      content: messages.content,
      tokenCount: messages.tokenCount,
    })
    .from(messagePages)
    .innerJoin(floors, eq(messagePages.floorId, floors.id))
    .innerJoin(sessions, eq(floors.sessionId, sessions.id))
    .innerJoin(messages, eq(messages.pageId, messagePages.id))
    .where(eq(messagePages.id, pageId))
    .orderBy(asc(messages.seq), asc(messages.id))
    .all();

  if (rows.length === 0) {
    const pageExists = executor
      .select({ id: messagePages.id })
      .from(messagePages)
      .where(eq(messagePages.id, pageId))
      .limit(1)
      .get();

    if (!pageExists) {
      throw new CommittedContentManualRevisionServiceError(404, "not_found", "Message page not found");
    }

    throw new CommittedContentManualRevisionServiceError(
      409,
      "manual_revision_shape_not_supported",
      "Page manual revision requires exactly one editable message",
      {
        page_id: pageId,
        message_count: 0,
      },
    );
  }

  if (rows.length !== 1) {
    throw new CommittedContentManualRevisionServiceError(
      409,
      "manual_revision_shape_not_supported",
      "Page manual revision requires exactly one editable message",
      {
        page_id: pageId,
        message_count: rows.length,
      },
    );
  }

  const row = rows[0]!;
  assertEditableTarget(row, "page", pageId);
  return row;
}

function assertEditableTarget(
  target: ResolvedManualRevisionTarget,
  targetKind: CommittedContentManualRevisionTargetKind,
  targetId: string,
): void {
  if (target.floorSupersededAt != null) {
    throw new CommittedContentManualRevisionServiceError(
      409,
      "manual_revision_invalid_state",
      "Committed content manual revision is only available on live committed floor messages",
      buildInvalidStateDetails("floor_superseded", targetKind, targetId, target),
    );
  }

  if (target.floorState !== "committed") {
    throw new CommittedContentManualRevisionServiceError(
      409,
      "manual_revision_invalid_state",
      "Committed content manual revision is only available on live committed floor messages",
      buildInvalidStateDetails("floor_not_committed", targetKind, targetId, target),
    );
  }

  if (target.isHidden) {
    throw new CommittedContentManualRevisionServiceError(
      409,
      "manual_revision_invalid_state",
      "Committed content manual revision does not support hidden messages",
      buildInvalidStateDetails("message_hidden", targetKind, targetId, target),
    );
  }

  if (!EDITABLE_MESSAGE_ROLES.has(target.role)) {
    throw new CommittedContentManualRevisionServiceError(
      409,
      "manual_revision_invalid_state",
      "Committed content manual revision only supports user, assistant, or narrator messages",
      buildInvalidStateDetails("message_role_not_supported", targetKind, targetId, target),
    );
  }
}

function buildInvalidStateDetails(
  reason: string,
  targetKind: CommittedContentManualRevisionTargetKind,
  targetId: string,
  target: ResolvedManualRevisionTarget,
): Record<string, unknown> {
  return {
    reason,
    target_kind: targetKind,
    target_id: targetId,
    session_id: target.sessionId,
    branch_id: target.branchId,
    floor_id: target.floorId,
    page_id: target.pageId,
    message_id: target.messageId,
    floor_state: target.floorState,
    floor_superseded_at: target.floorSupersededAt,
    message_role: target.role,
    is_hidden: target.isHidden,
  };
}

function listRevisionRows(executor: QueryExecutor, messageId: string): ManualRevisionRow[] {
  return executor
    .select()
    .from(committedContentManualRevisions)
    .where(eq(committedContentManualRevisions.messageId, messageId))
    .orderBy(
      asc(committedContentManualRevisions.revisionNo),
      asc(committedContentManualRevisions.createdAt),
      asc(committedContentManualRevisions.id),
    )
    .all();
}

function buildTimeline(
  targetKind: CommittedContentManualRevisionTargetKind,
  targetId: string,
  target: ResolvedManualRevisionTarget,
  rows: ManualRevisionRow[],
): CommittedContentManualRevisionTimeline {
  const items = rows.map(toRevisionRecord);
  return {
    targetKind,
    targetId,
    sessionId: target.sessionId,
    branchId: target.branchId,
    floorId: target.floorId,
    pageId: target.pageId,
    messageId: target.messageId,
    currentContent: target.content,
    currentTokenCount: target.tokenCount,
    latestRevisionNo: items.at(-1)?.revisionNo ?? 0,
    items,
  };
}

function toRevisionRecord(row: ManualRevisionRow): CommittedContentManualRevisionRecord {
  return mapManualRevisionRow(row);
}

function mapManualRevisionRow(row: ManualRevisionRow): CommittedContentManualRevisionRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    branchId: row.branchId,
    floorId: row.floorId,
    pageId: row.pageId,
    messageId: row.messageId,
    requestedTargetKind: row.requestedTargetKind,
    requestedTargetId: row.requestedTargetId,
    revisionNo: row.revisionNo,
    originalContent: row.originalContent,
    previousContent: row.previousContent,
    editedContent: row.editedContent,
    reason: row.reason,
    actorType: row.actorType,
    actorId: row.actorId,
    actorAccountId: row.actorAccountId,
    actorClientId: row.actorClientId,
    operationLogId: requireOperationLogId(row.operationLogId, row.id),
    createdAt: row.createdAt,
  };
}

function requireOperationLogId(value: string | null, revisionId: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw new Error(`Committed content manual revision '${revisionId}' is missing operation_log_id`);
}

function normalizeReason(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toOperationLogRef(
  target: ResolvedManualRevisionTarget,
  targetKind: CommittedContentManualRevisionTargetKind,
  targetId: string,
  content: string,
  tokenCount: number,
  revisionNo?: number,
): Record<string, unknown> {
  return {
    requested_target_kind: targetKind,
    requested_target_id: targetId,
    session_id: target.sessionId,
    branch_id: target.branchId,
    floor_id: target.floorId,
    page_id: target.pageId,
    message_id: target.messageId,
    role: target.role,
    content,
    token_count: tokenCount,
    ...(revisionNo !== undefined ? { revision_no: revisionNo } : {}),
  };
}

function isManualRevisionConflictConstraintError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    code === "SQLITE_CONSTRAINT_UNIQUE"
    || code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    || message.includes("committed_content_manual_revision_message_no_uq")
    || message.includes("committed_content_manual_revision.message_id, committed_content_manual_revision.revision_no")
  );
}

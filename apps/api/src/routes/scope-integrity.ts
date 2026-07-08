import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  ScopeIntegrityService,
  type ScopeIntegrityAuditActor,
  type ScopeIntegrityIssue,
  type ScopeIntegritySummary,
} from "../services/scope-integrity-service.js";
import { errorResponseJsonSchema } from "./schemas/common.js";

/**
 * WP-A4：ScopeIntegrityService 的受控对外入口。
 *
 * - 仅 account 主体可调用（预留后续 admin capability 扩展点）。
 * - `accountId` 始终取自 auth 上下文，不接受跨账户参数。
 * - `POST /scope-integrity/repair` 默认 `dry_run = true`，必须显式传 `dry_run = false` 才真实修复。
 * - 真实修复写 `scope_integrity.repair`、dry-run 写 `scope_integrity.diagnose` 审计（由服务在有漂移时落库）。
 */

const DEFAULT_ISSUE_LIMIT = 50;
const MAX_ISSUE_LIMIT = 500;

const reportQuerySchema = z
  .object({
    project_id: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_ISSUE_LIMIT).optional(),
  })
  .strict();

const repairBodySchema = z
  .object({
    dry_run: z.boolean().optional(),
    project_id: z.string().min(1).optional(),
  })
  .strict();

const scopeIssueJsonSchema = {
  type: "object",
  required: ["id", "severity", "table", "record_id", "code", "message", "repairable"],
  properties: {
    id: { type: "string" },
    severity: { type: "string", enum: ["error", "warning"] },
    table: { type: "string" },
    record_id: { type: "string" },
    code: { type: "string" },
    message: { type: "string" },
    expected: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
    actual: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
    repairable: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const scopeSummaryJsonSchema = {
  type: "object",
  required: [
    "total_issues",
    "repairable_issues",
    "unrepairable_issues",
    "truncated",
    "sessions_missing_workspace_id",
    "sessions_missing_project_id",
    "by_code",
  ],
  properties: {
    total_issues: { type: "integer", minimum: 0 },
    repairable_issues: { type: "integer", minimum: 0 },
    unrepairable_issues: { type: "integer", minimum: 0 },
    truncated: { type: "boolean" },
    sessions_missing_workspace_id: { type: "integer", minimum: 0 },
    sessions_missing_project_id: { type: "integer", minimum: 0 },
    by_code: {
      type: "array",
      items: {
        type: "object",
        required: ["code", "severity", "total", "repairable", "unrepairable"],
        properties: {
          code: { type: "string" },
          severity: { type: "string", enum: ["error", "warning"] },
          total: { type: "integer", minimum: 0 },
          repairable: { type: "integer", minimum: 0 },
          unrepairable: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

const reportResponseJsonSchema = {
  type: "object",
  required: ["summary", "issues"],
  properties: {
    summary: scopeSummaryJsonSchema,
    issues: { type: "array", items: scopeIssueJsonSchema },
  },
  additionalProperties: false,
} as const;

const repairResponseJsonSchema = {
  type: "object",
  required: ["dry_run", "repaired_count", "remaining_count", "repaired", "remaining"],
  properties: {
    dry_run: { type: "boolean" },
    repaired_count: { type: "integer", minimum: 0 },
    remaining_count: { type: "integer", minimum: 0 },
    repaired: { type: "array", items: scopeIssueJsonSchema },
    remaining: { type: "array", items: scopeIssueJsonSchema },
  },
  additionalProperties: false,
} as const;

const reportQueryJsonSchema = {
  type: "object",
  properties: {
    project_id: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: MAX_ISSUE_LIMIT },
  },
  additionalProperties: false,
} as const;

const repairBodyJsonSchema = {
  type: "object",
  properties: {
    dry_run: { type: "boolean" },
    project_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

function requireScopeIntegrityAccountActor(
  request: FastifyRequest,
  reply: FastifyReply,
): { accountId: string } | null {
  const auth = getRequestAuthContext(request);
  if (auth.actorType !== "account") {
    sendError(
      reply,
      403,
      "scope_integrity_account_only",
      "Scope integrity maintenance requires an account actor",
    );
    return null;
  }
  return { accountId: auth.accountId };
}

function buildScopeIntegrityAuditActor(request: FastifyRequest): ScopeIntegrityAuditActor {
  const auth = getRequestAuthContext(request);
  return {
    actorType: auth.actorType,
    actorId: auth.actorId,
    actorAccountId: auth.actorAccountId,
    actorClientId: auth.actorClientId,
    source: "api",
    requestId: typeof request.id === "string" && request.id.trim().length > 0 ? request.id : null,
  };
}

function issueToResponse(issue: ScopeIntegrityIssue) {
  return {
    id: issue.id,
    severity: issue.severity,
    table: issue.table,
    record_id: issue.recordId,
    code: issue.code,
    message: issue.message,
    expected: issue.expected ?? null,
    actual: issue.actual ?? null,
    repairable: issue.repairable,
  };
}

function summaryToResponse(summary: ScopeIntegritySummary) {
  return {
    total_issues: summary.totalIssues,
    repairable_issues: summary.repairableIssues,
    unrepairable_issues: summary.unrepairableIssues,
    truncated: summary.truncated,
    sessions_missing_workspace_id: summary.sessionsMissingWorkspaceId,
    sessions_missing_project_id: summary.sessionsMissingProjectId,
    by_code: summary.byCode.map((entry) => ({
      code: entry.code,
      severity: entry.severity,
      total: entry.total,
      repairable: entry.repairable,
      unrepairable: entry.unrepairable,
    })),
  };
}

export async function registerScopeIntegrityRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const db = connection.db;
  const scopeIntegrityService = new ScopeIntegrityService(db);

  app.get(
    "/scope-integrity/report",
    {
      schema: {
        tags: ["scope-integrity"],
        summary: "Report scope integrity drift for the current account",
        querystring: reportQueryJsonSchema,
        response: {
          200: reportResponseJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = requireScopeIntegrityAccountActor(request, reply);
      if (!actor) return;
      const parsed = parseWithSchema(reportQuerySchema, request.query, reply);
      if (!parsed.ok) return;

      const summary = scopeIntegrityService.summarize({
        accountId: actor.accountId,
        projectId: parsed.data.project_id,
      });
      const detail = scopeIntegrityService.diagnose({
        accountId: actor.accountId,
        projectId: parsed.data.project_id,
        limit: parsed.data.limit ?? DEFAULT_ISSUE_LIMIT,
      });

      return reply.send({
        summary: summaryToResponse(summary),
        issues: detail.issues.map(issueToResponse),
      });
    },
  );

  app.post(
    "/scope-integrity/repair",
    {
      schema: {
        tags: ["scope-integrity"],
        summary: "Repair (or preview) scope integrity drift for the current account",
        body: repairBodyJsonSchema,
        response: {
          200: repairResponseJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = requireScopeIntegrityAccountActor(request, reply);
      if (!actor) return;
      const parsed = parseWithSchema(repairBodySchema, request.body, reply);
      if (!parsed.ok) return;

      // Safe by default: only a real repair when dry_run is explicitly false.
      const dryRun = parsed.data.dry_run !== false;
      const result = scopeIntegrityService.repair({
        accountId: actor.accountId,
        projectId: parsed.data.project_id,
        dryRun,
        audit: buildScopeIntegrityAuditActor(request),
      });

      return reply.send({
        dry_run: dryRun,
        repaired_count: result.repaired.length,
        remaining_count: result.remaining.length,
        repaired: result.repaired.map(issueToResponse),
        remaining: result.remaining.map(issueToResponse),
      });
    },
  );
}

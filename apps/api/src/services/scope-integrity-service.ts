import { and, eq, isNull, or, type SQL } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  clientApiKeys,
  clients,
  derivedOutputs,
  operationLogs,
  projectInboxItems,
  projectMemberships,
  projects,
  sessions,
  agentTypes,
  projectAgentBindings,
  runtimeJobs,
} from "../db/schema.js";

export type ScopeIntegrityIssueSeverity = "error" | "warning";

export type ScopeIntegrityIssueCode =
  | "session_workspace_missing"
  | "session_project_missing"
  | "session_account_workspace_conflict"
  | "operation_log_workspace_missing"
  | "operation_log_project_missing"
  | "derived_output_workspace_mismatch"
  | "project_inbox_workspace_mismatch"
  | "project_membership_workspace_mismatch"
  | "project_membership_subject_missing"
  | "project_membership_subject_account_missing"
  | "project_membership_client_missing"
  | "client_api_key_account_mismatch"
  | "agent_type_workspace_account_mismatch"
  | "project_agent_binding_agent_type_workspace_mismatch"
  | "runtime_job_agent_binding_project_mismatch";

export type ScopeIntegrityIssue = {
  id: string;
  severity: ScopeIntegrityIssueSeverity;
  table: string;
  recordId: string;
  code: ScopeIntegrityIssueCode;
  message: string;
  expected?: Record<string, string | null>;
  actual?: Record<string, string | null>;
  repairable: boolean;
};

export type ScopeIntegrityDiagnoseInput = {
  accountId?: string;
  projectId?: string;
  limit?: number;
};

export type ScopeIntegrityReport = {
  issues: ScopeIntegrityIssue[];
  truncated: boolean;
};

export type ScopeIntegrityRepairInput = {
  accountId?: string;
  projectId?: string;
  dryRun?: boolean;
  now?: number;
};

export type ScopeIntegrityRepairReport = {
  repaired: ScopeIntegrityIssue[];
  remaining: ScopeIntegrityIssue[];
};

const DEFAULT_DIAGNOSE_LIMIT = 500;

/**
 * Diagnoses and repairs cross-table scope drift.
 *
 * The phase 4 implementation focuses on the additive, safe subset of repairs
 * that can be derived from project membership and session/project lineage. It
 * never modifies authoritative state such as `project.account_id` mismatches
 * or contradictory `source_floor_id` / `source_session_id` references.
 */
export class ScopeIntegrityService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  diagnose(input: ScopeIntegrityDiagnoseInput = {}): ScopeIntegrityReport {
    const limit = Math.max(1, Math.trunc(input.limit ?? DEFAULT_DIAGNOSE_LIMIT));
    const issues: ScopeIntegrityIssue[] = [];
    let truncated = false;

    const push = (collected: ScopeIntegrityIssue[]): boolean => {
      for (const issue of collected) {
        if (issues.length >= limit) {
          return false;
        }
        issues.push(issue);
      }
      return true;
    };

    if (!push(this.diagnoseSessions(input))) truncated = true;
    if (!truncated && !push(this.diagnoseOperationLogs(input))) truncated = true;
    if (!truncated && !push(this.diagnoseDerivedOutputs(input))) truncated = true;
    if (!truncated && !push(this.diagnoseProjectInbox(input))) truncated = true;
    if (!truncated && !push(this.diagnoseProjectMemberships(input))) truncated = true;
    if (!truncated && !push(this.diagnoseClientApiKeys(input))) truncated = true;
    if (!truncated && !push(this.diagnoseAgentTypes(input))) truncated = true;
    if (!truncated && !push(this.diagnoseProjectAgentBindings(input))) truncated = true;
    if (!truncated && !push(this.diagnoseRuntimeJobAgents(input))) truncated = true;

    return { issues, truncated };
  }

  repair(input: ScopeIntegrityRepairInput = {}): ScopeIntegrityRepairReport {
    const now = input.now ?? Date.now();
    const dryRun = input.dryRun === true;
    const report = this.diagnose({ accountId: input.accountId, projectId: input.projectId });
    const repaired: ScopeIntegrityIssue[] = [];
    const remaining: ScopeIntegrityIssue[] = [];

    for (const issue of report.issues) {
      if (!issue.repairable) {
        remaining.push(issue);
        continue;
      }

      if (dryRun) {
        repaired.push(issue);
        continue;
      }

      const ok = this.applyRepair(issue, now);
      if (ok) {
        repaired.push(issue);
      } else {
        remaining.push(issue);
      }
    }

    return { repaired, remaining };
  }

  private diagnoseSessions(input: ScopeIntegrityDiagnoseInput): ScopeIntegrityIssue[] {
    const issues: ScopeIntegrityIssue[] = [];
    const filters: SQL[] = [];
    if (input.accountId) filters.push(eq(sessions.accountId, input.accountId));
    if (input.projectId) filters.push(eq(sessions.projectId, input.projectId));

    const rows = this.db
      .select({
        id: sessions.id,
        accountId: sessions.accountId,
        workspaceId: sessions.workspaceId,
        projectId: sessions.projectId,
      })
      .from(sessions)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .all();

    for (const row of rows) {
      if (!row.projectId) {
        issues.push({
          id: `session_project_missing:${row.id}`,
          severity: "warning",
          table: "session",
          recordId: row.id,
     code: "session_project_missing",
          message: `Session is missing project_id: ${row.id}`,
          actual: { project_id: null },
          repairable: false,
        });
        continue;
      }

      const project = this.loadProjectScope(row.projectId);
      if (!project) {
        continue;
      }

      if (!row.workspaceId) {
        issues.push({
          id: `session_workspace_missing:${row.id}`,
          severity: "warning",
          table: "session",
          recordId: row.id,
          code: "session_workspace_missing",
          message: `Session has no workspace but its project provides one: ${row.id}`,
          expected: { workspace_id: project.workspaceId },
          actual: { workspace_id: null },
          repairable: true,
        });
      } else if (row.workspaceId !== project.workspaceId) {
        issues.push({
          id: `session_account_workspace_conflict:${row.id}`,
          severity: "error",
          table: "session",
          recordId: row.id,
  code: "session_account_workspace_conflict",
          message: `Session workspace conflicts with its project: ${row.id}`,
          expected: { workspace_id: project.workspaceId },
          actual: { workspace_id: row.workspaceId },
          repairable: false,
        });
      }
    }

    return issues;
  }

  private diagnoseOperationLogs(input: ScopeIntegrityDiagnoseInput): ScopeIntegrityIssue[] {
    const issues: ScopeIntegrityIssue[] = [];
    const filters: SQL[] = [
      or(isNull(operationLogs.workspaceId), isNull(operationLogs.projectId)) as SQL,
    ];
    if (input.accountId) filters.push(eq(operationLogs.accountId, input.accountId));
    if (input.projectId) filters.push(eq(operationLogs.projectId, input.projectId));

    const rows = this.db
      .select({
        id: operationLogs.id,
        accountId: operationLogs.accountId,
        workspaceId: operationLogs.workspaceId,
        projectId: operationLogs.projectId,
        sessionId: operationLogs.sessionId,
      })
      .from(operationLogs)
      .where(and(...filters))
      .limit(200)
      .all();

    for (const row of rows) {
      const projectId = row.projectId ?? this.resolveProjectIdFromSession(row.sessionId);
      if (!projectId) {
        continue;
      }

      const project = this.loadProjectScope(projectId);
      if (!project) continue;

      if (!row.projectId) {
        issues.push({
     id: `operation_log_project_missing:${row.id}`,
          severity: "warning",
          table: "operation_log",
          recordId: row.id,
          code: "operation_log_project_missing",
          message: `Operation log has no project_id but session_id resolves to one: ${row.id}`,
          expected: { project_id: projectId, workspace_id: project.workspaceId },
          actual: { project_id: null },
          repairable: true,
        });
        continue;
      }

      if (!row.workspaceId) {
        issues.push({
          id: `operation_log_workspace_missing:${row.id}`,
          severity: "warning",
          table: "operation_log",
          recordId: row.id,
          code: "operation_log_workspace_missing",
          message: `Operation log has no workspace_id but project provides one: ${row.id}`,
          expected: { workspace_id: project.workspaceId },
          actual: { workspace_id: null },
          repairable: true,
        });
      }
    }

    return issues;
  }

  private diagnoseDerivedOutputs(input: ScopeIntegrityDiagnoseInput): ScopeIntegrityIssue[] {
    const issues: ScopeIntegrityIssue[] = [];
   const filters: SQL[] = [];
    if (input.accountId) filters.push(eq(derivedOutputs.accountId, input.accountId));
    if (input.projectId) filters.push(eq(derivedOutputs.projectId, input.projectId));

    const rows = this.db
      .select({
        id: derivedOutputs.id,
        accountId: derivedOutputs.accountId,
  projectId: derivedOutputs.projectId,
        workspaceId: derivedOutputs.workspaceId,
      })
      .from(derivedOutputs)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .all();

    for (const row of rows) {
      const project = this.loadProjectScope(row.projectId);
      if (!project) continue;
      if (row.workspaceId !== project.workspaceId) {
        issues.push({
          id: `derived_output_workspace_mismatch:${row.id}`,
          severity: "warning",
          table: "derived_output",
          recordId: row.id,
          code: "derived_output_workspace_mismatch",
          message: `Derived output workspace differs from its project: ${row.id}`,
          expected: { workspace_id: project.workspaceId },
          actual: { workspace_id: row.workspaceId },
          repairable: true,
        });
      }
    }

    return issues;
  }

  private diagnoseProjectInbox(input: ScopeIntegrityDiagnoseInput): ScopeIntegrityIssue[] {
    const issues: ScopeIntegrityIssue[] = [];
    const filters: SQL[] = [];
    if (input.accountId) filters.push(eq(projectInboxItems.accountId, input.accountId));
    if (input.projectId) filters.push(eq(projectInboxItems.projectId, input.projectId));

    const rows = this.db
      .select({
        id: projectInboxItems.id,
        accountId: projectInboxItems.accountId,
        projectId: projectInboxItems.projectId,
        workspaceId: projectInboxItems.workspaceId,
      })
      .from(projectInboxItems)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .all();

    for (const row of rows) {
      const project = this.loadProjectScope(row.projectId);
      if (!project) continue;
      if (row.workspaceId !== project.workspaceId) {
        issues.push({
          id: `project_inbox_workspace_mismatch:${row.id}`,
          severity: "warning",
          table: "project_inbox_item",
          recordId: row.id,
          code: "project_inbox_workspace_mismatch",
          message: `Project inbox workspace differs from its project: ${row.id}`,
          expected: { workspace_id: project.workspaceId },
          actual: { workspace_id: row.workspaceId },
          repairable: true,
        });
      }
    }

    return issues;
  }

  private diagnoseProjectMemberships(input: ScopeIntegrityDiagnoseInput): ScopeIntegrityIssue[] {
    const issues: ScopeIntegrityIssue[] = [];
    const filters: SQL[] = [];
    if (input.accountId) filters.push(eq(projectMemberships.accountId, input.accountId));
    if (input.projectId) filters.push(eq(projectMemberships.projectId, input.projectId));

    const rows = this.db
      .select({
        id: projectMemberships.id,
        accountId: projectMemberships.accountId,
        projectId: projectMemberships.projectId,
        workspaceId: projectMemberships.workspaceId,
        subjectType: projectMemberships.subjectType,
        subjectId: projectMemberships.subjectId,
        clientId: projectMemberships.clientId,
      })
      .from(projectMemberships)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .all();

    for (const row of rows) {
      const project = this.loadProjectScope(row.projectId);
      if (!project) continue;

      if (row.workspaceId !== project.workspaceId) {
        issues.push({
          id: `project_membership_workspace_mismatch:${row.id}`,
          severity: "warning",
          table: "project_membership",
          recordId: row.id,
          code: "project_membership_workspace_mismatch",
          message: `Project membership workspace differs from its project: ${row.id}`,
          expected: { workspace_id: project.workspaceId },
          actual: { workspace_id: row.workspaceId },
          repairable: true,
        });
      }

      if (!row.subjectType || !row.subjectId) {
        if (row.accountId) {
          issues.push({
            id: `project_membership_subject_missing:${row.id}`,
            severity: "warning",
            table: "project_membership",
            recordId: row.id,
            code: "project_membership_subject_missing",
            message: `Project membership subject can be backfilled from account_id: ${row.id}`,
            expected: { subject_type: "account", subject_id: row.accountId },
            actual: { subject_type: row.subjectType, subject_id: row.subjectId },
            repairable: true,
          });
        } else {
          issues.push({
            id: `project_membership_subject_account_missing:${row.id}`,
            severity: "error",
            table: "project_membership",
            recordId: row.id,
            code: "project_membership_subject_account_missing",
            message: `Project membership has no subject and no legacy account_id: ${row.id}`,
            repairable: false,
          });
        }
      }

      if (row.subjectType === "client" && row.subjectId) {
        const client = this.db
          .select({ id: clients.id })
          .from(clients)
          .where(eq(clients.id, row.subjectId))
          .limit(1)
          .get();
        if (!client) {
          issues.push({
            id: `project_membership_client_missing:${row.id}`,
        severity: "error",
            table: "project_membership",
            recordId: row.id,
            code: "project_membership_client_missing",
            message: `Project membership references missing client: ${row.subjectId}`,
            actual: { subject_id: row.subjectId },
            repairable: false,
          });
        }
      }
    }

    return issues;
  }

  private diagnoseClientApiKeys(input: ScopeIntegrityDiagnoseInput): ScopeIntegrityIssue[] {
    const issues: ScopeIntegrityIssue[] = [];
    const filters: SQL[] = [];
    if (input.accountId) filters.push(eq(clientApiKeys.accountId, input.accountId));

    const rows = this.db
      .select({
        id: clientApiKeys.id,
        accountId: clientApiKeys.accountId,
        clientId: clientApiKeys.clientId,
      })
      .from(clientApiKeys)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .all();

    for (const row of rows) {
      const client = this.db
        .select({ id: clients.id, accountId: clients.accountId })
        .from(clients)
        .where(eq(clients.id, row.clientId))
        .limit(1)
        .get();
      if (!client) continue;
      if (client.accountId !== row.accountId) {
        issues.push({
          id: `client_api_key_account_mismatch:${row.id}`,
          severity: "error",
          table: "client_api_key",
          recordId: row.id,
          code: "client_api_key_account_mismatch",
          message: `Client API key account differs from its client: ${row.id}`,
          expected: { account_id: client.accountId },
          actual: { account_id: row.accountId },
          repairable: false,
        });
      }
    }

    return issues;
  }
  private diagnoseAgentTypes(input: ScopeIntegrityDiagnoseInput): ScopeIntegrityIssue[] {
    const issues: ScopeIntegrityIssue[] = [];
    const filters: SQL[] = [];
    if (input.accountId) filters.push(eq(agentTypes.accountId,input.accountId));

    const rows = this.db
      .select({
        id: agentTypes.id,
       workspaceId: agentTypes.workspaceId,
        accountId: agentTypes.accountId,
      })
      .from(agentTypes)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .all();

    for (const row of rows) {
      const project = this.loadAgentTypeWorkspaceAccount(row.workspaceId);
if (!project) continue;
      if (project.accountId !== row.accountId) {
        issues.push({
          id: `agent_type_workspace_account_mismatch:${row.id}`,
          severity: "error",
          table: "agent_type",
          recordId: row.id,
          code: "agent_type_workspace_account_mismatch",
          message: `Agent type account differs from its workspace owner: ${row.id}`,
          expected: { account_id: project.accountId },
          actual: { account_id: row.accountId },
          repairable: false,
        });
      }
    }

    return issues;
  }

  private diagnoseProjectAgentBindings(input: ScopeIntegrityDiagnoseInput): ScopeIntegrityIssue[] {
    const issues: ScopeIntegrityIssue[] = [];
    const filters: SQL[] = [];
    if (input.accountId) filters.push(eq(projectAgentBindings.accountId, input.accountId));
    if (input.projectId) filters.push(eq(projectAgentBindings.projectId, input.projectId));

   const rows = this.db
      .select({
        id: projectAgentBindings.id,
        workspaceId:projectAgentBindings.workspaceId,
        agentTypeId: projectAgentBindings.agentTypeId,
   })
      .from(projectAgentBindings)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .all();

    for (const row of rows) {
      const agentType = this.db
        .select({ workspaceId: agentTypes.workspaceId })
        .from(agentTypes)
        .where(eq(agentTypes.id, row.agentTypeId))
        .limit(1)
        .all()[0];
      if (!agentType) continue;
      if (agentType.workspaceId !== row.workspaceId) {
        issues.push({
          id: `project_agent_binding_agent_type_workspace_mismatch:${row.id}`,
          severity: "error",
          table: "project_agent_binding",
          recordId: row.id,
          code: "project_agent_binding_agent_type_workspace_mismatch",
          message: `Project agent binding references an agent type from another workspace: ${row.id}`,
          expected: { workspace_id:agentType.workspaceId },
          actual: { workspace_id: row.workspaceId },
          repairable: false,
        });
      }
    }

    return issues;
  }

  private diagnoseRuntimeJobAgents(input: ScopeIntegrityDiagnoseInput): ScopeIntegrityIssue[] {
    const issues: ScopeIntegrityIssue[] = [];
    const filters: SQL[] = [];
    if (input.accountId) filters.push(eq(runtimeJobs.accountId, input.accountId));
    if (input.projectId) filters.push(eq(runtimeJobs.projectId, input.projectId));

    const rows = this.db
      .select({
        id: runtimeJobs.id,
        projectId: runtimeJobs.projectId,
        agentBindingId: runtimeJobs.agentBindingId,
      })
      .from(runtimeJobs)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .all();

    for (const row of rows) {
      if (!row.agentBindingId) continue;
      const binding = this.db
        .select({ projectId: projectAgentBindings.projectId })
        .from(projectAgentBindings)
        .where(eq(projectAgentBindings.id, row.agentBindingId))
        .limit(1)
  .all()[0];
      if (!binding) continue;
      if (row.projectId && binding.projectId !== row.projectId) {
        issues.push({
          id: `runtime_job_agent_binding_project_mismatch:${row.id}`,
          severity: "error",
          table: "runtime_job",
          recordId: row.id,
    code: "runtime_job_agent_binding_project_mismatch",
          message: `Runtime job project differs from itsagent binding project: ${row.id}`,
     expected: { project_id: binding.projectId },
          actual: { project_id: row.projectId },
          repairable: false,
        });
      }
    }

    return issues;
  }

  private loadAgentTypeWorkspaceAccount(workspaceId: string): { accountId: string } | null {
    if (!workspaceId) return null;
    const row = this.db
      .select({
        accountId: projects.accountId,
      })
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId))
      .limit(1)
      .all()[0];
    return row ?? null;
  }



  private applyRepair(issue: ScopeIntegrityIssue, now: number): boolean {
    try {
      switch (issue.code) {
        case "session_workspace_missing": {
          const expected = issue.expected?.workspace_id ?? null;
          if (!expected) return false;
          this.db
            .update(sessions)
            .set({ workspaceId: expected, updatedAt: now })
            .where(and(eq(sessions.id, issue.recordId), isNull(sessions.workspaceId)))
            .run();
          return true;
        }
        case "operation_log_workspace_missing": {
          const expected = issue.expected?.workspace_id ?? null;
          if (!expected) return false;
          this.db
            .update(operationLogs)
            .set({ workspaceId: expected })
            .where(and(eq(operationLogs.id, issue.recordId), isNull(operationLogs.workspaceId)))
            .run();
          return true;
        }
        case "operation_log_project_missing": {
          const expectedProject = issue.expected?.project_id ?? null;
          if (!expectedProject) return false;
          const expectedWorkspace = issue.expected?.workspace_id ?? null;
          const patch: { projectId: string; workspaceId?: string } = { projectId: expectedProject };
          if (expectedWorkspace) {
            patch.workspaceId = expectedWorkspace;
          }
          this.db
            .update(operationLogs)
            .set(patch)
            .where(and(eq(operationLogs.id, issue.recordId), isNull(operationLogs.projectId)))
            .run();
          return true;
        }
        case "derived_output_workspace_mismatch": {
          const expected = issue.expected?.workspace_id ?? null;
          if (!expected) return false;
          this.db
            .update(derivedOutputs)
            .set({ workspaceId: expected, updatedAt: now })
            .where(eq(derivedOutputs.id, issue.recordId))
            .run();
          return true;
        }
        case "project_inbox_workspace_mismatch": {
          const expected = issue.expected?.workspace_id ?? null;
          if (!expected) return false;
          this.db
            .update(projectInboxItems)
            .set({ workspaceId: expected, updatedAt: now })
            .where(eq(projectInboxItems.id, issue.recordId))
            .run();
          return true;
        }
        case "project_membership_workspace_mismatch": {
          const expected = issue.expected?.workspace_id ?? null;
          if (!expected) return false;
          this.db
            .update(projectMemberships)
            .set({ workspaceId: expected, updatedAt: now })
            .where(eq(projectMemberships.id, issue.recordId))
            .run();
          return true;
        }
        case "project_membership_subject_missing": {
          const expectedSubjectType = issue.expected?.subject_type as "account" | "client" | undefined;
          const expectedSubjectId = issue.expected?.subject_id ?? null;
          if (!expectedSubjectType || !expectedSubjectId) return false;
          this.db
            .update(projectMemberships)
            .set({
              subjectType: expectedSubjectType,
              subjectId: expectedSubjectId,
              updatedAt: now,
            })
            .where(
              and(
                eq(projectMemberships.id, issue.recordId),
                or(isNull(projectMemberships.subjectType), isNull(projectMemberships.subjectId)) as SQL,
              ),
            )
            .run();
          return true;
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  private loadProjectScope(
    projectId: string | null | undefined,
  ): { id: string; workspaceId: string; accountId: string } | null {
    if (!projectId) return null;
    const row = this.db
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        accountId: projects.accountId,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .get();
    return row ?? null;
  }

  private resolveProjectIdFromSession(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null;
    const row = this.db
      .select({ projectId: sessions.projectId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1)
      .get();
    return row?.projectId ?? null;
  }
}

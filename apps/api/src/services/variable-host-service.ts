import { and, eq } from "drizzle-orm";
import type { VariableContext } from "@tavern/core";
import { buildBranchVariableScopeId, parseBranchVariableScopeId, type VariableScope } from "@tavern/shared";

import type { AppDb, DbExecutor } from "../db/client.js";
import { floors, messagePages, sessions } from "../db/schema.js";
import { VariableServiceError } from "./variable-service-errors.js";

export const DEFAULT_GLOBAL_SCOPE_ID = "global";

type FloorState = typeof floors.$inferSelect["state"];

export interface VariableTarget {
  accountId: string;
  scope: VariableScope;
  scopeId: string;
  sessionId?: string;
  branchId?: string;
  floorId?: string;
  pageId?: string;
  floorState?: FloorState;
  context: VariableContext;
}

export interface ResolveVariableContextInput {
  sessionId?: string;
  branchId?: string;
  floorId?: string;
  pageId?: string;
  globalScopeId?: string;
}

export class VariableHostService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  async resolveTarget(accountId: string, scope: VariableScope, scopeId: string): Promise<VariableTarget> {
    switch (scope) {
      case "global":
        return this.createGlobalTarget(accountId);
      case "chat":
        return this.resolveChatTarget(accountId, scopeId);
      case "branch":
        return this.resolveBranchTarget(accountId, scopeId);
      case "floor":
        return this.resolveFloorTarget(accountId, scopeId);
      case "page":
        return this.resolvePageTarget(accountId, scopeId);
      default:
        throw new VariableServiceError("invalid_variable_context", `Unsupported variable scope: ${String(scope)}`);
    }
  }

  async resolveContext(accountId: string, input: ResolveVariableContextInput): Promise<VariableContext> {
    const globalScopeId = normalizeGlobalScopeId(input.globalScopeId);

    let sessionId = input.sessionId;
    let branchId = input.branchId;
    let floorId = input.floorId;
    let pageId = input.pageId;

    if (pageId) {
      const pageTarget = await this.resolvePageTarget(accountId, pageId);

      if (floorId && pageTarget.floorId !== floorId) {
        throw new VariableServiceError(
          "invalid_variable_context",
          `Page '${pageId}' does not belong to floor '${floorId}'`
        );
      }

      if (sessionId && pageTarget.sessionId !== sessionId) {
        throw new VariableServiceError(
          "invalid_variable_context",
          `Page '${pageId}' does not belong to session '${sessionId}'`
        );
      }

      if (branchId && pageTarget.branchId !== branchId) {
        throw new VariableServiceError(
          "invalid_variable_context",
          `Page '${pageId}' does not belong to branch '${branchId}'`
        );
      }

      sessionId = pageTarget.sessionId;
      branchId = pageTarget.branchId;
      floorId = pageTarget.floorId;
      pageId = pageTarget.pageId;
    }

    if (floorId) {
      const floorTarget = await this.resolveFloorTarget(accountId, floorId);

      if (sessionId && floorTarget.sessionId !== sessionId) {
        throw new VariableServiceError(
          "invalid_variable_context",
          `Floor '${floorId}' does not belong to session '${sessionId}'`
        );
      }

      if (branchId && floorTarget.branchId !== branchId) {
        throw new VariableServiceError(
          "invalid_variable_context",
          `Floor '${floorId}' does not belong to branch '${branchId}'`
        );
      }

      sessionId = floorTarget.sessionId;
      branchId = floorTarget.branchId;
      floorId = floorTarget.floorId;
    }

    if (branchId) {
      if (!sessionId) {
        throw new VariableServiceError(
          "invalid_variable_context",
          `Branch '${branchId}' requires session_id to resolve variable context`
        );
      }

      const branchTarget = await this.resolveBranchTargetByParts(accountId, sessionId, branchId);
      sessionId = branchTarget.sessionId;
      branchId = branchTarget.branchId;
    }

    if (sessionId) {
      const chatTarget = await this.resolveChatTarget(accountId, sessionId);
      sessionId = chatTarget.sessionId;
    }

    return {
      accountId,
      sessionId,
      branchId,
      floorId,
      pageId,
      globalScopeId,
    };
  }

  assertWritableTarget(target: VariableTarget): void {
    if ((target.scope === "floor" || target.scope === "page") && target.floorState === "committed") {
      throw new VariableServiceError(
        "variable_target_locked",
        `Variables on committed ${target.scope} targets are read-only`
      );
    }
  }

  private createGlobalTarget(accountId: string): VariableTarget {
    return {
      accountId,
      scope: "global",
      scopeId: DEFAULT_GLOBAL_SCOPE_ID,
      context: {
        accountId,
        globalScopeId: DEFAULT_GLOBAL_SCOPE_ID,
      },
    };
  }

  private async resolveChatTarget(accountId: string, sessionId: string): Promise<VariableTarget> {
    const row = await this.db
      .select({
        sessionId: sessions.id,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
      .limit(1);

    const session = row[0];

    if (!session) {
      throw new VariableServiceError("variable_host_not_found", `Session '${sessionId}' not found`);
    }

    return {
      accountId,
      scope: "chat",
      scopeId: session.sessionId,
      sessionId: session.sessionId,
      context: {
        accountId,
        sessionId: session.sessionId,
        globalScopeId: DEFAULT_GLOBAL_SCOPE_ID,
      },
    };
  }

  private async resolveBranchTarget(accountId: string, scopeId: string): Promise<VariableTarget> {
    const parsed = parseBranchVariableScopeId(scopeId);

    if (!parsed) {
      throw new VariableServiceError("invalid_variable_context", `Invalid branch scope_id '${scopeId}'`);
    }

    return this.resolveBranchTargetByParts(accountId, parsed.sessionId, parsed.branchId);
  }

  private async resolveBranchTargetByParts(
    accountId: string,
    sessionId: string,
    branchId: string,
  ): Promise<VariableTarget> {
    const row = await this.db
      .select({
        sessionId: sessions.id,
        branchId: floors.branchId,
      })
      .from(floors)
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.accountId, accountId),
          eq(floors.branchId, branchId),
        ),
      )
      .limit(1);

    const branch = row[0];

    if (!branch) {
      throw new VariableServiceError(
        "variable_host_not_found",
        `Branch '${branchId}' not found in session '${sessionId}'`
      );
    }

    return {
      accountId,
      scope: "branch",
      scopeId: buildBranchVariableScopeId(branch.sessionId, branch.branchId),
      sessionId: branch.sessionId,
      branchId: branch.branchId,
      context: {
        accountId,
        sessionId: branch.sessionId,
        branchId: branch.branchId,
        globalScopeId: DEFAULT_GLOBAL_SCOPE_ID,
      },
    };
  }

  private async resolveFloorTarget(accountId: string, floorId: string): Promise<VariableTarget> {
    const row = await this.db
      .select({
        floorId: floors.id,
        floorState: floors.state,
        sessionId: sessions.id,
        branchId: floors.branchId,
      })
      .from(floors)
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(and(eq(floors.id, floorId), eq(sessions.accountId, accountId)))
      .limit(1);

    const floor = row[0];

    if (!floor) {
      throw new VariableServiceError("variable_host_not_found", `Floor '${floorId}' not found`);
    }

    return {
      accountId,
      scope: "floor",
      scopeId: floor.floorId,
      sessionId: floor.sessionId,
      branchId: floor.branchId,
      floorId: floor.floorId,
      floorState: floor.floorState,
      context: {
        accountId,
        sessionId: floor.sessionId,
        branchId: floor.branchId,
        floorId: floor.floorId,
        globalScopeId: DEFAULT_GLOBAL_SCOPE_ID,
      },
    };
  }

  private async resolvePageTarget(accountId: string, pageId: string): Promise<VariableTarget> {
    const row = await this.db
      .select({
        pageId: messagePages.id,
        floorId: floors.id,
        floorState: floors.state,
        sessionId: sessions.id,
        branchId: floors.branchId,
      })
      .from(messagePages)
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(and(eq(messagePages.id, pageId), eq(sessions.accountId, accountId)))
      .limit(1);

    const page = row[0];

    if (!page) {
      throw new VariableServiceError("variable_host_not_found", `Page '${pageId}' not found`);
    }

    return {
      accountId,
      scope: "page",
      scopeId: page.pageId,
      sessionId: page.sessionId,
      branchId: page.branchId,
      floorId: page.floorId,
      pageId: page.pageId,
      floorState: page.floorState,
      context: {
        accountId,
        sessionId: page.sessionId,
        branchId: page.branchId,
        floorId: page.floorId,
        pageId: page.pageId,
        globalScopeId: DEFAULT_GLOBAL_SCOPE_ID,
      },
    };
  }
}

function normalizeGlobalScopeId(_scopeId?: string): string {
  return DEFAULT_GLOBAL_SCOPE_ID;
}

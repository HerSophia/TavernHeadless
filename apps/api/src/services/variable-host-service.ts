import { and, eq } from "drizzle-orm";
import type { VariableContext } from "@tavern/core";
import type { VariableScope } from "@tavern/shared";

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
  floorId?: string;
  pageId?: string;
  floorState?: FloorState;
  context: VariableContext;
}

export interface ResolveVariableContextInput {
  sessionId?: string;
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

      sessionId = pageTarget.sessionId;
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

      sessionId = floorTarget.sessionId;
      floorId = floorTarget.floorId;
    }

    if (sessionId) {
      const chatTarget = await this.resolveChatTarget(accountId, sessionId);
      sessionId = chatTarget.sessionId;
    }

    return {
      accountId,
      sessionId,
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

  private async resolveFloorTarget(accountId: string, floorId: string): Promise<VariableTarget> {
    const row = await this.db
      .select({
        floorId: floors.id,
        floorState: floors.state,
        sessionId: sessions.id,
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
      floorId: floor.floorId,
      floorState: floor.floorState,
      context: {
        accountId,
        sessionId: floor.sessionId,
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
      floorId: page.floorId,
      pageId: page.pageId,
      floorState: page.floorState,
      context: {
        accountId,
        sessionId: page.sessionId,
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

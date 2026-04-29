import { and, eq } from "drizzle-orm";
import type { ToolPermissions, ToolRegistry, TurnConfig } from "@tavern/core";

import type { AppDb } from "../../db/client.js";
import { sessions } from "../../db/schema.js";
import {
  mapSessionBaseToolPermissionsRecordToCorePermissions,
  resolveEffectiveToolPermissions,
} from "../tooling/shared/permission-overlay.js";
import {
  SessionToolRegistryService,
  SessionToolRegistryServiceError,
} from "../session-tool-registry-service.js";

import type { ChatServiceErrorFactory } from "./types.js";

export class TurnToolingService {
  constructor(
    private readonly db: AppDb,
    private readonly createError: ChatServiceErrorFactory,
    private readonly options: {
      toolRegistry?: ToolRegistry;
      sessionToolRegistryService?: SessionToolRegistryService;
      resolveToolPermissions?: (sessionId: string, accountId: string) => Promise<ToolPermissions | null>;
    } = {},
  ) {}

  async resolveToolPermissionsForSession(
    sessionId: string,
    accountId: string,
  ): Promise<ToolPermissions | undefined> {
    if (!this.options.toolRegistry && !this.options.sessionToolRegistryService) {
      return undefined;
    }

    if (this.options.resolveToolPermissions) {
      const permissions = await this.options.resolveToolPermissions(sessionId, accountId);
      if (permissions) {
        return resolveEffectiveToolPermissions(permissions);
      }
    }

    try {
      const [session] = await this.db
        .select({ metadataJson: sessions.metadataJson })
        .from(sessions)
        .where(and(
          eq(sessions.id, sessionId),
          eq(sessions.accountId, accountId),
        ))
        .limit(1);

      if (session?.metadataJson) {
        const metadata = JSON.parse(session.metadataJson) as Record<string, unknown>;
        const sessionBasePermissions = mapSessionBaseToolPermissionsRecordToCorePermissions(
          metadata.tool_permissions,
        );
        if (sessionBasePermissions) {
          return resolveEffectiveToolPermissions(sessionBasePermissions);
        }
      }
    } catch {
      // JSON 解析失败时返回 undefined
    }

    return undefined;
  }

  async resolveToolRegistryForSession(
    sessionId: string,
    accountId: string,
    config?: TurnConfig,
  ): Promise<ToolRegistry | undefined> {
    if (config?.enableTools !== true) {
      return undefined;
    }

    if (!this.options.sessionToolRegistryService) {
      return this.options.toolRegistry;
    }

    try {
      const runtime = await this.options.sessionToolRegistryService.buildRuntime(sessionId, accountId);
      return runtime.registry;
    } catch (error) {
      if (error instanceof SessionToolRegistryServiceError) {
        throw this.createError(error.code, error.message, error);
      }

      throw error;
    }
  }

  async resolveTurnToolingForTurn(args: {
    sessionId: string;
    accountId: string;
    config?: TurnConfig;
  }): Promise<{ toolRegistry?: ToolRegistry; toolPermissions?: ToolPermissions }> {
    if (args.config?.enableTools !== true) {
      return {};
    }

    return {
      toolRegistry: await this.resolveToolRegistryForSession(args.sessionId, args.accountId, args.config),
      toolPermissions: await this.resolveToolPermissionsForSession(args.sessionId, args.accountId),
    };
  }
}

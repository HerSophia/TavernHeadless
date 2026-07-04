import { and, eq } from "drizzle-orm";
import type { ToolPermissions, ToolRegistry, TurnConfig } from "@tavern/core";

import type { AppDb } from "../../db/client.js";
import { sessions } from "../../db/schema.js";
import {
  mapSessionBaseToolPermissionsRecordToCorePermissions,
  normalizeSessionBaseToolPermissionsRecord,
} from "../tooling/shared/permission-overlay.js";
import {
  resolveEffectiveToolPolicy,
  type EffectiveToolPolicyResolution,
} from "../tooling/shared/tool-policy-resolution.js";
import { SessionEffectiveToolPolicyProvider } from "../tooling/shared/session-effective-tool-policy-provider.js";
import {
  SessionToolRegistryService,
  SessionToolRegistryServiceError,
} from "../session-tool-registry-service.js";
import { GRAPH_ASSISTANT_PURPOSE } from "../temporary-conversation-types.js";

import type { ChatServiceErrorFactory } from "./types.js";

export class TurnToolingService {
  constructor(
    private readonly db: AppDb,
    private readonly createError: ChatServiceErrorFactory,
    private readonly options: {
      toolRegistry?: ToolRegistry;
      sessionToolRegistryService?: SessionToolRegistryService;
      resolveToolPermissions?: (sessionId: string, accountId: string) => Promise<ToolPermissions | null>;
      resolveEffectiveToolPolicy?: (
        sessionId: string,
        accountId: string,
      ) => Promise<EffectiveToolPolicyResolution | null>;
    } = {},
  ) {}

  async resolveEffectiveToolPolicy(
    sessionId: string,
    accountId: string,
  ): Promise<EffectiveToolPolicyResolution | null> {
    if (this.options.resolveEffectiveToolPolicy) {
      const resolution = await this.options.resolveEffectiveToolPolicy(sessionId, accountId);
      if (resolution) {
        return resolution;
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

      const sessionBase = session?.metadataJson
        ? normalizeSessionBaseToolPermissionsRecord(
            (JSON.parse(session.metadataJson) as Record<string, unknown>).tool_permissions,
          )
        : undefined;

      const projectAware = await new SessionEffectiveToolPolicyProvider(this.db).resolve({
        sessionId,
        accountId,
      });

      if (projectAware) {
        if (!projectAware.sessionBase && sessionBase) {
          return {
            ...projectAware,
            sessionBase: projectAware.sessionBase ?? null,
            effectivePermissions: projectAware.effectivePermissions
              ?? resolveEffectiveToolPolicy({ sessionBase }).effectivePermissions,
          };
        }

        return projectAware;
      }

      return resolveEffectiveToolPolicy({ sessionBase });
    } catch {
      return resolveEffectiveToolPolicy({});
    }
  }

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
        return permissions;
      }
    }

    const effectivePolicy = await this.resolveEffectiveToolPolicy(sessionId, accountId);
    if (effectivePolicy?.effectivePermissions) {
      return effectivePolicy.effectivePermissions;
    }

    let sessionPurpose: string | null = null;
    try {
      const [session] = await this.db
        .select({ purpose: sessions.purpose, metadataJson:sessions.metadataJson })
        .from(sessions)
        .where(and(
          eq(sessions.id, sessionId),
          eq(sessions.accountId, accountId),
        ))
        .limit(1);

      sessionPurpose = session?.purpose?? null;

      if (session?.metadataJson) {
        const metadata = JSON.parse(session.metadataJson) as Record<string, unknown>;
        const sessionBasePermissions = mapSessionBaseToolPermissionsRecordToCorePermissions(
          metadata.tool_permissions,
        );
        if (sessionBasePermissions) {
          return sessionBasePermissions;
        }
      }
    } catch {
      // JSON 解析失败时忽略，继续走后续兜底
    }

    // 图助手会话兜底：即使会话 metadata 未显式启用工具（例如旧会话缺 enabled 字段），
    // 也默认启用工具权限，避免 transport 因 tools_disabled 退化为 none 导致工具调用文本汏露与幻觉。
    if (sessionPurpose === GRAPH_ASSISTANT_PURPOSE) {
      return { enabled: true, allowIrreversible: false };
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

export {
  resolveEffectiveToolPolicy,
};

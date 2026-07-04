import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../../db/client.js";
import { sessions } from "../../../db/schema.js";
import { createTestSessionWithScope } from "../../../__tests__/helpers/workspace-project.js";
import { TurnToolingService } from "../turn-tooling-service.js";
import type { SessionToolRegistryService } from "../../session-tool-registry-service.js";
import type { ChatServiceErrorFactory } from "../types.js";

/**
 * 验证图助手会话的工具权限兜底：
 *
 * 旧的图助手会话 metadata 只写了 `tool_permissions.allow_irreversible`，缺少 `enabled` 字段，
 * 导致权限解析返回 undefined、transport 退化为 none，进而工具调用文本泄漏并触发幻觉。
 * TurnToolingService 在最终返回 undefined 之前，对图助手会话兜底为默认启用权限。
 */
describe("TurnToolingService.resolveToolPermissionsForSession graph-assistant fallback", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  function buildService(): TurnToolingService {
    return new TurnToolingService(
      database.db,
      ((code: string, message: string) => new Error(`${code}: ${message}`)) as unknown as ChatServiceErrorFactory,
      { sessionToolRegistryService: {} as unknown as SessionToolRegistryService },
    );
  }

  it("falls back to enabled tool permissions for graph-assistant sessions missing the enabled flag", async () => {
    const scope = createTestSessionWithScope(database.db, {
      id: "sess_ga_fallback",
      values: {
        kind: "temporary",
        purpose: "graph-assistant",
        metadataJson: JSON.stringify({ tool_permissions: { allow_irreversible: false } }),
      },
    });

    const permissions = await buildService().resolveToolPermissionsForSession(
      scope.sessionId,
      scope.accountId,
    );

    expect(permissions).toMatchObject({ enabled: true, allowIrreversible: false });
  });

  it("does not enable tools for non graph-assistant sessions missing the enabled flag", async () => {
    const scope = createTestSessionWithScope(database.db, {
      id: "sess_plain_fallback",
      values: {
        kind: "temporary",
        purpose: "utility",
        metadataJson: JSON.stringify({ tool_permissions: { allow_irreversible: false } }),
      },
   });

    const permissions =await buildService().resolveToolPermissionsForSession(
      scope.sessionId,
      scope.accountId,
    );

    expect(permissions).toBeUndefined();
  });

  it("respects an explicit enabled flag for graph-assistant sessions (fixed sessions)", async () => {
    const scope = createTestSessionWithScope(database.db, {
      id: "sess_ga_explicit",
      values: {
        kind: "temporary",
        purpose: "graph-assistant",
        metadataJson: JSON.stringify({ tool_permissions: { enabled: true, allow_irreversible: false } }),
      },
    });

    const permissions = await buildService().resolveToolPermissionsForSession(
      scope.sessionId,
      scope.accountId,
    );

    expect(permissions).toMatchObject({ enabled: true });
    // 确认会话确实写入了 enabled 字段（主修复路径）。
    const [stored] = await database.db
      .select({ metadataJson: sessions.metadataJson })
      .from(sessions)
      .where(eq(sessions.id, scope.sessionId))
      .limit(1);
    expect(JSON.parse(stored?.metadataJson ?? "{}").tool_permissions.enabled).toBe(true);
  });
});

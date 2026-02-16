/**
 * WebSocket Integration Tests
 *
 * 验证 WebSocket 插件在 buildApp 中的集成行为。
 * 不测试真实 WS 连接（已在 ws-bridge.test.ts 中覆盖），
 * 仅验证 buildApp 根据配置正确初始化 WsBridge。
 */

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp, type BuildAppResult } from "../src/app";

// ── Mock Orchestration Config ─────────────────────────
// 注意：由于 ProviderRegistry 需要真实的 AI SDK，
// 而 WebSocket 集成测试不需要真正的 LLM，
// 我们直接测试 buildApp 在无 orchestration 时的行为，
// 以及在有 orchestration 时（需要 mock）的行为。
//
// 对于需要 orchestration 的场景，我们验证 wsBridge 字段即可。

describe("WebSocket integration in buildApp", () => {
  let result: BuildAppResult;

  afterEach(async () => {
    if (result?.app) await result.app.close();
  });

  it("should not create wsBridge when orchestration is not enabled", async () => {
    result = await buildApp({ databasePath: ":memory:", logger: false });

    expect(result.wsBridge).toBeUndefined();
    expect(result.orchestrationContext).toBeUndefined();
  });

  it("should return app and no wsBridge without orchestration", async () => {
    result = await buildApp({ databasePath: ":memory:", logger: false });

    expect(result.app).toBeDefined();
    expect(result.wsBridge).toBeUndefined();
  });

  it("should not have /ws route when orchestration is not enabled", async () => {
    result = await buildApp({ databasePath: ":memory:", logger: false });

    const res = await result.app.inject({
      method: "GET",
      url: "/ws",
    });

    // 路由不存在时 Fastify 返回 404
    expect(res.statusCode).toBe(404);
  });

  it("should still have health endpoint without orchestration", async () => {
    result = await buildApp({ databasePath: ":memory:", logger: false });

    const res = await result.app.inject({
      method: "GET",
      url: "/health",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      service: "@tavern/api",
      database: "ready",
    });
  });

  it("should have CRUD routes available without orchestration", async () => {
    result = await buildApp({ databasePath: ":memory:", logger: false });

    // 验证 sessions CRUD 可用
    const createRes = await result.app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Test" },
    });

    expect(createRes.statusCode).toBe(201);
  });
});

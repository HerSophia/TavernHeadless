import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp, type BuildAppResult } from "../src/app";

type ItemResponse<T> = { data: T };

type MemoryDto = {
  id: string;
  scope: string;
  scope_id: string;
  type: string;
  content: { text: string };
  status: string;
  importance: number;
  confidence: number;
  created_at: number;
  updated_at: number;
};

/**
 * Workstream 1 / 2 / 3 batch 1: covers `POST /memories` going through the
 * canonical mutation ingress when `memoryStore` is wired into the routes.
 *
 * The contract we lock here:
 * - the response body is unchanged
 * - the canonical event `memory.created` is emitted with the persisted item
 * - the event payload carries enough scope context for downstream filtering
 */
describe("memory routes — canonical ingress (POST /memories)", () => {
  let result: BuildAppResult | undefined;
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    result = await buildApp({
      databasePath: ":memory:",
      logger: false,
      enableWebSocket: false,
      enableMemory: true,
      orchestration: {
        providers: [
          {
            id: "test-provider",
            type: "openai-compatible",
            apiKey: "sk-test",
          },
        ],
        defaultModel: {
          providerId: "test-provider",
          modelId: "gpt-4o-mini",
        },
      },
    });
    app = result.app;
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    result = undefined;
  });

  it("creates a memory item via MemoryStore and emits memory.created on the committed event plane", async () => {
    expect(result?.orchestrationContext?.memoryStore).toBeDefined();
    expect(result?.orchestrationContext?.eventBus).toBeDefined();

    const events: Array<{ name: string; payload: unknown }> = [];
    const unsubscribe = result!.orchestrationContext!.eventBus.on(
      "memory.created",
      (payload) => {
        events.push({ name: "memory.created", payload });
      },
    );

    try {
      const response = await app!.inject({
        method: "POST",
        url: "/memories",
        payload: {
          scope: "chat",
          scope_id: "sess_canonical_ingress_001",
          type: "fact",
          fact_key: "alpha",
          content: { text: "Alpha fact recorded via canonical ingress" },
          importance: 0.7,
          confidence: 0.9,
        },
      });

      expect(response.statusCode, response.body).toBe(201);
      const body = response.json<ItemResponse<MemoryDto>>();
      expect(body.data.scope).toBe("chat");
      expect(body.data.scope_id).toBe("sess_canonical_ingress_001");
      expect(body.data.type).toBe("fact");
      expect(body.data.content).toEqual({ text: "Alpha fact recorded via canonical ingress" });
      expect(body.data.status).toBe("active");
      expect(body.data.importance).toBeCloseTo(0.7);
      expect(body.data.confidence).toBeCloseTo(0.9);

      expect(events).toHaveLength(1);
      const evt = events[0]!.payload as {
        scope: string;
        scopeId: string;
        sessionId?: string;
        source: string;
        item: { id: string; content: string };
      };
      expect(evt.scope).toBe("chat");
      expect(evt.scopeId).toBe("sess_canonical_ingress_001");
      expect(evt.sessionId).toBe("sess_canonical_ingress_001");
      expect(evt.source).toBe("manual");
      expect(evt.item.id).toBe(body.data.id);
      expect(evt.item.content).toBe("Alpha fact recorded via canonical ingress");
    } finally {
      unsubscribe();
    }
  }, 15000);

  it("updates a memory item via MemoryStore and emits memory.updated with previousContent", async () => {
    expect(result?.orchestrationContext?.memoryStore).toBeDefined();

    // 先用 canonical ingress 建一条
    const createResp = await app!.inject({
      method: "POST",
      url: "/memories",
      payload: {
        scope: "chat",
        scope_id: "sess_canonical_update_001",
        type: "fact",
        fact_key: "beta",
        content: { text: "Original beta fact" },
        importance: 0.4,
        confidence: 0.8,
      },
    });
    expect(createResp.statusCode, createResp.body).toBe(201);
    const created = createResp.json<ItemResponse<MemoryDto>>().data;

    const events: Array<{ name: string; payload: unknown }> = [];
    const unsubscribeUpdated = result!.orchestrationContext!.eventBus.on(
      "memory.updated",
      (payload) => {
        events.push({ name: "memory.updated", payload });
      },
    );

    try {
      const patchResp = await app!.inject({
        method: "PATCH",
        url: `/memories/${created.id}`,
        payload: {
          content: { text: "Refined beta fact" },
          importance: 0.55,
        },
      });

      expect(patchResp.statusCode, patchResp.body).toBe(200);
      const updated = patchResp.json<ItemResponse<MemoryDto>>().data;
      expect(updated.id).toBe(created.id);
      expect(updated.content).toEqual({ text: "Refined beta fact" });
      expect(updated.importance).toBeCloseTo(0.55);
      expect(updated.confidence).toBeCloseTo(0.8);
      expect(updated.scope_id).toBe("sess_canonical_update_001");

      expect(events).toHaveLength(1);
      const evt = events[0]!.payload as {
        scope: string;
        scopeId: string;
        sessionId?: string;
        item: { id: string; content: string };
        previousContent?: string;
      };
      expect(evt.scope).toBe("chat");
      expect(evt.scopeId).toBe("sess_canonical_update_001");
      expect(evt.sessionId).toBe("sess_canonical_update_001");
      expect(evt.item.id).toBe(created.id);
      expect(evt.item.content).toBe("Refined beta fact");
      expect(evt.previousContent).toBe("Original beta fact");
    } finally {
      unsubscribeUpdated();
    }
  }, 15000);

  it("PATCH /memories/:id returns 404 when target does not exist", async () => {
    const resp = await app!.inject({
      method: "PATCH",
      url: "/memories/mem_does_not_exist",
      payload: { importance: 0.9 },
    });
    expect(resp.statusCode).toBe(404);
    expect(resp.json<{ error: { code: string } }>().error.code).toBe("not_found");
  }, 10000);
});

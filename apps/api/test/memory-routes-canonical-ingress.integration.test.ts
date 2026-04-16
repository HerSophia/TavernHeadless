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
});

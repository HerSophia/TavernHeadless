import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../src/db/client";
import {
  LlmInstanceService,
  LlmInstanceServiceError,
} from "../src/services/llm-instance-service";

describe("LlmInstanceService", () => {
  let connection: DatabaseConnection;
  let service: LlmInstanceService;
  const accountId = "default-admin";
  let clock: number;

  beforeEach(() => {
    connection = createDatabase(":memory:");
    clock = 1700000000000;
    service = new LlmInstanceService(connection.db, { now: () => clock });
  });

  afterEach(() => {
    connection.close();
  });

  // ── upsertConfig ──

  describe("upsertConfig", () => {
    it("creates a new global config", async () => {
      const config = await service.upsertConfig(accountId, "global", "global", "narrator", {
        enabled: true,
        params: { temperature: 0.8, maxOutputTokens: 1024 },
      });

      expect(config.id).toBeTruthy();
      expect(config.scope).toBe("global");
      expect(config.scopeId).toBe("global");
      expect(config.instanceSlot).toBe("narrator");
      expect(config.enabled).toBe(true);
      expect(config.params).toEqual({ temperature: 0.8, maxOutputTokens: 1024 });
      expect(config.createdAt).toBe(clock);
      expect(config.updatedAt).toBe(clock);
    });

    it("updates an existing config on conflict", async () => {
      await service.upsertConfig(accountId, "global", "global", "narrator", {
        enabled: true,
        params: { temperature: 0.5 },
      });

      clock += 1000;

      const updated = await service.upsertConfig(accountId, "global", "global", "narrator", {
        enabled: false,
        params: { temperature: 0.9 },
      });

      expect(updated.enabled).toBe(false);
      expect(updated.params).toEqual({ temperature: 0.9 });
      expect(updated.updatedAt).toBe(clock);

      const all = await service.listConfigs(accountId);
      expect(all).toHaveLength(1);
    });

    it("creates a session-scoped config", async () => {
      const config = await service.upsertConfig(accountId, "session", "sess-1", "director", {
        presetId: "preset-abc",
      });

      expect(config.scope).toBe("session");
      expect(config.scopeId).toBe("sess-1");
      expect(config.instanceSlot).toBe("director");
      expect(config.presetId).toBe("preset-abc");
    });

    it("accepts null params to clear existing params", async () => {
      await service.upsertConfig(accountId, "global", "global", "narrator", {
        params: { temperature: 0.5 },
      });

      clock += 1000;

      const updated = await service.upsertConfig(accountId, "global", "global", "narrator", {
        params: null,
      });

      expect(updated.params).toBeNull();
    });

    it("rejects params with out-of-range values", async () => {
      await expect(
        service.upsertConfig(accountId, "global", "global", "narrator", {
          params: { temperature: 5 },
        })
      ).rejects.toMatchObject({ code: "invalid_params" });
    });

    it("rejects non-object params", async () => {
      await expect(
        service.upsertConfig(accountId, "global", "global", "narrator", {
          params: "bad" as any,
        })
      ).rejects.toMatchObject({ code: "invalid_params" });
    });
  });

  // ── deleteConfig ──

  describe("deleteConfig", () => {
    it("deletes an existing config", async () => {
      await service.upsertConfig(accountId, "global", "global", "narrator", { enabled: true });

      await service.deleteConfig(accountId, "global", "global", "narrator");

      const all = await service.listConfigs(accountId);
      expect(all).toHaveLength(0);
    });

    it("throws config_not_found for non-existent config", async () => {
      await expect(
        service.deleteConfig(accountId, "global", "global", "narrator")
      ).rejects.toMatchObject({ code: "config_not_found" });
    });
  });

  // ── listConfigs ──

  describe("listConfigs", () => {
    it("returns all configs for an account", async () => {
      await service.upsertConfig(accountId, "global", "global", "narrator", { enabled: true });
      clock += 1;
      await service.upsertConfig(accountId, "global", "global", "*", { enabled: true });
      clock += 1;
      await service.upsertConfig(accountId, "session", "sess-1", "director", { enabled: false });

      const all = await service.listConfigs(accountId);
      expect(all).toHaveLength(3);
    });

    it("filters by scope", async () => {
      await service.upsertConfig(accountId, "global", "global", "narrator", { enabled: true });
      clock += 1;
      await service.upsertConfig(accountId, "session", "sess-1", "director", { enabled: false });

      const globalOnly = await service.listConfigs(accountId, "global");
      expect(globalOnly).toHaveLength(1);
      expect(globalOnly[0]!.instanceSlot).toBe("narrator");

      const sessionOnly = await service.listConfigs(accountId, "session", "sess-1");
      expect(sessionOnly).toHaveLength(1);
      expect(sessionOnly[0]!.instanceSlot).toBe("director");
    });

    it("returns empty array for account with no configs", async () => {
      const all = await service.listConfigs(accountId);
      expect(all).toEqual([]);
    });
  });

  // ── getConfigsBySlot ──

  describe("getConfigsBySlot", () => {
    it("returns configs matching a specific slot", async () => {
      await service.upsertConfig(accountId, "global", "global", "narrator", { enabled: true });
      clock += 1;
      await service.upsertConfig(accountId, "session", "sess-1", "narrator", { enabled: false });
      clock += 1;
      await service.upsertConfig(accountId, "global", "global", "director", { enabled: true });

      const configs = await service.getConfigsBySlot(accountId, "narrator");
      expect(configs).toHaveLength(2);
      expect(configs.every((c) => c.instanceSlot === "narrator")).toBe(true);
    });

    it("throws invalid_slot for unknown slot", async () => {
      await expect(
        service.getConfigsBySlot(accountId, "unknown" as any)
      ).rejects.toMatchObject({ code: "invalid_slot" });
    });
  });

  // ── resolveConfigs ──

  describe("resolveConfigs", () => {
    it("returns defaults for all 5 slots when no configs exist", async () => {
      const resolved = await service.resolveConfigs(accountId);

      expect(resolved).toHaveLength(5);
      const slotNames = resolved.map((s) => s.slot);
      expect(slotNames).toEqual(["*", "narrator", "director", "verifier", "memory"]);

      for (const slot of resolved) {
        expect(slot.source).toBe("default");
        expect(slot.scope).toBeNull();
        expect(slot.configId).toBeNull();
        expect(slot.enabled).toBe(true);
        expect(slot.params).toBeNull();
      }
    });

    it("resolves a global config for a named slot", async () => {
      await service.upsertConfig(accountId, "global", "global", "narrator", {
        enabled: true,
        params: { temperature: 0.7 },
      });

      const resolved = await service.resolveConfigs(accountId);
      const narrator = resolved.find((s) => s.slot === "narrator")!;

      expect(narrator.source).toBe("global_config");
      expect(narrator.scope).toBe("global");
      expect(narrator.enabled).toBe(true);
      expect(narrator.params).toEqual({ temperature: 0.7 });
      expect(narrator.configId).toBeTruthy();
    });

    it("session(slot) overrides global(slot)", async () => {
      await service.upsertConfig(accountId, "global", "global", "narrator", {
        params: { temperature: 0.5 },
      });
      clock += 1;
      await service.upsertConfig(accountId, "session", "sess-1", "narrator", {
        params: { temperature: 0.9 },
      });

      const resolved = await service.resolveConfigs(accountId, "sess-1");
      const narrator = resolved.find((s) => s.slot === "narrator")!;

      expect(narrator.source).toBe("session_config");
      expect(narrator.scope).toBe("session");
      expect(narrator.params).toEqual({ temperature: 0.9 });
    });

    it("falls back to global(*) when no specific slot config exists", async () => {
      await service.upsertConfig(accountId, "global", "global", "*", {
        params: { temperature: 0.6 },
        presetId: "fallback-preset",
      });

      const resolved = await service.resolveConfigs(accountId);
      const narrator = resolved.find((s) => s.slot === "narrator")!;

      expect(narrator.source).toBe("global_config");
      expect(narrator.params).toEqual({ temperature: 0.6 });
      expect(narrator.presetId).toBe("fallback-preset");

      const wildcard = resolved.find((s) => s.slot === "*")!;
      expect(wildcard.source).toBe("global_config");
    });

    it("session(*) overrides global(slot)", async () => {
      await service.upsertConfig(accountId, "global", "global", "narrator", {
        params: { temperature: 0.5 },
      });
      clock += 1;
      await service.upsertConfig(accountId, "session", "sess-1", "*", {
        params: { temperature: 0.99 },
      });

      const resolved = await service.resolveConfigs(accountId, "sess-1");
      const narrator = resolved.find((s) => s.slot === "narrator")!;

      // Priority: session(narrator) > session(*) > global(narrator) > global(*)
      // No session(narrator), but session(*) exists → wins over global(narrator)
      expect(narrator.source).toBe("session_config");
      expect(narrator.params).toEqual({ temperature: 0.99 });
    });

    it("without sessionId, skips all session candidates", async () => {
      await service.upsertConfig(accountId, "session", "sess-1", "narrator", {
        params: { temperature: 0.9 },
      });

      const resolved = await service.resolveConfigs(accountId);
      const narrator = resolved.find((s) => s.slot === "narrator")!;

      expect(narrator.source).toBe("default");
    });
  });
});

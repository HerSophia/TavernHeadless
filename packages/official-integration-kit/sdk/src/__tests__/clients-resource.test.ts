import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from"../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function sampleClient(overrides: Record<string, unknown> = {}) {
  return {
    id: "cli_test",
    account_id: "acc-1",
    name: "Sample Client",
    kind: "deriver",
    status: "active",
    is_default: false,
    metadata: { foo: "bar" },
    created_at: 1_700_000_000,
    updated_at: 1_700_000_001,
    ...overrides,
  };
}

function sampleApiKey(overrides: Record<string, unknown> = {}) {
  return {
    id: "cak_test",
    account_id: "acc-1",
    client_id: "cli_test",
    name: null,
    key_prefix: "tvk_live_abcdef12",
    status: "active",
    last_used_at: null,
    expires_at: null,
    created_at: 1_700_000_002,
    updated_at: 1_700_000_002,
    ...overrides,
  };
}

describe("sdk clients resource", () => {
  it("lists clients with snake_case query params", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      items: [sampleClient()],
      next_cursor: null,
    }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.clients.list({
      accountId: "acc-1",
      status:"active",
      kind: "deriver",
      limit: 10,
    });

    expect(result.items).toEqual([{
      id: "cli_test",
      accountId: "acc-1",
      name: "Sample Client",
      kind: "deriver",
      status: "active",
      isDefault: false,
    metadata: { foo: "bar" },
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_001,
    }]);
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/clients");
    expect(url.searchParams.get("status")).toBe("active");
    expect(url.searchParams.get("kind")).toBe("deriver");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("creates a client and returns the parsed record", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
    item: sampleClient(),
    }, 201));
    const client = createTavernClient({ baseUrl, fetchImpl });

    const record = await client.clients.create({
      name: "Sample Client",
      kind: "deriver",
      metadata: { foo: "bar" },
    });

    expect(record.id).toBe("cli_test");
    expect(record.kind).toBe("deriver");
    expect(record.metadata).toEqual({ foo: "bar" });
  });

  it("returns secret only on api key creation", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      item: sampleApiKey(),
      secret: "tvk_live_abcdef12_secret",
    }, 201));
    const client = createTavernClient({ baseUrl, fetchImpl });

    const created = await client.clients.apiKeys.create("cli_test", { name: "Test" });

    expect(created.secret).toBe("tvk_live_abcdef12_secret");
    expect(created.apiKey.keyPrefix).toBe("tvk_live_abcdef12");
  });

  it("lists api keys without exposing secret", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      items: [sampleApiKey()],
      next_cursor: null,
    }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.clients.apiKeys.list("cli_test");

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty("secret");
  });
});

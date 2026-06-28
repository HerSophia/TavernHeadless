import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getActiveAuthHeaders, getActiveBaseUrl, getActiveConnection } from "../lib/backend/active";
import { useBackendConnectionStore } from "./backend-connection";

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("backend-connection store", () => {
  it("seeds a default connection and drives the active connection", () => {
    const store = useBackendConnectionStore();
    expect(store.connections).toHaveLength(1);
    expect(store.currentId).toBe("default");
    expect(store.current?.id).toBe("default");
    expect(getActiveConnection().id).toBe("default");
    expect(getActiveBaseUrl()).toBe("http://localhost:3000");
  });

  it("upserts a new connection (normalizing baseUrl) without auto-switching", () => {
    const store = useBackendConnectionStore();
    const created = store.upsert({
      name: "Prod",
      baseUrl: "https://api.example.com/",
      authMode: "api_key",
      credential: "secret",
      persistCredential: true,
    });
    expect(created.id).toBeTruthy();
    expect(created.baseUrl).toBe("https://api.example.com");
    expect(store.connections).toHaveLength(2);
    expect(store.currentId).toBe("default");
  });

  it("switches current connection and updates active baseUrl + auth headers", () => {
    const store = useBackendConnectionStore();
    const created = store.upsert({
      name: "Prod",
      baseUrl: "https://api.example.com",
      authMode: "api_key",
      credential: "secret",
      persistCredential: true,
    });
    store.setCurrent(created.id);
    expect(store.current?.id).toBe(created.id);
    expect(getActiveBaseUrl()).toBe("https://api.example.com");
    expect(getActiveAuthHeaders()).toEqual({ "x-api-key": "secret" });
  });

  it("merges fields when upserting an existing connection (and re-applies active if current)", () => {
    const store = useBackendConnectionStore();
    const created = store.upsert({ name: "A", baseUrl: "https://a.example.com", authMode: "dev" });
    store.setCurrent(created.id);
    const merged = store.upsert({
      id: created.id,
      name: "A2",
      baseUrl: "https://a2.example.com",
      authMode: "dev",
    });
    expect(merged.id).toBe(created.id);
    expect(merged.name).toBe("A2");
    expect(getActiveBaseUrl()).toBe("https://a2.example.com");
  });

  it("removes the current connection and falls back to the first remaining", () => {
    const store = useBackendConnectionStore();
    const created = store.upsert({ name: "Prod", baseUrl: "https://api.example.com", authMode: "dev" });
    store.setCurrent(created.id);
    store.remove(created.id);
    expect(store.connections.some((conn) => conn.id === created.id)).toBe(false);
    expect(store.currentId).toBe("default");
    expect(getActiveBaseUrl()).toBe("http://localhost:3000");
  });

  it("removes a non-current connection without changing the active one", () => {
    const store = useBackendConnectionStore();
    const created = store.upsert({ name: "Prod", baseUrl: "https://api.example.com", authMode: "dev" });
    store.remove(created.id);
    expect(store.connections).toHaveLength(1);
    expect(store.currentId).toBe("default");
  });

  it("persists connections and restores them on re-init (keeping persistable credentials)", () => {
    const store = useBackendConnectionStore();
    const created = store.upsert({
      name: "Prod",
      baseUrl: "https://api.example.com",
      authMode: "client_api_key",
      credential: "tvk_live_abc",
      persistCredential: true,
    });
    store.setCurrent(created.id);

    setActivePinia(createPinia());
    const restored = useBackendConnectionStore();
    expect(restored.connections.some((conn) => conn.name === "Prod")).toBe(true);
    expect(restored.current?.name).toBe("Prod");
    expect(restored.current?.credential).toBe("tvk_live_abc");
  });

  it("drops non-persistable credentials when persisting", () => {
    const store = useBackendConnectionStore();
    const created = store.upsert({
      name: "Ephemeral",
      baseUrl: "https://eph.example.com",
      authMode: "api_key",
      credential: "secret",
      persistCredential: false,
    });
    store.setCurrent(created.id);

    setActivePinia(createPinia());
    const restored = useBackendConnectionStore();
    const found = restored.connections.find((conn) => conn.name === "Ephemeral");
    expect(found).toBeTruthy();
    expect(found?.credential ?? null).toBeNull();
  });

  it("ignores setCurrent / remove for unknown ids", () => {
    const store = useBackendConnectionStore();
    store.setCurrent("nope");
    expect(store.currentId).toBe("default");
    store.remove("nope");
    expect(store.connections).toHaveLength(1);
  });

  it("works without localStorage (node-like env): seeds default and operates in-memory", () => {
    vi.stubGlobal("localStorage", undefined);
    setActivePinia(createPinia());
    const store = useBackendConnectionStore();
    expect(store.currentId).toBe("default");
    const created = store.upsert({ name: "Mem", baseUrl: "https://mem.example.com", authMode: "dev" });
    store.setCurrent(created.id);
    expect(getActiveBaseUrl()).toBe("https://mem.example.com");
  });
});

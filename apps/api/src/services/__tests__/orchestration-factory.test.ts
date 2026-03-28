import { describe, it, expect } from "vitest";

import {
  createOrchestrationContext,
  type OrchestrationConfig,
} from "../orchestration-factory.js";
import type {
  FloorRepository,
  MemoryRepository,
  ProviderConfig,
  VariableRepository,
  VariableRepositoryOptions,
} from "@tavern/core";
import type { VariableEntry, VariableScope } from "@tavern/shared";

const mockFloorRepo = {} as FloorRepository;
const mockMemoryRepo = {} as MemoryRepository;

class InMemoryVariableRepository implements VariableRepository {
  private store: Array<VariableEntry & { accountId?: string }> = [];
  private nextId = 1;

  private toEntry(row: VariableEntry & { accountId?: string }): VariableEntry {
    return {
      id: row.id,
      scope: row.scope,
      scopeId: row.scopeId,
      key: row.key,
      value: row.value,
      updatedAt: row.updatedAt,
    };
  }

  private matchesAccount(
    row: VariableEntry & { accountId?: string },
    options?: VariableRepositoryOptions,
  ): boolean {
    return row.accountId === options?.accountId;
  }

  async findByKey(
    scope: VariableScope,
    scopeId: string,
    key: string,
    options?: VariableRepositoryOptions,
  ): Promise<VariableEntry | null> {
    const row = this.store.find(
      (entry) =>
        entry.scope === scope &&
        entry.scopeId === scopeId &&
        entry.key === key &&
        this.matchesAccount(entry, options),
    );

    return row ? this.toEntry(row) : null;
  }

  async findAllByScope(
    scope: VariableScope,
    scopeId: string,
    options?: VariableRepositoryOptions,
  ): Promise<VariableEntry[]> {
    return this.store
      .filter(
        (entry) =>
          entry.scope === scope &&
          entry.scopeId === scopeId &&
          this.matchesAccount(entry, options),
      )
      .map((entry) => this.toEntry(entry));
  }

  async upsert(
    scope: VariableScope,
    scopeId: string,
    key: string,
    value: unknown,
    options?: VariableRepositoryOptions,
  ): Promise<VariableEntry> {
    const existing = this.store.find(
      (entry) =>
        entry.scope === scope &&
        entry.scopeId === scopeId &&
        entry.key === key &&
        this.matchesAccount(entry, options),
    );

    if (existing) {
      existing.value = value;
      existing.updatedAt = Date.now();
      return this.toEntry(existing);
    }

    const row: VariableEntry & { accountId?: string } = {
      id: `var-${this.nextId++}`,
      scope,
      scopeId,
      key,
      value,
      updatedAt: Date.now(),
      accountId: options?.accountId,
    };
    this.store.push(row);
    return this.toEntry(row);
  }

  async deleteById(id: string, options?: VariableRepositoryOptions): Promise<boolean> {
    const idx = this.store.findIndex(
      (entry) => entry.id === id && this.matchesAccount(entry, options),
    );
    if (idx === -1) return false;
    this.store.splice(idx, 1);
    return true;
  }

  async deleteByKey(
    scope: VariableScope,
    scopeId: string,
    key: string,
    options?: VariableRepositoryOptions,
  ): Promise<boolean> {
    const idx = this.store.findIndex(
      (entry) =>
        entry.scope === scope &&
        entry.scopeId === scopeId &&
        entry.key === key &&
        this.matchesAccount(entry, options),
    );
    if (idx === -1) return false;
    this.store.splice(idx, 1);
    return true;
  }
}

function makeProvider(id = "test-provider"): ProviderConfig {
  return {
    id,
    type: "openai-compatible",
    apiKey: "sk-test",
  };
}

function makeConfig(overrides: Partial<OrchestrationConfig> = {}): OrchestrationConfig {
  return {
    providers: [makeProvider()],
    defaultModel: { providerId: "test-provider", modelId: "gpt-4o-mini" },
    ...overrides,
  };
}

describe("createOrchestrationContext", () => {
  it("creates context with all required fields", () => {
    const ctx = createOrchestrationContext(
      makeConfig(),
      mockFloorRepo,
      mockMemoryRepo,
      new InMemoryVariableRepository(),
    );

    expect(ctx.orchestrator).toBeDefined();
    expect(ctx.eventBus).toBeDefined();
    expect(ctx.providerRegistry).toBeDefined();
    expect(ctx.tokenCounter).toBeDefined();
    expect(ctx.memoryStore).toBeDefined();
    expect(ctx.variableResolver).toBeDefined();
    expect(ctx.variableStore).toBeDefined();
  });

  it("registers multiple providers", () => {
    const config = makeConfig({
      providers: [makeProvider("p1"), makeProvider("p2")],
      defaultModel: { providerId: "p1", modelId: "m1" },
    });

    const ctx = createOrchestrationContext(
      config,
      mockFloorRepo,
      mockMemoryRepo,
      new InMemoryVariableRepository(),
    );

    expect(ctx.providerRegistry).toBeDefined();
  });

  it("works without optional model overrides", () => {
    const config = makeConfig();

    const ctx = createOrchestrationContext(
      config,
      mockFloorRepo,
      mockMemoryRepo,
      new InMemoryVariableRepository(),
    );
    expect(ctx.orchestrator).toBeDefined();
  });

  it("accepts all optional model overrides", () => {
    const config = makeConfig({
      directorModel: { providerId: "test-provider", modelId: "director" },
      verifierModel: { providerId: "test-provider", modelId: "verifier" },
      memoryModel: { providerId: "test-provider", modelId: "memory" },
    });

    const ctx = createOrchestrationContext(
      config,
      mockFloorRepo,
      mockMemoryRepo,
      new InMemoryVariableRepository(),
    );
    expect(ctx.orchestrator).toBeDefined();
  });

  it("wires variableResolver and variableStore to the same repository", async () => {
    const variableRepo = new InMemoryVariableRepository();
    const ctx = createOrchestrationContext(
      makeConfig(),
      mockFloorRepo,
      mockMemoryRepo,
      variableRepo,
    );

    await ctx.variableStore.set("mood", "happy", {
      pageId: "page-1",
      floorId: "floor-1",
      sessionId: "session-1",
      accountId: "account-1",
    });

    await expect(
      ctx.variableResolver.resolve("mood", {
        pageId: "page-1",
        sessionId: "session-1",
        accountId: "account-1",
      }),
    ).resolves.toMatchObject({
      key: "mood",
      value: "happy",
      scope: "page",
    });
  });
});

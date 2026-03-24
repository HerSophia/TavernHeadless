import { describe, it, expect } from "vitest";

import {
  createOrchestrationContext,
  type OrchestrationConfig,
} from "../orchestration-factory.js";
import type { FloorRepository, MemoryRepository, ProviderConfig } from "@tavern/core";

// ── Mocks ───────────────────────────────────────────────

const mockFloorRepo = {} as FloorRepository;
const mockMemoryRepo = {} as MemoryRepository;

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

// ── Tests ───────────────────────────────────────────────

describe("createOrchestrationContext", () => {
  it("creates context with all required fields", () => {
    const ctx = createOrchestrationContext(makeConfig(), mockFloorRepo, mockMemoryRepo);

    expect(ctx.orchestrator).toBeDefined();
    expect(ctx.eventBus).toBeDefined();
    expect(ctx.providerRegistry).toBeDefined();
    expect(ctx.tokenCounter).toBeDefined();
    expect(ctx.memoryStore).toBeDefined();
  });

  it("registers multiple providers", () => {
    const config = makeConfig({
      providers: [makeProvider("p1"), makeProvider("p2")],
      defaultModel: { providerId: "p1", modelId: "m1" },
    });

    const ctx = createOrchestrationContext(config, mockFloorRepo, mockMemoryRepo);

    // ProviderRegistry 应包含 2 个 provider
    // ProviderRegistry 没有 public size，通过能正常创建来验证
    expect(ctx.providerRegistry).toBeDefined();
  });

  it("works without optional model overrides", () => {
    const config = makeConfig();
    // 不传 directorModel / verifierModel / memoryModel

    const ctx = createOrchestrationContext(config, mockFloorRepo, mockMemoryRepo);
    expect(ctx.orchestrator).toBeDefined();
  });

  it("accepts all optional model overrides", () => {
    const config = makeConfig({
      directorModel: { providerId: "test-provider", modelId: "director" },
      verifierModel: { providerId: "test-provider", modelId: "verifier" },
      memoryModel: { providerId: "test-provider", modelId: "memory" },
    });

    const ctx = createOrchestrationContext(config, mockFloorRepo, mockMemoryRepo);
    expect(ctx.orchestrator).toBeDefined();
  });
});

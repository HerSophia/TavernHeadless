import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wiringState = vi.hoisted(() => ({
  builtinProviderDeps: [] as Array<Record<string, unknown> | undefined>,
}));

vi.mock("@tavern/core", async () => {
  const actual = await vi.importActual<typeof import("@tavern/core")>("@tavern/core");

  class BuiltinToolProviderWithSpy extends actual.BuiltinToolProvider {
    constructor(deps: Record<string, unknown> = {}) {
      wiringState.builtinProviderDeps.push(deps);
      super(deps as any);
    }
  }

  return {
    ...actual,
    BuiltinToolProvider: BuiltinToolProviderWithSpy,
  };
});

describe("buildApp orchestration variable wiring", () => {
  let app: { close: () => Promise<void> } | undefined;

  beforeEach(() => {
    wiringState.builtinProviderDeps.length = 0;
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("does not inject variableStore when orchestration is disabled", async () => {
    const { buildApp } = await import("../src/app");
    const result = await buildApp({
      databasePath: ":memory:",
      logger: false,
    });
    app = result.app;

    expect(wiringState.builtinProviderDeps.length).toBeGreaterThanOrEqual(1);
    expect(
      wiringState.builtinProviderDeps.some((deps) => deps?.variableStore !== undefined),
    ).toBe(false);
  });

  it("injects variableStore into runtime BuiltinToolProvider when orchestration is enabled", async () => {
    const { buildApp } = await import("../src/app");
    const result = await buildApp({
      databasePath: ":memory:",
      logger: false,
      enableWebSocket: false,
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

    expect(result.orchestrationContext).toBeDefined();
    expect(result.orchestrationContext?.variableResolver).toBeDefined();
    expect(result.orchestrationContext?.variableStore).toBeDefined();

    const runtimeDeps = wiringState.builtinProviderDeps.find(
      (deps) => deps?.variableStore === result.orchestrationContext?.variableStore,
    );

    expect(runtimeDeps).toBeDefined();
    expect(runtimeDeps?.memoryStore).toBeUndefined();
  });
});

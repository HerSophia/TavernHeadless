import { describe, expect, it } from "vitest";

import { ChatServiceError } from "../../chat/errors.js";
import { TurnModelService } from "../../chat/turn-model-service.js";

describe("TurnModelService", () => {
  it("assertNarratorSlotEnabled throws when narrator slot is disabled", () => {
    const service = new TurnModelService({
      enableMemoryConsolidationByDefault: false,
      enableAsyncMemoryIngest: false,
      memoryStoreEnabled: false,
      executionTimeoutMs: 60_000,
    });

    expect(() => service.assertNarratorSlotEnabled({ narrator: { enabled: false, source: "env" } })).toThrow(ChatServiceError);
  });

  it("buildGenerationParams merges request params and default timeout", () => {
    const service = new TurnModelService({
      enableMemoryConsolidationByDefault: false,
      enableAsyncMemoryIngest: false,
      memoryStoreEnabled: false,
      executionTimeoutMs: 60_000,
    });

    const params = service.buildGenerationParams({
      narratorParams: { temperature: 0.3, timeoutMs: 30_000 },
      requestParams: { topP: 0.8 },
      availableForReply: 256,
      stream: true,
    });

    expect(params).toMatchObject({
      temperature: 0.3,
      topP: 0.8,
      maxOutputTokens: 256,
      timeoutMs: 30_000,
      stream: true,
    });
  });

  it("resolveRequestedTurnConfig disables slots that are not available", () => {
    const service = new TurnModelService({
      enableMemoryConsolidationByDefault: true,
      enableAsyncMemoryIngest: false,
      memoryStoreEnabled: true,
      executionTimeoutMs: 60_000,
    });

    const config = service.resolveRequestedTurnConfig(
      {
        enableDirector: true,
        enableVerifier: true,
        enableMemoryConsolidation: true,
      },
      {
        director: { enabled: false, source: "env" },
        verifier: { enabled: false, source: "env" },
        memory: { enabled: false, source: "env" },
      },
    );

    expect(config).toMatchObject({
      enableDirector: false,
      enableVerifier: false,
      enableMemoryConsolidation: false,
    });
  });
});

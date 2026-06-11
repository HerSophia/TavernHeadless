import { describe, expect, it } from "vitest";

import type { LlmInstanceCapabilities } from "../../../lib/llm-capabilities.js";
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

  it("buildGenerationParams does not fill defaults when upper layers explicitly cancel them", () => {
    const service = new TurnModelService({
      enableMemoryConsolidationByDefault: false,
      enableAsyncMemoryIngest: false,
      memoryStoreEnabled: false,
      executionTimeoutMs: 60_000,
    });

    const params = service.buildGenerationParams({
      narratorParams: {
        temperature: null,
        maxOutputTokens: null,
        timeoutMs: null,
        maxRetries: null,
      },
      availableForReply: 256,
    });

    expect(params.temperature).toBeUndefined();
    expect(params.maxOutputTokens).toBeUndefined();
    expect(params.timeoutMs).toBeUndefined();
    expect(params.maxRetries).toBeUndefined();
  });

  it("buildGenerationParams lets request cancellations override narrator values", () => {
    const service = new TurnModelService({
      enableMemoryConsolidationByDefault: false,
      enableAsyncMemoryIngest: false,
      memoryStoreEnabled: false,
      executionTimeoutMs: 60_000,
    });

    const params = service.buildGenerationParams({
      narratorParams: {
        temperature: 0.4,
        maxOutputTokens: 400,
        topP: 0.9,
        timeoutMs: 30_000,
      },
      requestParams: {
        temperature: null,
        maxOutputTokens: null,
        topP: null,
        timeoutMs: null,
      },
      availableForReply: 256,
    });

    expect(params.temperature).toBeUndefined();
    expect(params.maxOutputTokens).toBeUndefined();
    expect(params.topP).toBeUndefined();
    expect(params.timeoutMs).toBeUndefined();
  });

  it("buildGenerationParams merges new fields and filters unsupported params by capabilities", () => {
    const service = new TurnModelService({
      enableMemoryConsolidationByDefault: false,
      enableAsyncMemoryIngest: false,
      memoryStoreEnabled: false,
      executionTimeoutMs: 60_000,
    });

    const capabilities: LlmInstanceCapabilities = {
      supportsFunctionCall: true,
      supportsToolChoice: false,
      supportsStreamingToolCall: false,
      unsupportedGenerationParams: ["responseFormat"],
    };

    const result = service.buildGenerationParamsResult({
      narratorParams: {
        seed: 7,
        repetitionPenalty: 1.1,
        minP: 0.05,
        logitBias: { "42": -5 },
        responseFormat: { type: "json_schema", jsonSchema: { type: "object" } },
      },
      narratorParamOrigins: {
        seed: "profile",
        repetitionPenalty: "profile",
        minP: "profile",
        logitBias: "profile",
        responseFormat: "instance",
      },
      requestParams: {
        seed: 9,
      },
      capabilities,
      availableForReply: 256,
    });

    expect(result.params).toMatchObject({
      seed: 9,
      repetitionPenalty: 1.1,
      minP: 0.05,
      logitBias: { "42": -5 },
    });
    expect(result.params).not.toHaveProperty("responseFormat");
    expect(result.resolution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "seed", finalState: "sent", origin: "request", valueFrom: "request" }),
        expect.objectContaining({ name: "repetitionPenalty", finalState: "sent", origin: "profile", valueFrom: "profile" }),
        expect.objectContaining({ name: "minP", finalState: "sent", origin: "profile", valueFrom: "profile" }),
        expect.objectContaining({ name: "logitBias", finalState: "sent", origin: "profile", valueFrom: "profile" }),
        expect.objectContaining({
          name: "responseFormat",
          finalState: "filtered",
          origin: "instance",
          filterReason: "field_not_supported_by_provider",
        }),
      ]),
    );
  });

  it("buildGenerationParams lets request null cancel new fields", () => {
    const service = new TurnModelService({
      enableMemoryConsolidationByDefault: false,
      enableAsyncMemoryIngest: false,
      memoryStoreEnabled: false,
      executionTimeoutMs: 60_000,
    });

    const params = service.buildGenerationParams({
      narratorParams: {
        seed: 7,
        repetitionPenalty: 1.1,
        minP: 0.05,
      },
      requestParams: {
        seed: null,
        repetitionPenalty: null,
        minP: null,
      },
      availableForReply: 256,
    });

    expect(params.seed).toBeUndefined();
    expect(params.repetitionPenalty).toBeUndefined();
    expect(params.minP).toBeUndefined();
  });

  it("buildGenerationParamsOverrides preserves new fields for non-narrator slots", () => {
    const service = new TurnModelService({
      enableMemoryConsolidationByDefault: false,
      enableAsyncMemoryIngest: false,
      memoryStoreEnabled: false,
      executionTimeoutMs: 60_000,
    });

    const overrides = service.buildGenerationParamsOverrides({
      narrator: {
        enabled: true,
        source: "env",
        generationParams: { temperature: 0.7 },
      },
      director: {
        enabled: true,
        source: "env",
        generationParams: {
          seed: 42,
          repetitionPenalty: 1.1,
          minP: 0.05,
          logitBias: { "42": -5 },
          responseFormat: { type: "json_object" },
        },
      },
    });

    expect(overrides?.director).toEqual({
      seed: 42,
      repetitionPenalty: 1.1,
      minP: 0.05,
      logitBias: { "42": -5 },
      responseFormat: { type: "json_object" },
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

  it("resolveRequestedTurnConfig clears memory consolidation when memory store is unavailable", () => {
    const service = new TurnModelService({
      enableMemoryConsolidationByDefault: true,
      enableAsyncMemoryIngest: false,
      memoryStoreEnabled: false,
      executionTimeoutMs: 60_000,
    });

    const config = service.resolveRequestedTurnConfig(
      {
        enableDirector: true,
        enableVerifier: true,
        enableMemoryConsolidation: true,
      },
      {},
    );

    expect(config).toMatchObject({
      enableDirector: true,
      enableVerifier: true,
      enableMemoryConsolidation: false,
    });
  });

  it("toOrchestratorTurnConfig keeps write intent in async mode but disables legacy consolidator execution", () => {
    const service = new TurnModelService({
      enableMemoryConsolidationByDefault: true,
      enableAsyncMemoryIngest: true,
      memoryStoreEnabled: true,
      executionTimeoutMs: 60_000,
    });

    expect(service.resolveMemoryWritePolicy({ enableMemoryConsolidation: true })).toEqual({
      runtimeMode: "async_primary",
      requestedWrite: true,
      effectiveWrite: true,
    });
    expect(service.toOrchestratorTurnConfig({ enableMemoryConsolidation: true })).toEqual({
      enableMemoryConsolidation: false,
    });
  });

  it("resolveRequestedTurnConfig keeps requested write intent available while async orchestrator execution is gated off", () => {
    const service = new TurnModelService({
      enableMemoryConsolidationByDefault: true,
      enableAsyncMemoryIngest: true,
      memoryStoreEnabled: true,
      executionTimeoutMs: 60_000,
    });

    const config = service.resolveRequestedTurnConfig(undefined, {});
    expect(config).toEqual({ enableMemoryConsolidation: true });
    expect(service.resolveMemoryWritePolicy(config)).toEqual({
      runtimeMode: "async_primary",
      requestedWrite: true,
      effectiveWrite: true,
    });
  });
});

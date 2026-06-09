import type {
  FloorRunType,
  GenerationParams,
  InstanceSlot,
  ModelConfig,
  PromptRuntimeGenerationParamResolution,
  ProviderType,
  TurnConfig,
} from "@tavern/core";
import type {
  AssistantPrefillExecutionStrategy,
  PromptMacroRunKind,
  SessionPromptInfo,
} from "../prompt-assembler.js";

import { resolveAssistantPrefillStrategy } from "../../lib/llm-provider-discovery.js";
import type { GenerationParamKey, GenerationParamsInput } from "../../lib/llm-params.js";
import { normalizeNonNegativeInt, normalizePositiveInt } from "../../lib/utils.js";

import type {
  OnTurnModelUsedFn,
  ResolvedTurnModel,
  ResolvedTurnModels,
  ResolveTurnModelFn,
  ResolveTurnModelsFn,
} from "./contracts.js";
import type { FirstPartyStateContext } from "./types.js";
import { ChatServiceError } from "./errors.js";
import type { SessionBranchAssetBindingState } from "../variables/host/session-branch-registry-service.js";
import { mergeSessionMetadataWithFirstPartyState } from "./shared/metadata.js";
import { resolveMemoryWritePolicy as resolveMemoryWritePolicyFromRuntimeMode } from "../memory/shared/index.js";

export class TurnModelService {
  constructor(private readonly options: {
    resolveTurnModel?: ResolveTurnModelFn;
    resolveTurnModels?: ResolveTurnModelsFn;
    onTurnModelUsed?: OnTurnModelUsedFn;
    defaultNarratorProviderType?: ProviderType;
    enableMemoryConsolidationByDefault: boolean;
    enableAsyncMemoryIngest: boolean;
    memoryStoreEnabled: boolean;
    executionTimeoutMs: number;
  }) {}

  async resolveTurnModelForSession(sessionId: string, accountId: string): Promise<ResolvedTurnModel | undefined> {
    if (!this.options.resolveTurnModel && !this.options.resolveTurnModels) {
      return undefined;
    }

    if (this.options.resolveTurnModels) {
      const models = await this.options.resolveTurnModels(sessionId, accountId);
      return models.narrator?.model ? models.narrator : undefined;
    }

    return (await this.options.resolveTurnModel!(sessionId, accountId)) ?? undefined;
  }

  async resolveTurnModelsForSession(sessionId: string, accountId: string): Promise<ResolvedTurnModels> {
    if (this.options.resolveTurnModels) {
      return this.options.resolveTurnModels(sessionId, accountId);
    }

    if (this.options.resolveTurnModel) {
      const resolved = await this.options.resolveTurnModel(sessionId, accountId);
      if (resolved) {
        return { narrator: resolved };
      }
    }

    return {};
  }

  buildSessionPromptInfo(
    session: {
      presetId: string | null;
      worldbookProfileId: string | null;
      regexProfileId: string | null;
      deepBinding?: boolean;
      presetVersionId?: string | null;
      worldbookVersionId?: string | null;
      regexProfileVersionId?: string | null;
      metadataJson: string | null;
      characterSnapshotJson: string | null;
      characterId?: string | null;
      characterVersionId?: string | null;
      promptMode: SessionPromptInfo["promptMode"];
      userSnapshotJson: string | null;
    },
    resolvedTurnModels: ResolvedTurnModels,
    firstPartyStateContext?: FirstPartyStateContext,
    branchAssetBinding?: SessionBranchAssetBindingState | null,
  ): SessionPromptInfo {
    const binding = branchAssetBinding ?? null;
    const bindingPresetId = binding ? binding.presetId : session.presetId;
    const bindingWorldbookProfileId = binding ? binding.worldbookProfileId : session.worldbookProfileId;
    const bindingRegexProfileId = binding ? binding.regexProfileId : session.regexProfileId;
    const bindingDeepBinding = binding ? binding.deepBinding : session.deepBinding ?? false;
    const resolvedPresetId = resolvedTurnModels.narrator?.presetId ?? bindingPresetId;
    const presetVersionId = resolvedPresetId === bindingPresetId
      ? binding
        ? binding.presetVersionId
        : session.presetVersionId ?? null
      : null;

    return {
      presetId: resolvedPresetId,
      worldbookProfileId: bindingWorldbookProfileId,
      regexProfileId: bindingRegexProfileId,
      deepBinding: bindingDeepBinding,
      presetVersionId,
      worldbookVersionId: binding ? binding.worldbookVersionId : session.worldbookVersionId ?? null,
      regexProfileVersionId: binding ? binding.regexProfileVersionId : session.regexProfileVersionId ?? null,
      metadataJson: mergeSessionMetadataWithFirstPartyState(session.metadataJson, firstPartyStateContext),
      characterSnapshotJson: session.characterSnapshotJson,
      characterId: session.characterId ?? null,
      characterVersionId: session.characterVersionId ?? null,
      promptMode: session.promptMode,
      userSnapshotJson: session.userSnapshotJson,
    };
  }

  assertNarratorSlotEnabled(models: ResolvedTurnModels): void {
    if (this.isSlotDisabled(models, "narrator")) {
      throw new ChatServiceError(
        "instance_slot_disabled_required",
        "LLM instance slot 'narrator' is disabled for this session",
      );
    }
  }

  buildGenerationParams(args: {
    requestParams?: GenerationParamsInput;
    narratorParams?: GenerationParamsInput;
    availableForReply: number;
    stream?: boolean;
  }): GenerationParams {
    return this.buildGenerationParamsResult(args).params;
  }

  buildGenerationParamsResolution(args: {
    requestParams?: GenerationParamsInput;
    narratorParams?: GenerationParamsInput;
    narratorParamOrigins?: Partial<Record<GenerationParamKey, "profile" | "instance">>;
    availableForReply: number;
    stream?: boolean;
  }): PromptRuntimeGenerationParamResolution[] {
    return this.buildGenerationParamsResult(args).resolution;
  }

  buildGenerationParamsResult(args: {
    requestParams?: GenerationParamsInput;
    narratorParams?: GenerationParamsInput;
    narratorParamOrigins?: Partial<Record<GenerationParamKey, "profile" | "instance">>;
    availableForReply: number;
    stream?: boolean;
  }): { params: GenerationParams; resolution: PromptRuntimeGenerationParamResolution[] } {
    const narratorParams = this.stripMaxContextTokens(args.narratorParams);
    const requestParams = this.stripMaxContextTokens(args.requestParams);
    const params: GenerationParams = {};
    const resolution: PromptRuntimeGenerationParamResolution[] = [];

    const temperature = this.resolveGenerationParam(requestParams, narratorParams, "temperature");
    if (temperature === undefined) {
      params.temperature = 0.7;
      resolution.push({
        name: "temperature",
        finalState: "sent",
        origin: "default",
        valueFrom: "default",
      });
    } else if (temperature === null) {
      const origin = this.resolveParamOrigin(args.narratorParamOrigins, requestParams, "temperature");
      resolution.push({
        name: "temperature",
        finalState: "cancelled",
        origin,
        cancelledAt: origin === "request" ? "request" : origin,
      });
    } else {
      params.temperature = temperature;
      const origin = this.resolveParamOrigin(args.narratorParamOrigins, requestParams, "temperature");
      resolution.push({
        name: "temperature",
        finalState: "sent",
        origin,
        valueFrom: origin,
      });
    }

    const maxOutputTokensValue = this.resolveGenerationParam(requestParams, narratorParams, "maxOutputTokens");
    if (maxOutputTokensValue === undefined) {
      params.maxOutputTokens = args.availableForReply || 1000;
      resolution.push({
        name: "maxOutputTokens",
        finalState: "sent",
        origin: "default",
        valueFrom: "default",
      });
    } else if (maxOutputTokensValue === null) {
      const origin = this.resolveParamOrigin(args.narratorParamOrigins, requestParams, "maxOutputTokens");
      resolution.push({
        name: "maxOutputTokens",
        finalState: "cancelled",
        origin,
        cancelledAt: origin === "request" ? "request" : origin,
      });
    } else {
      const maxOutputTokens = normalizePositiveInt(maxOutputTokensValue);
      if (maxOutputTokens !== undefined) {
        params.maxOutputTokens = maxOutputTokens;
      }
      const origin = this.resolveParamOrigin(args.narratorParamOrigins, requestParams, "maxOutputTokens");
      resolution.push({
        name: "maxOutputTokens",
        finalState: "sent",
        origin,
        valueFrom: origin,
      });
    }

    this.applyOptionalParam(
      params,
      resolution,
      requestParams,
      narratorParams,
      args.narratorParamOrigins,
      "topP",
    );
    this.applyOptionalParam(
      params,
      resolution,
      requestParams,
      narratorParams,
      args.narratorParamOrigins,
      "topK",
    );
    this.applyOptionalParam(
      params,
      resolution,
      requestParams,
      narratorParams,
      args.narratorParamOrigins,
      "frequencyPenalty",
    );
    this.applyOptionalParam(
      params,
      resolution,
      requestParams,
      narratorParams,
      args.narratorParamOrigins,
      "presencePenalty",
    );
    this.applyOptionalParam(
      params,
      resolution,
      requestParams,
      narratorParams,
      args.narratorParamOrigins,
      "stopSequences",
    );
    this.applyOptionalParam(
      params,
      resolution,
      requestParams,
      narratorParams,
      args.narratorParamOrigins,
      "reasoningEffort",
    );

    if (args.stream !== undefined) {
      params.stream = args.stream;
      resolution.push({
        name: "stream",
        finalState: "sent",
        origin: "default",
        valueFrom: "default",
      });
    } else {
      this.applyOptionalParam(
        params,
        resolution,
        requestParams,
        narratorParams,
        args.narratorParamOrigins,
        "stream",
      );
    }

    if (this.isDeclaredGenerationParam(requestParams, "timeoutMs")) {
      const timeoutMs = normalizePositiveInt(requestParams?.timeoutMs);
      if (timeoutMs !== undefined) {
        params.timeoutMs = timeoutMs;
        resolution.push({
          name: "timeoutMs",
          finalState: "sent",
          origin: "request",
          valueFrom: "request",
        });
      } else {
        resolution.push({
          name: "timeoutMs",
          finalState: "cancelled",
          origin: "request",
          cancelledAt: "request",
        });
      }
    } else if (this.isDeclaredGenerationParam(narratorParams, "timeoutMs")) {
      const timeoutMs = normalizePositiveInt(narratorParams?.timeoutMs);
      const origin = args.narratorParamOrigins?.timeoutMs ?? "profile";
      if (timeoutMs !== undefined) {
        params.timeoutMs = timeoutMs;
        resolution.push({
          name: "timeoutMs",
          finalState: "sent",
          origin,
          valueFrom: origin,
        });
      } else {
        resolution.push({
          name: "timeoutMs",
          finalState: "cancelled",
          origin,
          cancelledAt: origin,
        });
      }
    } else {
      params.timeoutMs = this.options.executionTimeoutMs;
      resolution.push({
        name: "timeoutMs",
        finalState: "sent",
        origin: "default",
        valueFrom: "default",
      });
    }

    if (this.isDeclaredGenerationParam(requestParams, "maxRetries")) {
      const maxRetries = normalizeNonNegativeInt(requestParams?.maxRetries);
      if (maxRetries !== undefined) {
        params.maxRetries = maxRetries;
        resolution.push({
          name: "maxRetries",
          finalState: "sent",
          origin: "request",
          valueFrom: "request",
        });
      } else {
        resolution.push({
          name: "maxRetries",
          finalState: "cancelled",
          origin: "request",
          cancelledAt: "request",
        });
      }
    } else if (this.isDeclaredGenerationParam(narratorParams, "maxRetries")) {
      const maxRetries = normalizeNonNegativeInt(narratorParams?.maxRetries);
      const origin = args.narratorParamOrigins?.maxRetries ?? "profile";
      if (maxRetries !== undefined) {
        params.maxRetries = maxRetries;
        resolution.push({
          name: "maxRetries",
          finalState: "sent",
          origin,
          valueFrom: origin,
        });
      } else {
        resolution.push({
          name: "maxRetries",
          finalState: "cancelled",
          origin,
          cancelledAt: origin,
        });
      }
    } else {
      resolution.push({
        name: "maxRetries",
        finalState: "absent",
        origin: "absent",
      });
    }

    return { params, resolution };
  }

  resolveMaxContextTokensOverride(
    requestParams?: GenerationParamsInput,
    narratorParams?: GenerationParamsInput,
  ): number | undefined {
    return normalizePositiveInt(
      this.resolveGenerationParam(requestParams, narratorParams, "maxContextTokens"),
    );
  }

  resolveMaxOutputTokensOverride(
    requestParams?: GenerationParamsInput,
    narratorParams?: GenerationParamsInput,
  ): number | undefined {
    return normalizePositiveInt(
      this.resolveGenerationParam(requestParams, narratorParams, "maxOutputTokens"),
    );
  }

  resolvePromptRunKind(runType: FloorRunType | "dry_run"): PromptMacroRunKind {
    switch (runType) {
      case "dry_run":
        return "dry_run";
      case "respond":
        return "respond";
      case "retry_turn":
        return "retry";
      case "regenerate_page":
      case "edit_and_regenerate":
        return "regenerate";
      default:
        return "respond";
    }
  }

  resolveNarratorAssistantPrefillStrategy(models: ResolvedTurnModels): AssistantPrefillExecutionStrategy {
    return resolveAssistantPrefillStrategy(
      models.narrator?.providerType ?? this.options.defaultNarratorProviderType,
    );
  }

  resolveRequestedTurnConfig(
    config: TurnConfig | undefined,
    models: ResolvedTurnModels,
  ): TurnConfig | undefined {
    let nextConfig = config;

    if (!this.options.memoryStoreEnabled) {
      if (this.isSlotDisabled(models, "director") && nextConfig?.enableDirector) {
        nextConfig = { ...nextConfig, enableDirector: false };
      }
      if (this.isSlotDisabled(models, "verifier") && nextConfig?.enableVerifier) {
        nextConfig = { ...nextConfig, enableVerifier: false };
      }
      if (nextConfig?.enableMemoryConsolidation) {
        nextConfig = { ...nextConfig, enableMemoryConsolidation: false };
      }
      return nextConfig;
    }

    if (nextConfig?.enableMemoryConsolidation !== undefined) {
      if (this.isSlotDisabled(models, "director") && nextConfig.enableDirector) {
        nextConfig = { ...nextConfig, enableDirector: false };
      }
      if (this.isSlotDisabled(models, "verifier") && nextConfig.enableVerifier) {
        nextConfig = { ...nextConfig, enableVerifier: false };
      }
      if (this.isSlotDisabled(models, "memory") && nextConfig.enableMemoryConsolidation) {
        nextConfig = { ...nextConfig, enableMemoryConsolidation: false };
      }
      return nextConfig;
    }

    if (!this.options.enableMemoryConsolidationByDefault) {
      if (this.isSlotDisabled(models, "director") && nextConfig?.enableDirector) {
        nextConfig = { ...nextConfig, enableDirector: false };
      }
      if (this.isSlotDisabled(models, "verifier") && nextConfig?.enableVerifier) {
        nextConfig = { ...nextConfig, enableVerifier: false };
      }
      if (nextConfig?.enableMemoryConsolidation) {
        nextConfig = { ...nextConfig, enableMemoryConsolidation: false };
      }
      return nextConfig;
    }

    nextConfig = { ...nextConfig, enableMemoryConsolidation: true };
    if (this.isSlotDisabled(models, "director") && nextConfig.enableDirector) {
      nextConfig.enableDirector = false;
    }
    if (this.isSlotDisabled(models, "verifier") && nextConfig.enableVerifier) {
      nextConfig.enableVerifier = false;
    }
    if (this.isSlotDisabled(models, "memory")) {
      nextConfig.enableMemoryConsolidation = false;
    }

    return nextConfig;
  }

  resolveMemoryWritePolicy(config?: TurnConfig) {
    return resolveMemoryWritePolicyFromRuntimeMode({
      memoryStoreEnabled: this.options.memoryStoreEnabled,
      enableAsyncMemoryIngest: this.options.enableAsyncMemoryIngest,
      config,
    });
  }

  shouldRequestMemoryConsolidation(config?: TurnConfig): boolean {
    return this.resolveMemoryWritePolicy(config).requestedWrite;
  }

  toOrchestratorTurnConfig(config?: TurnConfig): TurnConfig | undefined {
    if (!config) {
      return config;
    }

    const memoryWritePolicy = this.resolveMemoryWritePolicy(config);
    if (memoryWritePolicy.runtimeMode === "async_primary" && memoryWritePolicy.requestedWrite) {
      return {
        ...config,
        enableMemoryConsolidation: false,
      };
    }

    if (memoryWritePolicy.runtimeMode === "disabled" && config.enableMemoryConsolidation) {
      return { ...config, enableMemoryConsolidation: false };
    }

    return config;
  }

  buildModelOverrides(models: ResolvedTurnModels): Partial<Record<InstanceSlot, ModelConfig>> | undefined {
    const entries = (Object.entries(models) as [InstanceSlot, ResolvedTurnModel][])
      .filter(([, resolved]) => resolved.model !== undefined);
    if (entries.length === 0) {
      return undefined;
    }

    const overrides: Partial<Record<InstanceSlot, ModelConfig>> = {};
    for (const [slot, resolved] of entries) {
      if (!resolved.model) {
        continue;
      }
      overrides[slot] = resolved.model;
    }
    return overrides;
  }

  buildGenerationParamsOverrides(models: ResolvedTurnModels): Partial<Record<InstanceSlot, GenerationParams>> | undefined {
    const overrides: Partial<Record<InstanceSlot, GenerationParams>> = {};

    (Object.entries(models) as [InstanceSlot, ResolvedTurnModel][]).forEach(([slot, resolved]) => {
      if (slot === "narrator") {
        return;
      }

      if (resolved.enabled === false) {
        return;
      }

      const params = this.stripMaxContextTokens(resolved.generationParams);
      if (!params || Object.keys(params).length === 0) {
        return;
      }

      overrides[slot] = params as GenerationParams;
    });

    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }

  getSlotGenerationParams(
    models: ResolvedTurnModels,
    slot: InstanceSlot,
  ): GenerationParamsInput | undefined {
    if (models[slot]?.enabled === false) {
      return undefined;
    }

    return models[slot]?.generationParams;
  }

  getSlotGenerationParamOrigins(
    models: ResolvedTurnModels,
    slot: InstanceSlot,
  ): Partial<Record<GenerationParamKey, "profile" | "instance">> | undefined {
    if (models[slot]?.enabled === false) {
      return undefined;
    }

    return models[slot]?.generationParamOrigins;
  }

  async markTurnModelUsed(model: ResolvedTurnModel | ResolvedTurnModels | undefined, accountId: string): Promise<void> {
    if (!model || !this.options.onTurnModelUsed) {
      return;
    }

    try {
      if ("model" in model && "source" in model) {
        await this.options.onTurnModelUsed(model as ResolvedTurnModel, accountId);
        return;
      }

      const seen = new Set<string>();
      for (const resolved of Object.values(model as ResolvedTurnModels)) {
        if (resolved && resolved.enabled !== false && resolved.profileId && !seen.has(resolved.profileId)) {
          seen.add(resolved.profileId);
          await this.options.onTurnModelUsed(resolved, accountId);
        }
      }
    } catch {
      // 记录 last_used_at 失败不应阻断聊天流程。
    }
  }

  private isSlotDisabled(models: ResolvedTurnModels, slot: InstanceSlot): boolean {
    return models[slot]?.enabled === false;
  }

  private applyOptionalParam<K extends GenerationParamKey>(
    params: GenerationParams,
    resolution: PromptRuntimeGenerationParamResolution[],
    requestParams: GenerationParamsInput | undefined,
    narratorParams: GenerationParamsInput | undefined,
    narratorParamOrigins: Partial<Record<GenerationParamKey, "profile" | "instance">> | undefined,
    key: K,
  ): void {
    const value = this.resolveGenerationParam(requestParams, narratorParams, key);
    if (value === undefined) {
      resolution.push({
        name: key,
        finalState: "absent",
        origin: "absent",
      });
      return;
    }

    const origin = this.resolveParamOrigin(narratorParamOrigins, requestParams, key);
    if (value === null) {
      resolution.push({
        name: key,
        finalState: "cancelled",
        origin,
        cancelledAt: origin === "request" ? "request" : origin,
      });
      return;
    }

    params[key] = value as GenerationParams[K];
    resolution.push({
      name: key,
      finalState: "sent",
      origin,
      valueFrom: origin,
    });
  }

  private isDeclaredGenerationParam<K extends keyof GenerationParams>(
    params: GenerationParamsInput | undefined,
    key: K,
  ): boolean {
    return params !== undefined
      && Object.prototype.hasOwnProperty.call(params, key)
      && params[key] !== undefined;
  }

  private resolveGenerationParam<K extends keyof GenerationParams>(
    requestParams: GenerationParamsInput | undefined,
    narratorParams: GenerationParamsInput | undefined,
    key: K,
  ): GenerationParamsInput[K] {
    if (this.isDeclaredGenerationParam(requestParams, key)) {
      return requestParams?.[key];
    }

    if (this.isDeclaredGenerationParam(narratorParams, key)) {
      return narratorParams?.[key];
    }

    return undefined;
  }

  private resolveParamOrigin<K extends GenerationParamKey>(
    narratorParamOrigins: Partial<Record<GenerationParamKey, "profile" | "instance">> | undefined,
    requestParams: GenerationParamsInput | undefined,
    key: K,
  ): Exclude<PromptRuntimeGenerationParamResolution["origin"], "default" | "absent"> {
    if (this.isDeclaredGenerationParam(requestParams, key)) {
      return "request";
    }

    return narratorParamOrigins?.[key] ?? "profile";
  }

  private stripMaxContextTokens(
    params?: GenerationParamsInput,
  ): GenerationParamsInput | undefined {
    if (!params) {
      return undefined;
    }

    const { maxContextTokens: _, ...rest } = params;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }
}

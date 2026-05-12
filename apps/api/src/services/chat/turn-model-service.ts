import type {
  FloorRunType,
  GenerationParams,
  InstanceSlot,
  ModelConfig,
  ProviderType,
  TurnConfig,
} from "@tavern/core";
import type {
  AssistantPrefillExecutionStrategy,
  PromptMacroRunKind,
  SessionPromptInfo,
} from "../prompt-assembler.js";

import { resolveAssistantPrefillStrategy } from "../../lib/llm-provider-discovery.js";
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
    requestParams?: Partial<GenerationParams>;
    narratorParams?: Partial<GenerationParams>;
    availableForReply: number;
    stream?: boolean;
  }): GenerationParams {
    const narratorParams = this.stripMaxContextTokens(args.narratorParams);
    const requestParams = this.stripMaxContextTokens(args.requestParams);
    const timeoutMs = normalizePositiveInt(requestParams?.timeoutMs)
      ?? normalizePositiveInt(narratorParams?.timeoutMs)
      ?? this.options.executionTimeoutMs;
    const maxRetries = normalizeNonNegativeInt(requestParams?.maxRetries)
      ?? normalizeNonNegativeInt(narratorParams?.maxRetries);

    return {
      temperature: 0.7,
      maxOutputTokens: args.availableForReply || 1000,
      ...(args.stream !== undefined ? { stream: args.stream } : {}),
      ...narratorParams,
      ...requestParams,
      timeoutMs,
      ...(maxRetries !== undefined ? { maxRetries } : {}),
    };
  }

  resolveMaxContextTokensOverride(
    requestParams?: Partial<GenerationParams>,
    narratorParams?: Partial<GenerationParams>,
  ): number | undefined {
    return normalizePositiveInt(requestParams?.maxContextTokens)
      ?? normalizePositiveInt(narratorParams?.maxContextTokens);
  }

  resolveMaxOutputTokensOverride(
    requestParams?: Partial<GenerationParams>,
    narratorParams?: Partial<GenerationParams>,
  ): number | undefined {
    return normalizePositiveInt(requestParams?.maxOutputTokens)
      ?? normalizePositiveInt(narratorParams?.maxOutputTokens);
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

      overrides[slot] = params;
    });

    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }

  getSlotGenerationParams(
    models: ResolvedTurnModels,
    slot: InstanceSlot,
  ): Partial<GenerationParams> | undefined {
    if (models[slot]?.enabled === false) {
      return undefined;
    }

    return models[slot]?.generationParams;
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

  private stripMaxContextTokens(
    params?: Partial<GenerationParams>,
  ): Partial<GenerationParams> | undefined {
    if (!params) {
      return undefined;
    }

    const { maxContextTokens: _, ...rest } = params;
    return rest;
  }
}

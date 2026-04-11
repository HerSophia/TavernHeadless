import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import {
  compactObject,
  readArray,
  readBoolean,
  readOptionalString,
  readRecord,
  readString,
} from "./utils.js";

export type PromptRuntimeStructureMode = "default" | "strict_alternating" | "no_assistant";
export type PromptRuntimeAssistantRewriteStrategy = "to_system" | "to_user_transcript";
export type PromptRuntimePolicySource =
  | "system_default"
  | "asset_default"
  | "session_policy"
  | "request_override"
  | "provider_constraint";
export type PromptRuntimeStreamPromptDebugPayloadMode = "done_only" | "unsupported";
export type PromptRuntimeMacroDiagnosticsSurface = "unified_observability";

export type PromptRuntimePersistentStructurePolicy = {
  assistantRewriteStrategy?: PromptRuntimeAssistantRewriteStrategy;
  mergeAdjacentSameRole?: boolean;
  mode: PromptRuntimeStructureMode;
  preserveSystemMessages?: boolean;
};

export type PromptRuntimePersistentDeliveryPolicy = {
  allowAssistantPrefill?: boolean;
  noAssistant?: boolean;
  requireLastUser?: boolean;
};

export type PromptRuntimePersistentPolicy = {
  delivery?: PromptRuntimePersistentDeliveryPolicy;
  structure?: PromptRuntimePersistentStructurePolicy;
};

export type PromptRuntimeDebugPolicy = {
  includePromptSnapshot: boolean;
  includeRuntimeTrace: boolean;
  includeWorldbookMatches: boolean;
};

export type PromptRuntimeResolvedStructurePolicy = {
  assistantRewriteStrategy?: PromptRuntimeAssistantRewriteStrategy;
  mergeAdjacentSameRole: boolean;
  mode: PromptRuntimeStructureMode;
  preserveSystemMessages: boolean;
};

export type PromptRuntimeResolvedDeliveryPolicy = {
  allowAssistantPrefill: boolean;
  noAssistant: boolean;
  requireLastUser: boolean;
};

export type PromptRuntimeResolvedPolicy = {
  debug: PromptRuntimeDebugPolicy;
  delivery: PromptRuntimeResolvedDeliveryPolicy;
  structure: PromptRuntimeResolvedStructurePolicy;
};

export type PromptRuntimeSourceMap = {
  debug?: {
    includePromptSnapshot?: PromptRuntimePolicySource;
    includeRuntimeTrace?: PromptRuntimePolicySource;
    includeWorldbookMatches?: PromptRuntimePolicySource;
  };
  delivery?: {
    allowAssistantPrefill?: PromptRuntimePolicySource;
    noAssistant?: PromptRuntimePolicySource;
    requireLastUser?: PromptRuntimePolicySource;
  };
  structure?: {
    assistantRewriteStrategy?: PromptRuntimePolicySource;
    mergeAdjacentSameRole?: PromptRuntimePolicySource;
    mode?: PromptRuntimePolicySource;
    preserveSystemMessages?: PromptRuntimePolicySource;
  };
};

export type PromptRuntimeAssetSummary = {
  id: string;
  name: string | null;
};

export type PromptRuntimeAssetsView = {
  characterCard: PromptRuntimeAssetSummary | null;
  preset: PromptRuntimeAssetSummary | null;
  regexProfile: PromptRuntimeAssetSummary | null;
  worldbook: PromptRuntimeAssetSummary | null;
};

export type PromptRuntimeResolvedState = {
  assets: PromptRuntimeAssetsView;
  persistentPolicy?: PromptRuntimePersistentPolicy;
  policy: PromptRuntimeResolvedPolicy;
  sourceMap?: PromptRuntimeSourceMap;
  warnings: string[];
};

export type PromptRuntimePolicyView = {
  persistentPolicy?: PromptRuntimePersistentPolicy;
  resolvedPolicy: PromptRuntimeResolvedPolicy;
  warnings: string[];
};

export type PromptRuntimeCapabilities = {
  delivery: {
    defaults: PromptRuntimeResolvedDeliveryPolicy;
  };
  macro: {
    builtInReadOnlyValuesPersistable: boolean;
    dedicatedMacrosRoute: boolean;
    diagnosticsSurface: PromptRuntimeMacroDiagnosticsSurface;
    recentMessageRespectsVisibility: boolean;
    runKindPersistable: boolean;
    stCompatibilitySnapshotsPersistable: boolean;
  };
  observability: {
    dryRun: {
      enabled: boolean;
      includeWorldbookMatches: boolean;
      returnsAssembly: boolean;
      returnsRuntimeTrace: boolean;
      supportsVisibility: boolean;
    };
    live: {
      defaultOff: boolean;
      enabled: boolean;
      includePromptSnapshot: boolean;
      includeRuntimeTrace: boolean;
      includeWorldbookMatches: boolean;
      requestScopedOnly: boolean;
      visibilityRequestSupported: boolean;
      worldbookMatchesRequiresOptIn: boolean;
      worldbookMatchesRequiresRuntimeTrace: boolean;
    };
    stream: {
      enabled: boolean;
      newSseEventFamily: boolean;
      promptDebugPayload: PromptRuntimeStreamPromptDebugPayloadMode;
    };
  };
  structure: {
    defaults: PromptRuntimeResolvedStructurePolicy;
    modes: PromptRuntimeStructureMode[];
  };
  unsupported: string[];
};

export type PromptRuntimeGetSessionOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
};

export type PromptRuntimeGetPolicyOptions = PromptRuntimeGetSessionOptions;
export type PromptRuntimeGetAssetsOptions = PromptRuntimeGetSessionOptions;
export type PromptRuntimeGetCapabilitiesOptions = {
  accountId?: AccountIdHint;
};

export type PromptRuntimePatchPolicyOptions = PromptRuntimeGetSessionOptions & (
  | {
      delivery?: PromptRuntimePersistentDeliveryPolicy | null;
      structure: PromptRuntimePersistentStructurePolicy | null;
    }
  | {
      delivery: PromptRuntimePersistentDeliveryPolicy | null;
      structure?: PromptRuntimePersistentStructurePolicy | null;
    }
);

export type PromptRuntimeResource = {
  getAssets(options: PromptRuntimeGetAssetsOptions): Promise<PromptRuntimeAssetsView>;
  getCapabilities(options?: PromptRuntimeGetCapabilitiesOptions): Promise<PromptRuntimeCapabilities>;
  getPolicy(options: PromptRuntimeGetPolicyOptions): Promise<PromptRuntimePolicyView>;
  getSession(options: PromptRuntimeGetSessionOptions): Promise<PromptRuntimeResolvedState>;
  patchPolicy(options: PromptRuntimePatchPolicyOptions): Promise<PromptRuntimePolicyView>;
};

export function createPromptRuntimeResource(client: TransportClient): PromptRuntimeResource {
  return {
    async getAssets(options): Promise<PromptRuntimeAssetsView> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/prompt-runtime/assets`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      const payload = mapPromptRuntimeAssetsView(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime assets payload is missing");
      }

      return payload;
    },
    async getCapabilities(options: PromptRuntimeGetCapabilitiesOptions = {}): Promise<PromptRuntimeCapabilities> {
      const response = await client.fetchJson<Record<string, unknown>>("/prompt-runtime/capabilities", {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapPromptRuntimeCapabilities(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime capabilities payload is missing");
      }

      return payload;
    },
    async getPolicy(options): Promise<PromptRuntimePolicyView> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/prompt-runtime/policy`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      const payload = mapPromptRuntimePolicyView(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime policy payload is missing");
      }

      return payload;
    },
    async getSession(options): Promise<PromptRuntimeResolvedState> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/prompt-runtime`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      const payload = mapPromptRuntimeResolvedState(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime resolved state payload is missing");
      }

      return payload;
    },
    async patchPolicy(options): Promise<PromptRuntimePolicyView> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/prompt-runtime/policy`,
        {
          body: compactObject({
            delivery: mapPromptRuntimePersistentDeliveryPolicyRequest(options.delivery),
            structure: mapPromptRuntimePersistentStructurePolicyRequest(options.structure),
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "PATCH",
        },
      );

      const payload = mapPromptRuntimePolicyView(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime policy patch payload is missing");
      }

      return payload;
    },
  };
}

function mapPromptRuntimeResolvedState(value: unknown): PromptRuntimeResolvedState | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const policy = mapPromptRuntimeResolvedPolicy(record.policy);
  const assets = mapPromptRuntimeAssetsView(record.assets);
  if (!policy || !assets) {
    return null;
  }

  const persistentPolicy = mapPromptRuntimePersistentPolicy(record.persistent_policy);
  const sourceMap = mapPromptRuntimeSourceMap(record.source_map);

  return {
    assets,
    ...(persistentPolicy ? { persistentPolicy } : {}),
    policy,
    ...(sourceMap ? { sourceMap } : {}),
    warnings: mapStringArray(record.warnings),
  };
}

function mapPromptRuntimePolicyView(value: unknown): PromptRuntimePolicyView | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const resolvedPolicy = mapPromptRuntimeResolvedPolicy(record.resolved_policy);
  if (!resolvedPolicy) {
    return null;
  }

  const persistentPolicy = mapPromptRuntimePersistentPolicy(record.persistent_policy);

  return {
    ...(persistentPolicy ? { persistentPolicy } : {}),
    resolvedPolicy,
    warnings: mapStringArray(record.warnings),
  };
}

function mapPromptRuntimeCapabilities(value: unknown): PromptRuntimeCapabilities | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const structure = readRecord(record.structure);
  const delivery = readRecord(record.delivery);
  const observability = readRecord(record.observability);
  const macro = readRecord(record.macro);
  const live = readRecord(observability?.live);
  const dryRun = readRecord(observability?.dry_run);
  const stream = readRecord(observability?.stream);
  const defaultsStructure = mapPromptRuntimeResolvedStructurePolicy(structure?.defaults);
  const defaultsDelivery = mapPromptRuntimeResolvedDeliveryPolicy(delivery?.defaults);

  if (!structure || !delivery || !observability || !macro || !live || !dryRun || !stream || !defaultsStructure || !defaultsDelivery) {
    return null;
  }

  return {
    structure: {
      defaults: defaultsStructure,
      modes: mapPromptRuntimeStructureModes(structure.modes),
    },
    delivery: {
      defaults: defaultsDelivery,
    },
    observability: {
      live: {
        defaultOff: readBoolean(live.default_off, true),
        enabled: readBoolean(live.enabled),
        includePromptSnapshot: readBoolean(live.include_prompt_snapshot, true),
        includeRuntimeTrace: readBoolean(live.include_runtime_trace, true),
        includeWorldbookMatches: readBoolean(live.include_worldbook_matches, true),
        requestScopedOnly: readBoolean(live.request_scoped_only, true),
        visibilityRequestSupported: readBoolean(live.visibility_request_supported),
        worldbookMatchesRequiresOptIn: readBoolean(live.worldbook_matches_requires_opt_in, true),
        worldbookMatchesRequiresRuntimeTrace: readBoolean(live.worldbook_matches_requires_runtime_trace, true),
      },
      dryRun: {
        enabled: readBoolean(dryRun.enabled),
        includeWorldbookMatches: readBoolean(dryRun.include_worldbook_matches, true),
        returnsAssembly: readBoolean(dryRun.returns_assembly, true),
        returnsRuntimeTrace: readBoolean(dryRun.returns_runtime_trace, true),
        supportsVisibility: readBoolean(dryRun.supports_visibility, true),
      },
      stream: {
        enabled: readBoolean(stream.enabled),
        newSseEventFamily: readBoolean(stream.new_sse_event_family),
        promptDebugPayload: readPromptRuntimeStreamPromptDebugPayloadMode(stream.prompt_debug_payload),
      },
    },
    macro: {
      builtInReadOnlyValuesPersistable: readBoolean(macro.built_in_read_only_values_persistable),
      dedicatedMacrosRoute: readBoolean(macro.dedicated_macros_route),
      diagnosticsSurface: readPromptRuntimeMacroDiagnosticsSurface(macro.diagnostics_surface),
      recentMessageRespectsVisibility: readBoolean(macro.recent_message_respects_visibility, true),
      runKindPersistable: readBoolean(macro.run_kind_persistable),
      stCompatibilitySnapshotsPersistable: readBoolean(macro.st_compatibility_snapshots_persistable),
    },
    unsupported: mapStringArray(record.unsupported),
  };
}

function mapPromptRuntimePersistentPolicy(value: unknown): PromptRuntimePersistentPolicy | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const structure = mapPromptRuntimePersistentStructurePolicy(record.structure);
  const delivery = mapPromptRuntimePersistentDeliveryPolicy(record.delivery);
  const policy: PromptRuntimePersistentPolicy = {};

  if (structure) {
    policy.structure = structure;
  }
  if (delivery) {
    policy.delivery = delivery;
  }

  return Object.keys(policy).length > 0 ? policy : undefined;
}

function mapPromptRuntimePersistentStructurePolicy(value: unknown): PromptRuntimePersistentStructurePolicy | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    mode: readPromptRuntimeStructureMode(record.mode),
    ...(readPromptRuntimeAssistantRewriteStrategy(record.assistant_rewrite_strategy)
      ? { assistantRewriteStrategy: readPromptRuntimeAssistantRewriteStrategy(record.assistant_rewrite_strategy) }
      : {}),
    ...(record.merge_adjacent_same_role !== undefined
      ? { mergeAdjacentSameRole: readBoolean(record.merge_adjacent_same_role) }
      : {}),
    ...(record.preserve_system_messages !== undefined
      ? { preserveSystemMessages: readBoolean(record.preserve_system_messages) }
      : {}),
  };
}

function mapPromptRuntimePersistentDeliveryPolicy(value: unknown): PromptRuntimePersistentDeliveryPolicy | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    ...(record.allow_assistant_prefill !== undefined
      ? { allowAssistantPrefill: readBoolean(record.allow_assistant_prefill) }
      : {}),
    ...(record.require_last_user !== undefined
      ? { requireLastUser: readBoolean(record.require_last_user) }
      : {}),
    ...(record.no_assistant !== undefined
      ? { noAssistant: readBoolean(record.no_assistant) }
      : {}),
  };
}

function mapPromptRuntimeResolvedPolicy(value: unknown): PromptRuntimeResolvedPolicy | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const structure = mapPromptRuntimeResolvedStructurePolicy(record.structure);
  const delivery = mapPromptRuntimeResolvedDeliveryPolicy(record.delivery);
  const debug = mapPromptRuntimeDebugPolicy(record.debug);

  if (!structure || !delivery || !debug) {
    return null;
  }

  return {
    debug,
    delivery,
    structure,
  };
}

function mapPromptRuntimeResolvedStructurePolicy(value: unknown): PromptRuntimeResolvedStructurePolicy | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    mode: readPromptRuntimeStructureMode(record.mode),
    mergeAdjacentSameRole: readBoolean(record.merge_adjacent_same_role),
    preserveSystemMessages: readBoolean(record.preserve_system_messages, true),
    ...(readPromptRuntimeAssistantRewriteStrategy(record.assistant_rewrite_strategy)
      ? { assistantRewriteStrategy: readPromptRuntimeAssistantRewriteStrategy(record.assistant_rewrite_strategy) }
      : {}),
  };
}

function mapPromptRuntimeResolvedDeliveryPolicy(value: unknown): PromptRuntimeResolvedDeliveryPolicy | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    allowAssistantPrefill: readBoolean(record.allow_assistant_prefill, true),
    noAssistant: readBoolean(record.no_assistant),
    requireLastUser: readBoolean(record.require_last_user),
  };
}

function mapPromptRuntimeDebugPolicy(value: unknown): PromptRuntimeDebugPolicy | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    includePromptSnapshot: readBoolean(record.include_prompt_snapshot),
    includeRuntimeTrace: readBoolean(record.include_runtime_trace),
    includeWorldbookMatches: readBoolean(record.include_worldbook_matches),
  };
}

function mapPromptRuntimeSourceMap(value: unknown): PromptRuntimeSourceMap | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const sourceMap: PromptRuntimeSourceMap = {};
  const structure = readRecord(record.structure);
  const delivery = readRecord(record.delivery);
  const debug = readRecord(record.debug);

  if (structure) {
    const structureMap: NonNullable<PromptRuntimeSourceMap["structure"]> = {};
    const mode = readPromptRuntimePolicySource(structure.mode);
    const mergeAdjacentSameRole = readPromptRuntimePolicySource(structure.merge_adjacent_same_role);
    const preserveSystemMessages = readPromptRuntimePolicySource(structure.preserve_system_messages);
    const assistantRewriteStrategy = readPromptRuntimePolicySource(structure.assistant_rewrite_strategy);

    if (mode) {
      structureMap.mode = mode;
    }
    if (mergeAdjacentSameRole) {
      structureMap.mergeAdjacentSameRole = mergeAdjacentSameRole;
    }
    if (preserveSystemMessages) {
      structureMap.preserveSystemMessages = preserveSystemMessages;
    }
    if (assistantRewriteStrategy) {
      structureMap.assistantRewriteStrategy = assistantRewriteStrategy;
    }
    if (Object.keys(structureMap).length > 0) {
      sourceMap.structure = structureMap;
    }
  }

  if (delivery) {
    const deliveryMap: NonNullable<PromptRuntimeSourceMap["delivery"]> = {};
    const allowAssistantPrefill = readPromptRuntimePolicySource(delivery.allow_assistant_prefill);
    const requireLastUser = readPromptRuntimePolicySource(delivery.require_last_user);
    const noAssistant = readPromptRuntimePolicySource(delivery.no_assistant);

    if (allowAssistantPrefill) {
      deliveryMap.allowAssistantPrefill = allowAssistantPrefill;
    }
    if (requireLastUser) {
      deliveryMap.requireLastUser = requireLastUser;
    }
    if (noAssistant) {
      deliveryMap.noAssistant = noAssistant;
    }
    if (Object.keys(deliveryMap).length > 0) {
      sourceMap.delivery = deliveryMap;
    }
  }

  if (debug) {
    const debugMap: NonNullable<PromptRuntimeSourceMap["debug"]> = {};
    const includePromptSnapshot = readPromptRuntimePolicySource(debug.include_prompt_snapshot);
    const includeRuntimeTrace = readPromptRuntimePolicySource(debug.include_runtime_trace);
    const includeWorldbookMatches = readPromptRuntimePolicySource(debug.include_worldbook_matches);

    if (includePromptSnapshot) {
      debugMap.includePromptSnapshot = includePromptSnapshot;
    }
    if (includeRuntimeTrace) {
      debugMap.includeRuntimeTrace = includeRuntimeTrace;
    }
    if (includeWorldbookMatches) {
      debugMap.includeWorldbookMatches = includeWorldbookMatches;
    }
    if (Object.keys(debugMap).length > 0) {
      sourceMap.debug = debugMap;
    }
  }

  return Object.keys(sourceMap).length > 0 ? sourceMap : undefined;
}

function mapPromptRuntimeAssetsView(value: unknown): PromptRuntimeAssetsView | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    characterCard: mapPromptRuntimeAssetSummary(record.character_card),
    preset: mapPromptRuntimeAssetSummary(record.preset),
    regexProfile: mapPromptRuntimeAssetSummary(record.regex_profile),
    worldbook: mapPromptRuntimeAssetSummary(record.worldbook),
  };
}

function mapPromptRuntimeAssetSummary(value: unknown): PromptRuntimeAssetSummary | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    id: readString(record.id),
    name: typeof record.name === "string" ? record.name : null,
  };
}

function mapPromptRuntimePersistentStructurePolicyRequest(
  value: PromptRuntimePersistentStructurePolicy | null | undefined,
): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return compactObject({
    assistant_rewrite_strategy: value.assistantRewriteStrategy,
    merge_adjacent_same_role: value.mergeAdjacentSameRole,
    mode: value.mode,
    preserve_system_messages: value.preserveSystemMessages,
  });
}

function mapPromptRuntimePersistentDeliveryPolicyRequest(
  value: PromptRuntimePersistentDeliveryPolicy | null | undefined,
): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return compactObject({
    allow_assistant_prefill: value.allowAssistantPrefill,
    no_assistant: value.noAssistant,
    require_last_user: value.requireLastUser,
  });
}

function mapPromptRuntimeStructureModes(value: unknown): PromptRuntimeStructureMode[] {
  return readArray(value)
    .map((item) => readOptionalString(item))
    .filter((item): item is PromptRuntimeStructureMode => isPromptRuntimeStructureMode(item));
}

function mapStringArray(value: unknown): string[] {
  return readArray(value)
    .map((item) => readOptionalString(item))
    .filter((item): item is string => item !== undefined);
}

function readPromptRuntimeStructureMode(value: unknown): PromptRuntimeStructureMode {
  const mode = readString(value, "default");
  return isPromptRuntimeStructureMode(mode) ? mode : "default";
}

function readPromptRuntimeAssistantRewriteStrategy(
  value: unknown,
): PromptRuntimeAssistantRewriteStrategy | undefined {
  const strategy = readOptionalString(value);
  return strategy === "to_system" || strategy === "to_user_transcript" ? strategy : undefined;
}

function readPromptRuntimePolicySource(value: unknown): PromptRuntimePolicySource | undefined {
  const source = readOptionalString(value);
  switch (source) {
    case "system_default":
    case "asset_default":
    case "session_policy":
    case "request_override":
    case "provider_constraint":
      return source;
    default:
      return undefined;
  }
}

function readPromptRuntimeStreamPromptDebugPayloadMode(
  value: unknown,
): PromptRuntimeStreamPromptDebugPayloadMode {
  const mode = readString(value, "unsupported");
  return mode === "done_only" ? "done_only" : "unsupported";
}

function readPromptRuntimeMacroDiagnosticsSurface(
  value: unknown,
): PromptRuntimeMacroDiagnosticsSurface {
  return readString(value, "unified_observability") === "unified_observability"
    ? "unified_observability"
    : "unified_observability";
}

function isPromptRuntimeStructureMode(value: string | undefined): value is PromptRuntimeStructureMode {
  return value === "default" || value === "strict_alternating" || value === "no_assistant";
}

import {
  evaluateToolReplaySafety,
  type InstanceSlot,
  type ToolDefinition,
  type ToolParameterSchema,
  type ToolReplaySafety,
  type ToolSideEffectLevel,
} from '@tavern/core';

import type { McpServerConfig, McpToolMetadataOverride } from './types.js';
import {
  createRuntimeMetadataBasisEntry,
  intersectAllowedSlots,
  pickMoreConservativeReplaySafety,
  pickMoreConservativeSideEffectLevel,
  sameAllowedSlots,
  type RuntimeMetadataBasis,
  type RuntimeMetadataBasisDetail,
} from '../shared/metadata-basis.js';

export interface GovernedMcpTool {
  tool: ToolDefinition;
  sideEffectLevelBasis: RuntimeMetadataBasis;
  allowedSlotsBasis: RuntimeMetadataBasis;
  parameterSchemaBasis: RuntimeMetadataBasis;
  replaySafety: ToolReplaySafety;
  replaySafetyBasis: RuntimeMetadataBasis;
  metadataBasisDetail: RuntimeMetadataBasisDetail;
}

function cloneToolParameterSchema(schema: ToolParameterSchema): ToolParameterSchema {
  return {
    type: schema.type,
    properties: { ...schema.properties },
    ...(schema.required ? { required: [...schema.required] } : {}),
  };
}

function cloneToolDefinition(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    parameters: cloneToolParameterSchema(tool.parameters),
    allowedSlots: [...tool.allowedSlots],
  };
}

function cloneOverride(override: McpToolMetadataOverride): McpToolMetadataOverride {
  return {
    toolName: override.toolName,
    ...(override.sideEffectLevel ? { sideEffectLevel: override.sideEffectLevel } : {}),
    ...(override.allowedSlots ? { allowedSlots: [...override.allowedSlots] } : {}),
    ...(override.parameterSchema ? { parameterSchema: cloneToolParameterSchema(override.parameterSchema) } : {}),
    ...(override.replaySafety ? { replaySafety: override.replaySafety } : {}),
  };
}

function findOverride(
  config: McpServerConfig,
  toolName: string,
): McpToolMetadataOverride | null {
  const match = config.metadataOverrides?.find((entry) => entry.toolName === toolName);
  return match ? cloneOverride(match) : null;
}

function resolveDeclaredSideEffectLevel(tool: ToolDefinition, config: McpServerConfig): {
  value: ToolSideEffectLevel;
  basis: RuntimeMetadataBasis;
  detail: RuntimeMetadataBasisDetail['sideEffectLevel'];
} {
  if (tool.sideEffectLevel !== config.defaultSideEffectLevel) {
    return {
      value: tool.sideEffectLevel,
      basis: 'tool_declared',
      detail: createRuntimeMetadataBasisEntry('tool_declared', 'tool'),
    };
  }

  return {
    value: config.defaultSideEffectLevel,
    basis: 'server_default',
    detail: createRuntimeMetadataBasisEntry('server_default', 'server'),
  };
}

function resolveAllowedSlots(tool: ToolDefinition, override: McpToolMetadataOverride | null): {
  value: InstanceSlot[];
  basis: RuntimeMetadataBasis;
  detail: RuntimeMetadataBasisDetail['allowedSlots'];
} {
  const declared = [...tool.allowedSlots];
  const declaredBasis = declared.length > 0 ? 'tool_declared' : 'platform_default';
  const declaredDetail = declared.length > 0
    ? createRuntimeMetadataBasisEntry('tool_declared', 'tool')
    : createRuntimeMetadataBasisEntry('platform_default', 'platform');

  if (!override?.allowedSlots || override.allowedSlots.length === 0) {
    return {
      value: declared,
      basis: declaredBasis,
      detail: declaredDetail,
    };
  }

  const applied = intersectAllowedSlots(declared, override.allowedSlots);
  const overrideApplied = declared.length === 0
    ? true
    : !sameAllowedSlots(applied, declared) || sameAllowedSlots(override.allowedSlots, declared);

  if (!overrideApplied) {
    return {
      value: declared,
      basis: declaredBasis,
      detail: declaredDetail,
    };
  }

  return {
    value: applied,
    basis: 'account_override',
    detail: createRuntimeMetadataBasisEntry('account_override', 'tool'),
  };
}

function resolveParameterSchema(tool: ToolDefinition, override: McpToolMetadataOverride | null): {
  value: ToolParameterSchema;
  basis: RuntimeMetadataBasis;
  detail: RuntimeMetadataBasisDetail['parameterSchema'];
} {
  if (override?.parameterSchema) {
    return {
      value: cloneToolParameterSchema(override.parameterSchema),
      basis: 'account_override',
      detail: createRuntimeMetadataBasisEntry('account_override', 'local'),
    };
  }

  return {
    value: cloneToolParameterSchema(tool.parameters),
    basis: 'shallow_schema_projection',
    detail: createRuntimeMetadataBasisEntry('shallow_schema_projection', 'projection'),
  };
}

function resolveReplaySafety(
  config: McpServerConfig,
  tool: ToolDefinition,
  override: McpToolMetadataOverride | null,
): {
  value: ToolReplaySafety;
  basis: RuntimeMetadataBasis;
  detail: RuntimeMetadataBasisDetail['replaySafety'];
} {
  const inferred = evaluateToolReplaySafety({
    providerId: `mcp:${config.id}`,
    providerType: 'mcp',
    toolName: tool.name,
    sideEffectLevel: tool.sideEffectLevel,
    status: 'success',
    lifecycleState: 'finished',
  }).replaySafety;

  if (!override?.replaySafety) {
    return {
      value: inferred,
      basis: 'inferred_from_execution_policy',
      detail: createRuntimeMetadataBasisEntry('inferred_from_execution_policy', 'inference'),
    };
  }

  const resolved = pickMoreConservativeReplaySafety(inferred, override.replaySafety);
  if (resolved === override.replaySafety) {
    return {
      value: resolved,
      basis: 'account_override',
      detail: createRuntimeMetadataBasisEntry('account_override', 'local'),
    };
  }

  return {
    value: inferred,
    basis: 'inferred_from_execution_policy',
    detail: createRuntimeMetadataBasisEntry('inferred_from_execution_policy', 'inference'),
  };
}

export function governMcpTool(
  config: McpServerConfig,
  rawTool: ToolDefinition,
): GovernedMcpTool {
  const override = findOverride(config, rawTool.name);
  const sideEffectLevel = resolveDeclaredSideEffectLevel(rawTool, config);
  const resolvedSideEffectLevel = override?.sideEffectLevel
    ? pickMoreConservativeSideEffectLevel(sideEffectLevel.value, override.sideEffectLevel)
    : sideEffectLevel.value;
  const sideEffectLevelBasis = override?.sideEffectLevel && resolvedSideEffectLevel === override.sideEffectLevel
    ? 'account_override'
    : sideEffectLevel.basis;
  const sideEffectLevelDetail = sideEffectLevelBasis === 'account_override'
    ? createRuntimeMetadataBasisEntry('account_override', 'tool')
    : sideEffectLevel.detail;

  const allowedSlots = resolveAllowedSlots(rawTool, override);
  const parameterSchema = resolveParameterSchema(rawTool, override);

  const finalTool = cloneToolDefinition({
    ...rawTool,
    sideEffectLevel: resolvedSideEffectLevel,
    allowedSlots: allowedSlots.value,
    parameters: parameterSchema.value,
  });

  const replaySafety = resolveReplaySafety(config, finalTool, override);

  return {
    tool: finalTool,
    sideEffectLevelBasis,
    allowedSlotsBasis: allowedSlots.basis,
    parameterSchemaBasis: parameterSchema.basis,
    replaySafety: replaySafety.value,
    replaySafetyBasis: replaySafety.basis,
    metadataBasisDetail: {
      sideEffectLevel: sideEffectLevelDetail,
      allowedSlots: allowedSlots.detail,
      parameterSchema: parameterSchema.detail,
      replaySafety: replaySafety.detail,
    },
  };
}

export function cloneGovernedMcpTool(entry: GovernedMcpTool): GovernedMcpTool {
  return {
    tool: cloneToolDefinition(entry.tool),
    sideEffectLevelBasis: entry.sideEffectLevelBasis,
    allowedSlotsBasis: entry.allowedSlotsBasis,
    parameterSchemaBasis: entry.parameterSchemaBasis,
    replaySafety: entry.replaySafety,
    replaySafetyBasis: entry.replaySafetyBasis,
    metadataBasisDetail: {
      ...(entry.metadataBasisDetail.sideEffectLevel ? { sideEffectLevel: { ...entry.metadataBasisDetail.sideEffectLevel } } : {}),
      ...(entry.metadataBasisDetail.allowedSlots ? { allowedSlots: { ...entry.metadataBasisDetail.allowedSlots } } : {}),
      ...(entry.metadataBasisDetail.parameterSchema ? { parameterSchema: { ...entry.metadataBasisDetail.parameterSchema } } : {}),
      ...(entry.metadataBasisDetail.replaySafety ? { replaySafety: { ...entry.metadataBasisDetail.replaySafety } } : {}),
    },
  };
}

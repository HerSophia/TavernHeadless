import {
  DEFAULT_NODE_GRAPH_RUNTIME_BUDGET,
  DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET,
  compileNodeGraph,
  createDefaultNodeTypeRegistry,
  resolveNodeGraphBudget,
  summarizeNodeGraphBudgetUsage,
  type NodeGraphBudgetOverrides,
  type NodeGraphDiagnostic,
  type NodeGraphDocument,
  type NodeGraphNode,
  type NodeGraphRuntimeBudget,
  type NodeTypeRegistryEntry,
} from "@tavern/core/node-graph";

import { isAgentCallPersistentDeliveryTarget, type AgentCallDeliveryTarget } from "../config/agent-call-config";

export type GraphAgentExecutionSourceMode = "inherit" | "agent_binding" | "node_override" | "unknown";

export interface GraphRequiredPermissionViewItem {
  permission: string;
  declared: boolean;
  requiredBy: Array<{
    nodeId: string;
    nodeType: string;
    nodeName?: string;
  }>;
}

export interface GraphOutputTargetViewItem {
  target: string;
  declared: boolean;
  usedBy: Array<{
    nodeId: string;
    nodeType: string;
    nodeName?: string;
  }>;
}

export interface GraphAgentGenerationParamViewItem {
  key: GraphAgentGenerationParamKey;
  enabled: boolean;
  value?: number | string | boolean;
  inheritedLabel?: string;
}

export type GraphAgentGenerationParamKey =
  | "temperature"
  | "topP"
  | "maxOutputTokens"
  | "maxContextTokens"
  | "frequencyPenalty"
  | "presencePenalty"
  | "repetitionPenalty";

export interface GraphAgentExecutionSourceItem {
  nodeId: string;
  nodeType: string;
  nodeName?: string;
  mediumKind?: string;
  agentBindingId?: string;
  sourceMode: GraphAgentExecutionSourceMode;
  profileId?: string;
  profileLabel?: string;
  modelId?: string;
  modelLabel?: string;
  modelSourceLabel: string;
  generationParams: GraphAgentGenerationParamViewItem[];
  diagnostics: NodeGraphDiagnostic[];
}

export interface GraphBudgetViewItem {
  key: keyof NodeGraphRuntimeBudget;
  platformLimit: number;
  graphOverride?: number;
  effectiveLimit: number;
  currentUsage?: number;
  exceeded: boolean;
  nearLimit: boolean;
}

export interface GraphSettingsView {
  overview: {
    schemaVersion: number;
    nodeCount: number;
    edgeCount: number;
    groupCount: number;
    diagnosticCount: number;
  };
  policies: {
    allowBackgroundJobs: boolean;
    allowPersistentOutputs: boolean;
    maxParallelNodes?: number;
    diagnostics: NodeGraphDiagnostic[];
  };
  permissions: {
    required: GraphRequiredPermissionViewItem[];
    missingRequired: string[];
    unusedRequired: string[];
    outputTargetsMode: "unscoped" | "scoped" | "deny_all";
    outputTargets: GraphOutputTargetViewItem[];
  };
  budgets: {
    runtime: GraphBudgetViewItem[];
    preview: GraphBudgetViewItem[];
  };
  agentExecution: GraphAgentExecutionSourceItem[];
  diagnostics: NodeGraphDiagnostic[];
}

const registry = createDefaultNodeTypeRegistry();

const AGENT_EXECUTION_NODE_TYPES = new Set([
  "narration.narrator",
  "agent.director_plan",
  "agent.player_agency_precheck",
  "agent.call",
  "verify.continuity",
  "verify.player_agency_postcheck",
]);

const BUDGET_KEYS: Array<keyof NodeGraphRuntimeBudget> = [
  "maxNodesExecuted",
  "maxDepth",
  "maxFanOut",
  "maxNestedAgentJobs",
  "maxTemporaryConversations",
  "maxRuntimeDurationMs",
];

const GENERATION_PARAM_KEYS: GraphAgentGenerationParamKey[] = [
  "temperature",
  "topP",
  "maxOutputTokens",
  "maxContextTokens",
  "frequencyPenalty",
  "presencePenalty",
  "repetitionPenalty",
];

export function buildGraphSettingsView(document: NodeGraphDocument, validationDiagnostics: readonly NodeGraphDiagnostic[] = []): GraphSettingsView {
  const diagnostics = buildGraphSettingsDiagnostics(document);
  const allDiagnostics = [...diagnostics];
  const compiled = compileNodeGraph(document);
  const usage = summarizeNodeGraphBudgetUsage(document, compiled.topologicalLevels);

  return {
    overview: {
      schemaVersion: Number(document.schemaVersion),
      nodeCount: document.nodes.length,
      edgeCount: document.edges.length,
      groupCount: document.groups?.length ?? 0,
      diagnosticCount: validationDiagnostics.length + allDiagnostics.length,
    },
    policies: {
      allowBackgroundJobs: document.policies.allowBackgroundJobs === true,
      allowPersistentOutputs: document.policies.allowPersistentOutputs === true,
      maxParallelNodes: document.policies.maxParallelNodes,
      diagnostics: allDiagnostics.filter((diagnostic) => diagnostic.code.includes("policy")),
    },
    permissions: buildPermissionsView(document),
    budgets: {
      runtime: buildBudgetItems(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, document.budgets, usage),
      preview: buildBudgetItems(DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET, document.budgets, usage),
    },
    agentExecution: buildAgentExecutionItems(document),
    diagnostics: allDiagnostics,
  };
}

export function buildGraphSettingsDiagnostics(document: NodeGraphDocument): NodeGraphDiagnostic[] {
  const diagnostics: NodeGraphDiagnostic[] = [];
  for (const node of document.nodes) {
    const config = asRecord(node.config);
    const medium = asRecord(config.medium);
    const deliveryTarget = typeof medium.deliveryTarget === "string" ? medium.deliveryTarget : null;
    if (
      node.type === "agent.call"
      && deliveryTarget
      && isAgentCallPersistentDeliveryTarget(deliveryTarget as AgentCallDeliveryTarget)
      && document.policies.allowPersistentOutputs !== true
    ) {
      diagnostics.push({
        severity: "error",
        code: "studio_graph_agent_call_persistent_output_policy_missing",
        message: `Node '${node.id}' uses persistent delivery target '${deliveryTarget}' but allowPersistentOutputs is not enabled.`,
        nodeId: node.id,
      });
    }

    const execution = readExecutionConfig(node);
    if (AGENT_EXECUTION_NODE_TYPES.has(node.type)) {
      const modelSource = asRecord(execution.modelSource);
      if (modelSource.mode === "llm_profile" && !stringValue(modelSource.profileId)) {
        diagnostics.push({
          severity: "error",
          code: "studio_graph_agent_model_profile_missing",
          message: `Node '${node.id}' selects an LLM Profile but has no profile id.`,
          nodeId: node.id,
        });
      }
      for (const issue of validateGenerationParams(node)) {
        diagnostics.push(issue);
      }
    }
  }

  const outputTargets = document.permissions?.outputTargets;
  if (Array.isArray(outputTargets)) {
    const declared = new Set(outputTargets);
    for (const item of collectUsedPersistentOutputTargets(document)) {
      if (!declared.has(item.target)) {
        diagnostics.push({
          severity: "error",
          code: "studio_graph_output_target_not_declared",
          message: `Node '${item.node.id}' uses output target '${item.target}' that is not declared in permissions.outputTargets.`,
          nodeId: item.node.id,
        });
      }
    }
  } else if (collectUsedPersistentOutputTargets(document).length > 0) {
    diagnostics.push({
      severity: "warning",
      code: "studio_graph_output_targets_unscoped",
      message: "Graph uses persistent outputs but permissions.outputTargets is not declared; global policy will apply.",
    });
  }

  return diagnostics;
}

export function buildAgentExecutionItems(document: NodeGraphDocument): GraphAgentExecutionSourceItem[] {
  return document.nodes
    .filter((node) => AGENT_EXECUTION_NODE_TYPES.has(node.type))
    .map((node) => {
      const config = asRecord(node.config);
      const execution = readExecutionConfig(node);
      const modelSource = asRecord(execution.modelSource);
      const agentBindingId = stringValue(config.agentBindingId) ?? stringValue(modelSource.agentBindingId);
      const profileId = stringValue(modelSource.profileId);
      const modelId = stringValue(execution.modelId);
      const sourceMode = resolveSourceMode(modelSource, agentBindingId, profileId, modelId, execution.generation);
      return {
        nodeId: node.id,
        nodeType: node.type,
        ...(node.name ? { nodeName: node.name } : {}),
        ...(readMediumKind(node) ? { mediumKind: readMediumKind(node) as string } : {}),
        ...(agentBindingId ? { agentBindingId } : {}),
        sourceMode,
        ...(profileId ? { profileId, profileLabel: profileId } : {}),
        ...(modelId ? { modelId, modelLabel: modelId } : {}),
        modelSourceLabel: modelSourceLabel(sourceMode, profileId, modelId, agentBindingId),
        generationParams: readGenerationParams(execution.generation),
        diagnostics: validateGenerationParams(node),
      };
    });
}

export function applyAgentExecutionConfig(config: unknown, execution: Record<string, unknown>): Record<string, unknown> {
  const next = { ...asRecord(config) };
  if (Object.keys(execution).length === 0) {
    delete next.execution;
  } else {
    next.execution = execution;
  }
  return next;
}

function buildPermissionsView(document: NodeGraphDocument): GraphSettingsView["permissions"] {
  const declaredRequired = new Set(document.permissions?.required ?? []);
  const requiredByPermission = new Map<string, GraphRequiredPermissionViewItem>();
  const usedPermissions = new Set<string>();

  for (const node of document.nodes) {
    const entry = registry.find(node.type, node.typeVersion) as NodeTypeRegistryEntry | undefined;
    for (const permission of entry?.permissionsRequired ?? []) {
      usedPermissions.add(permission);
      const current = requiredByPermission.get(permission) ?? {
        permission,
        declared: declaredRequired.has(permission),
        requiredBy: [],
      };
      current.requiredBy.push({
        nodeId: node.id,
        nodeType: node.type,
        ...(node.name ? { nodeName: node.name } : {}),
      });
      requiredByPermission.set(permission, current);
    }
  }

  const required = [...requiredByPermission.values()].sort((left, right) => left.permission.localeCompare(right.permission));
  const missingRequired = required.filter((item) => !item.declared).map((item) => item.permission);
  const unusedRequired = [...declaredRequired].filter((permission) => !usedPermissions.has(permission)).sort();
  const declaredTargets = document.permissions?.outputTargets;
  const usedTargets = collectUsedPersistentOutputTargets(document);
  const targetMap = new Map<string, GraphOutputTargetViewItem>();
  const declaredTargetSet = Array.isArray(declaredTargets) ? new Set(declaredTargets) : null;

  for (const target of declaredTargets ?? []) {
    targetMap.set(target, { target, declared: true, usedBy: [] });
  }
  for (const item of usedTargets) {
    const current = targetMap.get(item.target) ?? {
      target: item.target,
      declared: declaredTargetSet === null ? false : declaredTargetSet.has(item.target),
      usedBy: [],
    };
    current.usedBy.push({
      nodeId: item.node.id,
      nodeType: item.node.type,
      ...(item.node.name ? { nodeName: item.node.name } : {}),
    });
    targetMap.set(item.target, current);
  }

  return {
    required,
    missingRequired,
    unusedRequired,
    outputTargetsMode: declaredTargets === undefined ? "unscoped" : declaredTargets.length === 0 ? "deny_all" : "scoped",
    outputTargets: [...targetMap.values()].sort((left, right) => left.target.localeCompare(right.target)),
  };
}

function buildBudgetItems(
  platformBudget: NodeGraphRuntimeBudget,
  graphBudget: NodeGraphBudgetOverrides | undefined,
  usage: ReturnType<typeof summarizeNodeGraphBudgetUsage>,
): GraphBudgetViewItem[] {
  const effective = resolveNodeGraphBudget(platformBudget, graphBudget);
  const usageByKey: Partial<Record<keyof NodeGraphRuntimeBudget, number>> = {
    maxNodesExecuted: usage.runtimeNodeCount,
    maxDepth: usage.depth,
    maxFanOut: usage.maxFanOut,
    maxNestedAgentJobs: usage.nestedAgentJobs,
    maxTemporaryConversations: usage.temporaryConversations,
  };

  return BUDGET_KEYS.map((key) => {
    const currentUsage = usageByKey[key];
    const effectiveLimit = effective[key];
    return {
      key,
      platformLimit: platformBudget[key],
      graphOverride: graphBudget?.[key],
      effectiveLimit,
      currentUsage,
      exceeded: typeof currentUsage === "number" ? currentUsage > effectiveLimit : false,
      nearLimit: typeof currentUsage === "number" && effectiveLimit > 0
        ? currentUsage >= Math.ceil(effectiveLimit * 0.8)
        : false,
    };
  });
}

function collectUsedPersistentOutputTargets(document: NodeGraphDocument): Array<{ target: string; node: NodeGraphNode }> {
  const targets: Array<{ target: string; node: NodeGraphNode }> = [];
  for (const node of document.nodes) {
    const medium = asRecord(asRecord(node.config).medium);
    const deliveryTarget = typeof medium.deliveryTarget === "string" ? medium.deliveryTarget : null;
    if (node.type === "agent.call" && deliveryTarget && isAgentCallPersistentDeliveryTarget(deliveryTarget as AgentCallDeliveryTarget)) {
      targets.push({ target: deliveryTarget, node });
    }
    if (node.type.startsWith("output.")) {
      targets.push({ target: node.type, node });
    }
  }
  return targets;
}

function readExecutionConfig(node: NodeGraphNode): Record<string, unknown> {
  return asRecord(asRecord(node.config).execution);
}

function readGenerationParams(generation: unknown): GraphAgentGenerationParamViewItem[] {
  const record = asRecord(generation);
  return GENERATION_PARAM_KEYS.map((key) => {
    const item = asRecord(record[key]);
    const enabled = item.enabled === true;
    return {
      key,
      enabled,
      ...(item.value !== undefined ? { value: item.value as number | string | boolean } : {}),
      ...(!enabled ? { inheritedLabel: "default" } : {}),
    };
  });
}

function validateGenerationParams(node: NodeGraphNode): NodeGraphDiagnostic[] {
  const diagnostics: NodeGraphDiagnostic[] = [];
  const generation = asRecord(readExecutionConfig(node).generation);
  for (const key of GENERATION_PARAM_KEYS) {
    const item = generation[key];
    if (item === undefined) {
      continue;
    }
    if (!isToggleableNumberParamValid(key, item)) {
      diagnostics.push({
        severity: "error",
        code: "studio_graph_agent_generation_param_invalid",
        message: `Node '${node.id}' has invalid generation parameter '${key}'.`,
        nodeId: node.id,
      });
    }
  }
  return diagnostics;
}

function isToggleableNumberParamValid(key: GraphAgentGenerationParamKey, value: unknown): boolean {
  const item = asRecord(value);
  if (typeof item.enabled !== "boolean") {
    return false;
  }
  if (item.enabled === false) {
    return item.value === undefined || typeof item.value === "number";
  }
  if (typeof item.value !== "number" || !Number.isFinite(item.value)) {
    return false;
  }
  if ((key === "maxOutputTokens" || key === "maxContextTokens") && (!Number.isInteger(item.value) || item.value <= 0)) {
    return false;
  }
  if (key === "temperature") {
    return item.value >= 0 && item.value <= 2;
  }
  if (key === "topP") {
    return item.value >= 0 && item.value <= 1;
  }
  return true;
}

function resolveSourceMode(
  modelSource: Record<string, unknown>,
  agentBindingId: string | undefined,
  profileId: string | undefined,
  modelId: string | undefined,
  generation: unknown,
): GraphAgentExecutionSourceMode {
  if (modelSource.mode === "llm_profile" || profileId || modelId || generation !== undefined) {
    return "node_override";
  }
  if (modelSource.mode === "agent_binding" || agentBindingId) {
    return "agent_binding";
  }
  if (modelSource.mode === "inherit" || modelSource.mode === undefined) {
    return "inherit";
  }
  return "unknown";
}

function modelSourceLabel(
  mode: GraphAgentExecutionSourceMode,
  profileId: string | undefined,
  modelId: string | undefined,
  agentBindingId: string | undefined,
): string {
  if (profileId && modelId) {
    return `${profileId} · ${modelId}`;
  }
  if (profileId) {
    return profileId;
  }
  if (modelId) {
    return modelId;
  }
  if (agentBindingId) {
    return agentBindingId;
  }
  return mode;
}

function readMediumKind(node: NodeGraphNode): string | null {
  const medium = asRecord(asRecord(node.config).medium);
  return typeof medium.kind === "string" ? medium.kind : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

import type {
  NodeGraphDocument,
  NodeGraphNode,
  NodeGraphPolicies,
  NodeTypeRegistryEntry,
} from "@tavern/core/node-graph";

import {
  AGENT_CALL_DELIVERY_TARGETS,
  AGENT_CALL_MEDIUM_KINDS,
  isAgentCallPersistentDeliveryTarget,
  type AgentCallDeliveryTarget,
} from "../config/agent-call-config";
import { CONTROL_GATE_ON_SKIP_OPTIONS } from "../config/control-node-config";

export type NodeInlineConfigControlType = "text" | "textarea" | "select" | "number" | "boolean" | "summary" | "toggle_number" | "model_source";
export type NodeInlineConfigTone = "neutral" | "warning" | "info";

export interface NodeInlineToggleNumberValue {
  enabled: boolean;
  value?: number;
}

export type NodeInlineConfigControlValue = string | number | boolean | null | NodeInlineToggleNumberValue;

export interface NodeInlineConfigOption {
  value: string;
  label: string;
  labelKey?: string;
}

export interface NodeInlineConfigControl {
  key: string;
  type: NodeInlineConfigControlType;
  path: string;
  label: string;
  labelKey?: string;
  value: NodeInlineConfigControlValue;
  placeholder?: string;
  placeholderKey?: string;
  options?: NodeInlineConfigOption[];
  summary?: string;
  hint?: string;
  hintKey?: string;
  tone?: NodeInlineConfigTone;
  readOnly?: boolean;
  rows?: number;
  min?: number;
  max?: number;
  step?: number;
  defaultNumberValue?: number;
  emptyValue?: "delete" | "keep" | "null";
}

export interface InlineConfigLlmProfileOption {
  id: string;
  name?: string;
}

export interface BuildInlineConfigControlsOptions {
  document?: NodeGraphDocument;
  policies?: NodeGraphPolicies | null;
  /** 可选的 LLM Profile 列表：用于 Agent 节点卡片上的模型来源下拉选择。 */
  llmProfiles?: InlineConfigLlmProfileOption[];
}

type JsonRecord = Record<string, unknown>;

const TEMPLATE_ROLE_OPTIONS = ["system", "user", "assistant"] as const;
const AGENT_EXECUTION_NODE_TYPES = new Set([
  "narration.narrator",
  "agent.director_plan",
  "agent.player_agency_precheck",
  "agent.call",
  "verify.continuity",
  "verify.player_agency_postcheck",
]);
const AGENT_GENERATION_PARAMS: Array<{
  key: "temperature" | "topP" | "maxOutputTokens" | "maxContextTokens";
  min?: number;
  max?: number;
  step: number;
  defaultNumberValue: number;
}> = [
  { key: "temperature", min: 0, max: 2, step: 0.1, defaultNumberValue: 0.7 },
  { key: "topP", min: 0, max: 1, step: 0.05, defaultNumberValue: 1 },
  { key: "maxOutputTokens", min: 1, step: 1, defaultNumberValue: 1024 },
  { key: "maxContextTokens", min: 1, step: 1, defaultNumberValue: 8192 },
];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isPlainSegment(segment: string): boolean {
  return segment.length > 0 && !segment.includes("[") && !segment.includes("]");
}

function splitPath(path: string): string[] {
  const segments = path.split(".").filter((segment) => segment.length > 0);
  if (segments.some((segment) => !isPlainSegment(segment))) {
    throw new Error(`Inline config path does not support arrays: ${path}`);
  }
  return segments;
}

function cloneValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function cleanupEmptyObjects(record: JsonRecord): JsonRecord {
  const next: JsonRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (isRecord(value)) {
      const cleaned = cleanupEmptyObjects(value);
      if (Object.keys(cleaned).length > 0) {
        next[key] = cleaned;
      }
      continue;
    }
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

export function readInlineConfigValue(config: unknown, path: string): unknown {
  const segments = splitPath(path);
  let current: unknown = config;
  for (const segment of segments) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

export function applyInlineConfigValue(
  config: unknown,
  path: string,
  value: unknown,
  options: { emptyValue?: "delete" | "keep" | "null" } = {},
): unknown {
  const segments = splitPath(path);
  if (segments.length === 0) {
    return config;
  }

  const emptyValue = options.emptyValue ?? "delete";
  let normalized = value;
  if (typeof value === "string" && value.length === 0) {
    if (emptyValue === "delete") {
      normalized = undefined;
    } else if (emptyValue === "null") {
      normalized = null;
    }
  }

  const root: JsonRecord = isRecord(config) ? { ...config } : {};
  let cursor = root;
  for (const segment of segments.slice(0, -1)) {
    const child = cursor[segment];
    const nextChild = isRecord(child) ? { ...child } : {};
    cursor[segment] = nextChild;
    cursor = nextChild;
  }

  const leaf = segments[segments.length - 1]!;
  if (normalized === undefined && path === "presetRef.presetId") {
    delete root.presetRef;
  } else if (normalized === undefined) {
    delete cursor[leaf];
  } else {
    cursor[leaf] = cloneValue(normalized);
  }

  const cleaned = cleanupEmptyObjects(root);
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function stringValue(config: unknown, path: string, fallback = ""): string {
  const value = readInlineConfigValue(config, path);
  return typeof value === "string" ? value : fallback;
}

function selectOptions(values: readonly string[], keyPrefix: string): NodeInlineConfigOption[] {
  return values.map((value) => ({ value, label: value, labelKey: `${keyPrefix}.${value}` }));
}

function control(
  type: NodeInlineConfigControlType,
  path: string,
  label: string,
  value: NodeInlineConfigControl["value"],
  patch: Partial<NodeInlineConfigControl> = {},
): NodeInlineConfigControl {
  return {
    key: `${path}:${type}`,
    type,
    path,
    label,
    labelKey: `graph.inlineConfig.field.${path.replaceAll(".", "_")}`,
    value,
    ...patch,
  };
}

function compactPath(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  return value.map((segment) => String(segment)).join(".");
}

export function summarizeInlineCondition(expr: unknown): string {
  const condition = asRecord(expr);
  const op = typeof condition.op === "string" ? condition.op : "condition";
  switch (op) {
    case "exists":
    case "empty": {
      const value = asRecord(condition.value);
      const source = typeof value.source === "string" ? value.source : "value";
      const path = compactPath(value.path);
      return path ? `${op} ${source}.${path}` : op;
    }
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const left = asRecord(condition.left);
      const source = typeof left.source === "string" ? left.source : "value";
      const path = compactPath(left.path);
      return path ? `${source}.${path} ${op}` : op;
    }
    case "and":
    case "or":
      return `${op} ${Array.isArray(condition.items) ? condition.items.length : 0}`;
    case "not":
      return "not";
    default:
      return op;
  }
}

function hasIncomingConditionEdge(document: NodeGraphDocument | undefined, nodeId: string): boolean {
  return Boolean(
    document?.edges.some((edge) => edge.to.nodeId === nodeId && edge.to.port === "condition"),
  );
}

function buildConditionSummaryControl(node: NodeGraphNode, options: BuildInlineConfigControlsOptions): NodeInlineConfigControl {
  const value = readInlineConfigValue(node.config, "condition");
  if (value === undefined) {
    const hasInput = hasIncomingConditionEdge(options.document, node.id);
    return control("summary", "condition", "Condition", null, {
      summary: hasInput ? "input" : "missing",
      hintKey: hasInput ? "graph.inlineConfig.useInput" : "graph.inlineConfig.openInspector",
      tone: hasInput ? "info" : "warning",
      readOnly: true,
    });
  }
  return control("summary", "condition", "Condition", null, {
    summary: summarizeInlineCondition(value),
    hintKey: "graph.inlineConfig.openInspector",
    readOnly: true,
  });
}

function isDeliveryTarget(value: string): value is AgentCallDeliveryTarget {
  return (AGENT_CALL_DELIVERY_TARGETS as readonly string[]).includes(value);
}

function readToggleNumberParam(config: unknown, path: string): NodeInlineToggleNumberValue {
  const item = asRecord(readInlineConfigValue(config, path));
  return {
    enabled: item.enabled === true,
    ...(typeof item.value === "number" ? { value: item.value } : {}),
  };
}

function buildAgentGenerationParamControls(config: unknown): NodeInlineConfigControl[] {
  return AGENT_GENERATION_PARAMS.map((param) => {
    const path = `execution.generation.${param.key}`;
    return control("toggle_number", path, param.key, readToggleNumberParam(config, path), {
      labelKey: `graph.inlineConfig.field.execution_generation_${param.key}`,
      min: param.min,
      max: param.max,
      step: param.step,
      defaultNumberValue: param.defaultNumberValue,
    });
  });
}

function buildAgentModelIdControl(config: unknown): NodeInlineConfigControl {
  return control("text", "execution.modelId", "Model", stringValue(config, "execution.modelId"), {
    labelKey: "graph.inlineConfig.field.execution_modelId",
    placeholderKey: "graph.inlineConfig.modelIdPlaceholder",
});
}

function buildAgentModelSourceControl(
  config: unknown,
  profiles: InlineConfigLlmProfileOption[],
): NodeInlineConfigControl {
  const modelSource = asRecord(readInlineConfigValue(config, "execution.modelSource"));
  const profileId = typeof modelSource.profileId === "string" ? modelSource.profileId : "";
  const options: NodeInlineConfigOption[] = [
    { value: "", label: "inherit", labelKey: "graph.inlineConfig.modelSourceInherit" },
    ...profiles.map((profile) => ({ value: profile.id, label: profile.name ?? profile.id })),
  ];
// 若已选的 profile 不在当前列表（例如未加载或已删除），仍保留其为可见项，避免下拉丢值。
  if (profileId && !profiles.some((profile) => profile.id === profileId)){
    options.push({ value: profileId, label: profileId });
  }
return control("model_source", "execution.modelSource", "Profile", profileId, {
    labelKey: "graph.inlineConfig.field.execution_modelSource",
    options,
    hintKey: "graph.inlineConfig.modelSourceHint",
  });
}

function buildAgentExecutionControls(
  config: unknown,
  options: BuildInlineConfigControlsOptions,
): NodeInlineConfigControl[] {
  return [
    buildAgentModelSourceControl(config, options.llmProfiles ?? []),
    buildAgentModelIdControl(config),
    ...buildAgentGenerationParamControls(config),
  ];
}

function buildPolicyHints(config: unknown, policies: NodeGraphPolicies | null | undefined): string | undefined {
  const mediumKind = stringValue(config, "medium.kind", "single_call");
  const deliveryTarget = stringValue(config, "medium.deliveryTarget", "return_inline");
  const hints: string[] = [];
  if (mediumKind === "background_job" && policies?.allowBackgroundJobs !== true) {
    hints.push("graph.inlineConfig.policyWarning.backgroundJob");
  }
  if (
    isDeliveryTarget(deliveryTarget)
    && isAgentCallPersistentDeliveryTarget(deliveryTarget)
    && policies?.allowPersistentOutputs !== true
  ) {
    hints.push("graph.inlineConfig.policyWarning.persistentOutput");
  }
  return hints[0];
}

export function buildInlineConfigControls(
  node: NodeGraphNode,
  _entry?: NodeTypeRegistryEntry,
  options: BuildInlineConfigControlsOptions = {},
): NodeInlineConfigControl[] {
  const agentExecutionControls = AGENT_EXECUTION_NODE_TYPES.has(node.type)
    ? buildAgentExecutionControls(node.config, options)
    : [];

  switch (node.type) {
    case "annotation.comment":
      return [
        control("textarea", "content", "Content", stringValue(node.config, "content"), {
          rows: 2,
          placeholderKey: "graph.inlineConfig.empty",
        }),
      ];

    case "compose.template_render":
      return [
        control("textarea", "template", "Template", stringValue(node.config, "template"), {
          rows: 2,
          placeholderKey: "graph.inlineConfig.empty",
        }),
        control("select", "role", "Role", stringValue(node.config, "role"), {
          options: [
            { value: "", label: "—", labelKey: "graph.inlineConfig.none" },
            ...selectOptions(TEMPLATE_ROLE_OPTIONS, "graph.inlineConfig.role"),
          ],
        }),
      ];

    case "control.condition":
    case "control.branch":
      return [buildConditionSummaryControl(node, options)];

    case "control.gate":
      return [
        buildConditionSummaryControl(node, options),
        control("select", "onSkip", "On skip", stringValue(node.config, "onSkip", "empty_output"), {
          options: selectOptions(CONTROL_GATE_ON_SKIP_OPTIONS, "graph.controlConfig.onSkipValue"),
        }),
      ];

    case "agent.call": {
      const hintKey = buildPolicyHints(node.config, options.policies);
      return [
        control("select", "medium.kind", "Medium", stringValue(node.config, "medium.kind", "single_call"), {
          options: selectOptions(AGENT_CALL_MEDIUM_KINDS, "graph.agentCallConfig.mediumKind"),
          hintKey: hintKey === "graph.inlineConfig.policyWarning.backgroundJob" ? hintKey : undefined,
          tone: hintKey === "graph.inlineConfig.policyWarning.backgroundJob" ? "warning" : "neutral",
        }),
        control("select", "medium.deliveryTarget", "Delivery target", stringValue(node.config, "medium.deliveryTarget", "return_inline"), {
          options: selectOptions(AGENT_CALL_DELIVERY_TARGETS, "graph.agentCallConfig.deliveryTargetValue"),
          hintKey: hintKey === "graph.inlineConfig.policyWarning.persistentOutput" ? hintKey : undefined,
          tone: hintKey === "graph.inlineConfig.policyWarning.persistentOutput" ? "warning" : "neutral",
        }),
        control("text", "triggerReason", "Trigger reason", stringValue(node.config, "triggerReason"), {
          placeholderKey: "graph.inlineConfig.empty",
        }),
              ...agentExecutionControls,
      ];
    }

    case "narration.narrator":
      return [
        control("text", "presetRef.presetId", "Preset ID", stringValue(node.config, "presetRef.presetId"), {
          placeholderKey: "graph.inlineConfig.useSessionPreset",
        }),
        control("text", "presetRef.presetVersionId", "Preset version ID", stringValue(node.config, "presetRef.presetVersionId"), {
          placeholderKey: "graph.inlineConfig.empty",
          emptyValue: "null",
        }),
        ...agentExecutionControls,
      ];

    default:
      return agentExecutionControls;
  }
}

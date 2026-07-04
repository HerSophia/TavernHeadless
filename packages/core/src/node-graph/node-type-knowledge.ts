import { createDefaultNodeTypeRegistry, type NodeTypeRegistry } from './registry.js';
import {
  NODE_GRAPH_NODE_CATEGORIES,
  type NodeGraphNodeCategory,
  type NodeGraphNodeConfigKnowledge,
  type NodeGraphNodeExample,
  type NodeGraphNodeTypeKnowledge,
  type NodeGraphNodeTypeKnowledgeDetail,
  type NodeGraphNodeTypeKnowledgeListItem,
  type NodeGraphNodeTypePortSummary,
  type NodeGraphPortDefinition,
  type NodeTypeRegistryEntry,
} from './types.js';

export const NODE_GRAPH_NODE_CATEGORY_LABELS: Record<NodeGraphNodeCategory, string> = {
  source: 'Source',
  select: 'Select',
  compose: 'Compose',
  agent: 'Agent',
  narration: 'Narration',
  verify: 'Verify',
  output: 'Output',
  group: 'Group',
  control: 'Control',
  annotation: 'Annotation',
};

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function clonePorts(ports: readonly NodeGraphPortDefinition[]): NodeGraphPortDefinition[] {
  return ports.map((port) => ({ ...port }));
}

function cloneKnowledge(knowledge: NodeGraphNodeTypeKnowledge | undefined): NodeGraphNodeTypeKnowledge | undefined {
  return knowledge ? cloneJson(knowledge) : undefined;
}

function inferNodeTypeCategory(type: string): NodeGraphNodeCategory {
  const prefix = type.split('.')[0] ?? '';
  if ((NODE_GRAPH_NODE_CATEGORIES as readonly string[]).includes(prefix)) {
    return prefix as NodeGraphNodeCategory;
  }
  return 'compose';
}

function summarizePorts(ports: readonly NodeGraphPortDefinition[]): NodeGraphNodeTypePortSummary[] {
  return ports.map((port) => {
    const summary: NodeGraphNodeTypePortSummary = {
      name: port.name,
      type: port.type,
    };
    if (port.required !== undefined) {
      summary.required = port.required;
    }
    if (port.multiple !== undefined) {
      summary.multiple = port.multiple;
    }
    if (port.variadic !== undefined) {
      summary.variadic = port.variadic;
    }
    if (port.description !== undefined) {
      summary.description = port.description;
    }
    return summary;
  });
}

function baseKnowledge(entry: NodeTypeRegistryEntry): {
  category: NodeGraphNodeCategory;
  summary: string;
  usage?: string;
  config?: NodeGraphNodeConfigKnowledge;
  examples?: NodeGraphNodeExample[];
  pitfalls?: string[];
  relatedNodeTypes?: string[];
  knowledge?: NodeGraphNodeTypeKnowledge;
} {
  const knowledge = cloneKnowledge(entry.knowledge);
  const category = knowledge?.category ?? inferNodeTypeCategory(entry.type);
  const summary = knowledge?.summary ?? entry.description ?? entry.title ?? entry.type;
  return {
    category,
    summary,
    usage: knowledge?.usage,
    config: knowledge?.config,
    examples: knowledge?.examples,
    pitfalls: knowledge?.pitfalls,
    relatedNodeTypes: knowledge?.relatedNodeTypes,
    knowledge,
  };
}

export function getNodeTypeCategoryLabel(category: NodeGraphNodeCategory): string {
  return NODE_GRAPH_NODE_CATEGORY_LABELS[category];
}

function toNodeTypeKnowledgeListItem(entry: NodeTypeRegistryEntry): NodeGraphNodeTypeKnowledgeListItem {
  const knowledge = baseKnowledge(entry);
  const inputPorts = clonePorts(entry.inputPorts);
  const outputPorts = clonePorts(entry.outputPorts);
  const item: NodeGraphNodeTypeKnowledgeListItem = {
    type: entry.type,
    typeVersion: entry.typeVersion,
    inputPorts,
    outputPorts,
    inputPortNames: inputPorts.map((port) => port.name),
    outputPortNames: outputPorts.map((port) => port.name),
    inputPortSummary: summarizePorts(inputPorts),
    outputPortSummary: summarizePorts(outputPorts),
    supportedPhases: [...entry.supportedPhases],
    previewPolicy: entry.previewPolicy,
    category: knowledge.category,
    summary: knowledge.summary,
  };
  if (entry.title !== undefined) {
    item.title = entry.title;
  }
  if (entry.description !== undefined) {
    item.description = entry.description;
  }
  if (entry.configSchema !== undefined) {
    item.configSchema = entry.configSchema;
  }
  if (entry.permissionsRequired !== undefined) {
    item.permissionsRequired = [...entry.permissionsRequired];
  }
  if (entry.sideEffects !== undefined) {
    item.sideEffects = entry.sideEffects;
  }
  return item;
}

export function listNodeTypeKnowledge(
  registry: NodeTypeRegistry = createDefaultNodeTypeRegistry(),
): NodeGraphNodeTypeKnowledgeListItem[] {
  return registry.list().map((entry) => toNodeTypeKnowledgeListItem(entry));
}

export function describeNodeTypeKnowledgeFromEntry(entry: NodeTypeRegistryEntry): NodeGraphNodeTypeKnowledgeDetail {
  const listItem = toNodeTypeKnowledgeListItem(entry);
  const knowledge = baseKnowledge(entry);
  const detail: NodeGraphNodeTypeKnowledgeDetail = { ...listItem };
  if (knowledge.usage !== undefined) {
    detail.usage = knowledge.usage;
  }
  if (knowledge.config !== undefined) {
    detail.config = knowledge.config;
  }
  if (knowledge.examples !== undefined) {
    detail.examples = knowledge.examples;
  }
  if (knowledge.pitfalls !== undefined) {
    detail.pitfalls = knowledge.pitfalls;
  }
  if (knowledge.relatedNodeTypes !== undefined) {
    detail.relatedNodeTypes = knowledge.relatedNodeTypes;
  }
  if (knowledge.knowledge !== undefined) {
    detail.knowledge = knowledge.knowledge;
  }
  return detail;
}

export function describeNodeTypeKnowledge(
  type: string,
  typeVersion = '1',
  registry: NodeTypeRegistry = createDefaultNodeTypeRegistry(),
): NodeGraphNodeTypeKnowledgeDetail | undefined {
  const entry = registry.find(type, typeVersion);
  return entry ? describeNodeTypeKnowledgeFromEntry(entry) : undefined;
}

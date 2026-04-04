import type {
  PromptGraphDocument,
  PromptNode,
  PromptNodeGroup,
  PromptExecutionPolicy,
  PromptPlacement,
  PromptRunIntent,
} from '@tavern/core';

import type { STPreset, STPromptEntry } from './types/preset.js';

export interface BuildImportedPresetPromptGraphOptions {
  artifactId?: string;
  depthLevels?: number[];
}

const ROOT_GROUP_ID = 'imported-st-preset-root';
const ORDER_STEP = 10;

function getPromptEntry(preset: STPreset, identifier: string): STPromptEntry | undefined {
  return preset.prompts.find((entry) => entry.identifier === identifier);
}

function pushNode(nodes: PromptNode[], node: PromptNode): number {
  nodes.push(node);
  return node.placement.order;
}

function toNodeTriggers(promptEntry: STPromptEntry | undefined): PromptRunIntent[] | undefined {
  const triggers = promptEntry?.behavior?.triggers;
  return triggers && triggers.length > 0 ? [...triggers] : undefined;
}

function toNodePlacement(promptEntry: STPromptEntry | undefined, order: number, allowInChat = true): PromptPlacement {
  const placement = promptEntry?.behavior?.placement;
  if (!placement || placement.kind === 'relative' || !allowInChat) {
    return { kind: 'relative', order };
  }

  return {
    kind: 'in_chat',
    depth: placement.depth,
    order: placement.order,
  };
}

function makeStaticTextNode(args: {
  id: string;
  name: string;
  role: 'system' | 'user' | 'assistant';
  order: number;
  template: string;
  promptEntry?: STPromptEntry;
  metadata?: Record<string, unknown>;
}): PromptNode {
  return {
    id: args.id,
    name: args.name,
    nodeType: 'static_text',
    enabled: true,
    role: args.role,
    placement: toNodePlacement(args.promptEntry, args.order),
    ...(toNodeTriggers(args.promptEntry) ? { triggers: toNodeTriggers(args.promptEntry) } : {}),
    template: args.template,
    metadata: args.metadata,
  };
}

function makePromptNodeFromIdentifier(
  preset: STPreset,
  identifier: string,
  order: number,
): PromptNode | null {
  const promptEntry = getPromptEntry(preset, identifier);
  const role = promptEntry?.role ?? 'system';
  const name = promptEntry?.name || identifier;

  switch (identifier) {
    case 'main':
    case 'nsfw':
    case 'jailbreak':
    case 'enhanceDefinitions':
      if (!promptEntry?.content?.trim()) {
        return null;
      }
      return makeStaticTextNode({
        id: `preset:${identifier}`,
        name,
        role,
        order,
        template: promptEntry.content,
        promptEntry,
        metadata: { source: 'sillytavern', identifier },
      });
    case 'worldInfoBefore':
      return {
        id: `preset:${identifier}`,
        name,
        nodeType: 'worldbook',
        enabled: true,
        role: 'system',
        placement: toNodePlacement(promptEntry, order),
        ...(toNodeTriggers(promptEntry) ? { triggers: toNodeTriggers(promptEntry) } : {}),
        position: 'before',
        metadata: { source: 'sillytavern', identifier },
      };
    case 'worldInfoAfter':
      return {
        id: `preset:${identifier}`,
        name,
        nodeType: 'worldbook',
        enabled: true,
        role: 'system',
        placement: toNodePlacement(promptEntry, order),
        ...(toNodeTriggers(promptEntry) ? { triggers: toNodeTriggers(promptEntry) } : {}),
        position: 'after',
        metadata: { source: 'sillytavern', identifier },
      };
    case 'charDescription':
      return {
        id: `preset:${identifier}`,
        name,
        nodeType: 'character',
        enabled: true,
        role: 'system',
        placement: toNodePlacement(promptEntry, order),
        ...(toNodeTriggers(promptEntry) ? { triggers: toNodeTriggers(promptEntry) } : {}),
        part: 'description',
        metadata: { source: 'sillytavern', identifier },
      };
    case 'charPersonality':
      return {
        id: `preset:${identifier}`,
        name,
        nodeType: 'character',
        enabled: true,
        role: 'system',
        placement: toNodePlacement(promptEntry, order),
        ...(toNodeTriggers(promptEntry) ? { triggers: toNodeTriggers(promptEntry) } : {}),
        part: 'personality',
        metadata: { source: 'sillytavern', identifier },
      };
    case 'scenario':
      return {
        id: `preset:${identifier}`,
        name,
        nodeType: 'character',
        enabled: true,
        role: 'system',
        placement: toNodePlacement(promptEntry, order),
        ...(toNodeTriggers(promptEntry) ? { triggers: toNodeTriggers(promptEntry) } : {}),
        part: 'scenario',
        metadata: { source: 'sillytavern', identifier },
      };
    case 'personaDescription':
      return {
        id: `preset:${identifier}`,
        name,
        nodeType: 'persona',
        enabled: true,
        role: 'system',
        placement: toNodePlacement(promptEntry, order),
        ...(toNodeTriggers(promptEntry) ? { triggers: toNodeTriggers(promptEntry) } : {}),
        metadata: { source: 'sillytavern', identifier },
      };
    case 'dialogueExamples':
      return {
        id: `preset:${identifier}`,
        name,
        nodeType: 'example_dialogue',
        enabled: true,
        role: 'system',
        placement: toNodePlacement(promptEntry, order),
        ...(toNodeTriggers(promptEntry) ? { triggers: toNodeTriggers(promptEntry) } : {}),
        metadata: { source: 'sillytavern', identifier },
      };
    case 'chatHistory':
      return {
        id: `preset:${identifier}`,
        name,
        nodeType: 'chat_history',
        enabled: true,
        role: 'system',
        placement: toNodePlacement(promptEntry, order, false),
        ...(toNodeTriggers(promptEntry) ? { triggers: toNodeTriggers(promptEntry) } : {}),
        metadata: { source: 'sillytavern', identifier },
      };
    default:
      if (promptEntry?.marker) {
        return {
          id: `preset:${identifier}`,
          name,
          nodeType: 'marker',
          enabled: true,
          role: 'system',
          placement: toNodePlacement(promptEntry, order),
          ...(toNodeTriggers(promptEntry) ? { triggers: toNodeTriggers(promptEntry) } : {}),
          markerId: identifier,
          metadata: { source: 'sillytavern', identifier },
        };
      }
      if (!promptEntry?.content?.trim()) {
        return null;
      }
      return makeStaticTextNode({
        id: `preset:${identifier}`,
        name,
        role,
        order,
        template: promptEntry.content,
        promptEntry,
        metadata: { source: 'sillytavern', identifier },
      });
  }
}

function hasNode(nodes: PromptNode[], predicate: (node: PromptNode) => boolean): boolean {
  return nodes.some(predicate);
}

function buildExecutionPolicies(preset: STPreset): PromptExecutionPolicy {
  const namesBehavior = preset.namesBehavior === 1 ? 'always' : 'off';
  return {
    continueNudgePrompt: preset.continueNudgePrompt || undefined,
    assistantPrefill: preset.assistantPrefill || undefined,
    namesBehavior,
  };
}

export function buildImportedPresetPromptGraph(
  preset: STPreset,
  options: BuildImportedPresetPromptGraphOptions = {},
): PromptGraphDocument {
  const nodes: PromptNode[] = [];
  let nextOrder = 0;
  let chatHistoryOrder: number | null = null;

  for (const identifier of preset.promptOrder) {
    const node = makePromptNodeFromIdentifier(preset, identifier, nextOrder);
    nextOrder += ORDER_STEP;
    if (!node) {
      continue;
    }
    const order = pushNode(nodes, node);
    if (node.nodeType === 'chat_history') {
      chatHistoryOrder = order;
    }
  }

  if (chatHistoryOrder === null) {
    chatHistoryOrder = nextOrder + ORDER_STEP;
    pushNode(nodes, {
      id: 'native:chat-history:fallback',
      name: 'Chat History',
      nodeType: 'chat_history',
      enabled: true,
      role: 'system',
      placement: { kind: 'relative', order: chatHistoryOrder },
      metadata: { source: 'native-fallback', reason: 'chatHistory missing from preset.promptOrder' },
    });
  }

  if (!hasNode(nodes, (node) => node.nodeType === 'worldbook' && node.position === 'before')) {
    pushNode(nodes, {
      id: 'native:worldbook:before:fallback',
      name: 'Worldbook Before',
      nodeType: 'worldbook',
      enabled: true,
      role: 'system',
      placement: { kind: 'relative', order: chatHistoryOrder - 1 },
      position: 'before',
      metadata: { source: 'native-fallback', reason: 'worldInfoBefore marker missing from preset.promptOrder' },
    });
  }

  if (!hasNode(nodes, (node) => node.nodeType === 'worldbook' && node.position === 'after')) {
    pushNode(nodes, {
      id: 'native:worldbook:after:fallback',
      name: 'Worldbook After',
      nodeType: 'worldbook',
      enabled: true,
      role: 'system',
      placement: { kind: 'relative', order: chatHistoryOrder + 1 },
      position: 'after',
      metadata: { source: 'native-fallback', reason: 'worldInfoAfter marker missing from preset.promptOrder' },
    });
  }

  const depthLevels = [...new Set(options.depthLevels ?? [])].sort((left, right) => left - right);
  for (const depth of depthLevels) {
    if (hasNode(nodes, (node) => node.nodeType === 'worldbook' && node.position === 'depth' && node.depth === depth)) {
      continue;
    }
    pushNode(nodes, {
      id: `native:worldbook:depth:${depth}`,
      name: `Worldbook Depth ${depth}`,
      nodeType: 'worldbook',
      enabled: true,
      role: 'system',
      placement: { kind: 'relative', order: 1000 + depth },
      position: 'depth',
      depth,
      metadata: { source: 'native-fallback', reason: 'depth worldbook entries detected at runtime' },
    });
  }

  const firstContentOrder = nodes.length > 0
    ? Math.min(...nodes.map((node) => node.placement.order))
    : 0;

  if (!hasNode(nodes, (node) => node.nodeType === 'character' && node.part === 'description')) {
    pushNode(nodes, {
      id: 'native:character:description:fallback',
      name: 'Character Description',
      nodeType: 'character',
      enabled: true,
      role: 'system',
      placement: { kind: 'relative', order: firstContentOrder + 0.1 },
      part: 'description',
      metadata: { source: 'native-fallback', reason: 'character description is part of native base context' },
    });
  }

  if (!hasNode(nodes, (node) => node.nodeType === 'character' && node.part === 'personality')) {
    pushNode(nodes, {
      id: 'native:character:personality:fallback',
      name: 'Character Personality',
      nodeType: 'character',
      enabled: true,
      role: 'system',
      placement: { kind: 'relative', order: firstContentOrder + 0.2 },
      part: 'personality',
      metadata: { source: 'native-fallback', reason: 'character personality is part of native base context' },
    });
  }

  if (!hasNode(nodes, (node) => node.nodeType === 'character' && node.part === 'scenario')) {
    pushNode(nodes, {
      id: 'native:character:scenario:fallback',
      name: 'Character Scenario',
      nodeType: 'character',
      enabled: true,
      role: 'system',
      placement: { kind: 'relative', order: firstContentOrder + 0.3 },
      part: 'scenario',
      metadata: { source: 'native-fallback', reason: 'character scenario is part of native base context' },
    });
  }

  if (!hasNode(nodes, (node) => node.nodeType === 'persona')) {
    pushNode(nodes, {
      id: 'native:persona:fallback',
      name: 'Persona Description',
      nodeType: 'persona',
      enabled: true,
      role: 'system',
      placement: { kind: 'relative', order: firstContentOrder + 0.4 },
      metadata: { source: 'native-fallback', reason: 'persona description is part of native base context' },
    });
  }

  if (!hasNode(nodes, (node) => node.nodeType === 'character' && node.part === 'system_prompt')) {
    pushNode(nodes, {
      id: 'native:character:system-prompt',
      name: 'Character System Prompt',
      nodeType: 'character',
      enabled: true,
      role: 'system',
      placement: { kind: 'relative', order: firstContentOrder + 0.5 },
      part: 'system_prompt',
      metadata: { source: 'native-fallback', reason: 'character.systemPrompt should be compiled inside native graph' },
    });
  }

  if (!hasNode(nodes, (node) => node.nodeType === 'memory')) {
    pushNode(nodes, {
      id: 'native:memory-summary',
      name: 'Memory Summary',
      nodeType: 'memory',
      enabled: true,
      role: 'system',
      placement: { kind: 'relative', order: firstContentOrder + 0.75 },
      metadata: { source: 'native-fallback', reason: 'memory summary should be compiled inside native graph' },
    });
  }

  if (!hasNode(nodes, (node) => node.nodeType === 'character' && node.part === 'post_history')) {
    pushNode(nodes, {
      id: 'native:character:post-history',
      name: 'Character Post-History',
      nodeType: 'character',
      enabled: true,
      role: 'system',
      placement: { kind: 'relative', order: chatHistoryOrder + 1000 },
      part: 'post_history',
      metadata: { source: 'native-fallback', reason: 'character.postHistoryInstructions should be compiled inside native graph' },
    });
  }

  const group: PromptNodeGroup = {
    id: ROOT_GROUP_ID,
    name: 'Imported ST Preset',
    nodes: nodes.sort((left, right) => left.placement.order - right.placement.order),
    edges: [],
    metadata: {
      source: 'sillytavern',
      selectedPromptOrderCharacterId: preset.selectedPromptOrderCharacterId ?? null,
    },
  };

  return {
    version: 1,
    rootGroupId: ROOT_GROUP_ID,
    groups: [group],
    policies: buildExecutionPolicies(preset),
    imports: options.artifactId
      ? [{ source: 'sillytavern', artifactId: options.artifactId, groupId: ROOT_GROUP_ID }]
      : undefined,
  };
}

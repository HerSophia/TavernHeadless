import type { ChatRole, IRMessage, IRSection, PromptIR } from '../prompt/types.js';
import { resolvePromptRuntimeGovernancePolicy } from '../prompt/governance.js';
import { TemplateEngine } from '../prompt/template-engine.js';
import { PROMPT_ASSET_CHARACTER_BUDGET_GROUP, PROMPT_ASSET_CHARACTER_SOURCE_KIND } from '../prompt-assets/index.js';
import type {
  CharacterNode,
  ChatHistoryNode,
  ContributorNode,
  ExampleDialogueNode,
  MarkerNode,
  MemoryNode,
  PersonaNode,
  PromptExecutionPolicy,
  PromptGraphCompilerInput,
  PromptGraphDocument,
  PromptNode,
  PromptNodeGroup,
  PromptPlacement,
  PromptRunIntent,
  StaticTextNode,
  ToolResultNode,
  VariableTemplateNode,
  WorldbookNode,
} from './types.js';

const DEFAULT_TRIGGER: PromptRunIntent = 'normal';

export class PromptGraphCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptGraphCompileError';
  }
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function resolveTemplate(templateEngine: TemplateEngine, text: string, variables: Record<string, unknown>): string {
  return templateEngine.render(text, new Map(Object.entries(variables))).trim();
}

function shouldIncludeNode(node: PromptNode, intent: PromptRunIntent): boolean {
  if (!node.enabled) {
    return false;
  }

  if (!node.triggers || node.triggers.length === 0) {
    return true;
  }

  return node.triggers.includes(intent);
}

function findGroup(document: PromptGraphDocument, groupId: string): PromptNodeGroup {
  const group = document.groups.find((candidate) => candidate.id === groupId);
  if (!group) {
    throw new PromptGraphCompileError(`Prompt graph root group not found: ${groupId}`);
  }
  return group;
}

function findMarkerNode(group: PromptNodeGroup, anchorId: string): MarkerNode | null {
  const marker = group.nodes.find(
    (node): node is MarkerNode => node.nodeType === 'marker' && node.markerId === anchorId,
  );

  return marker ?? null;
}

function buildContributorSectionName(node: ContributorNode): string {
  if (node.sourceKind === 'state_projection') {
    return 'stateProjection';
  }

  return `contributor:${node.sourceKind}`;
}

function buildContributorContent(node: ContributorNode): string {
  const title = node.title.trim();
  const content = node.content.trim();
  if (!title) {
    return content;
  }
  if (!content) {
    return `[${title}]`;
  }

  return `[${title}]\n${content}`;
}

function findAnchorOrder(group: PromptNodeGroup, placement: Extract<PromptPlacement, { kind: 'anchor' }>): number | null {
  const marker = findMarkerNode(group, placement.anchorId);
  if (!marker) {
    return null;
  }

  if (marker.placement.kind === 'in_chat') {
    return 1000 + marker.placement.depth + marker.placement.order / 1000;
  }

  if (marker.placement.kind === 'anchor') {
    return marker.placement.order;
  }

  return marker.placement.order;
}

function findAnchorInsertion(
  group: PromptNodeGroup,
  placement: Extract<PromptPlacement, { kind: 'anchor' }>,
): IRSection['insertion'] | undefined {
  const marker = findMarkerNode(group, placement.anchorId);
  if (!marker || marker.placement.kind !== 'in_chat') {
    return undefined;
  }

  return {
    kind: 'in_chat',
    depth: marker.placement.depth,
    order: marker.placement.order + placement.order,
  };
}

function resolvePlacementOrder(group: PromptNodeGroup, placement: PromptPlacement): number {
  switch (placement.kind) {
    case 'relative':
      return placement.order;
    case 'in_chat':
      return 1000 + placement.depth + placement.order / 1000;
    case 'anchor': {
      const anchorOrder = findAnchorOrder(group, placement);
      return anchorOrder !== null ? anchorOrder + placement.order / 1000 : placement.order;
    }
  }
}

function toSectionInsertion(placement: PromptPlacement): IRSection['insertion'] | undefined {
  if (placement.kind !== 'in_chat') {
    return undefined;
  }

  return {
    kind: 'in_chat',
    depth: placement.depth,
    order: placement.order,
  };
}

function normalizeNamesBehavior(policy: PromptExecutionPolicy['namesBehavior']): 'off' | 'always' {
  return policy === 'always' ? 'always' : 'off';
}

function getUserName(input: PromptGraphCompilerInput): string {
  const name = input.persona?.name?.trim();
  return name && name.length > 0 ? name : 'User';
}

function getAssistantName(input: PromptGraphCompilerInput): string {
  const name = input.character?.name?.trim();
  return name && name.length > 0 ? name : 'Assistant';
}

function applyNamesBehavior(
  content: string,
  role: ChatRole,
  input: PromptGraphCompilerInput,
  policy: PromptExecutionPolicy['namesBehavior'],
  shouldApply: boolean,
): string {
  if (!shouldApply || normalizeNamesBehavior(policy) !== 'always' || content.trim().length === 0) {
    return content;
  }

  if (role === 'user') {
    const userName = getUserName(input);
    return content.startsWith(`${userName}: `) ? content : `${userName}: ${content}`;
  }

  if (role === 'assistant') {
    const assistantName = getAssistantName(input);
    return content.startsWith(`${assistantName}: `) ? content : `${assistantName}: ${content}`;
  }

  return content;
}

function createSection(
  name: string,
  order: number,
  messages: IRMessage[],
  pinned = true,
  options: {
    insertion?: IRSection['insertion'];
    semantic?: IRSection['semantic'];
    budgetGroup?: IRSection['budgetGroup'];
    budgetPriority?: IRSection['budgetPriority'];
  } = {},
): IRSection | null {
  const filteredMessages = messages.filter((message) => message.content.trim().length > 0);
  if (filteredMessages.length === 0) {
    return null;
  }

  return {
    name,
    order,
    pinned,
    messages: filteredMessages,
    ...(options.insertion ? { insertion: options.insertion } : {}),
    ...(options.semantic ? { semantic: options.semantic } : {}),
    ...(options.budgetGroup ? { budgetGroup: options.budgetGroup } : {}),
    ...(options.budgetPriority !== undefined ? { budgetPriority: options.budgetPriority } : {}),
  };
}

function compileStaticTextNode(
  group: PromptNodeGroup,
  node: StaticTextNode | VariableTemplateNode,
  templateEngine: TemplateEngine,
  input: PromptGraphCompilerInput,
  policies: PromptExecutionPolicy,
): IRSection | null {
  const content = resolveTemplate(templateEngine, node.template, input.variables ?? {});
  return createSection(node.name, resolvePlacementOrder(group, node.placement), [{
    role: node.role,
    content: applyNamesBehavior(content, node.role, input, policies.namesBehavior, node.placement.kind === 'in_chat'),
    source: `prompt-graph:${node.id}`,
    prunable: false,
  }], true, {
    insertion: toSectionInsertion(node.placement),
  });
}

function resolveCharacterRuntimeSourcePart(part: CharacterNode['part']): string {
  switch (part) {
    case 'description':
    case 'personality':
    case 'scenario':
      return 'profile';
    case 'system_prompt':
      return 'system_prompt';
    case 'post_history':
      return 'post_history_instructions';
  }
}

function compileCharacterNode(
  group: PromptNodeGroup,
  node: CharacterNode,
  templateEngine: TemplateEngine,
  input: PromptGraphCompilerInput,
  policies: PromptExecutionPolicy,
): IRSection | null {
  const character = input.character;
  if (!character) {
    return null;
  }

  let raw = '';
  switch (node.part) {
    case 'description':
      raw = character.description ?? '';
      break;
    case 'personality':
      raw = character.personality ? `Personality: ${character.personality}` : '';
      break;
    case 'scenario':
      raw = character.scenario ? `Scenario: ${character.scenario}` : '';
      break;
    case 'system_prompt':
      raw = character.systemPrompt ?? '';
      break;
    case 'post_history':
      raw = character.postHistoryInstructions ?? '';
      break;
  }

  const content = resolveTemplate(templateEngine, raw, input.variables ?? {});
  const characterGovernance = resolvePromptRuntimeGovernancePolicy({
    sourceKind: PROMPT_ASSET_CHARACTER_SOURCE_KIND,
    fallback: { budgetGroup: PROMPT_ASSET_CHARACTER_BUDGET_GROUP, pinned: true, prunable: false },
  });
  const runtimeSourcePart = resolveCharacterRuntimeSourcePart(node.part);
  return createSection(node.name, resolvePlacementOrder(group, node.placement), [{
    role: node.role,
    content: applyNamesBehavior(content, node.role, input, policies.namesBehavior, node.placement.kind === 'in_chat'),
    source: `character:${runtimeSourcePart}`,
    prunable: characterGovernance.prunable,
  }], characterGovernance.pinned, {
    insertion: toSectionInsertion(node.placement),
    budgetGroup: characterGovernance.budgetGroup,
  });
}

function compilePersonaNode(
  group: PromptNodeGroup,
  node: PersonaNode,
  templateEngine: TemplateEngine,
  input: PromptGraphCompilerInput,
  policies: PromptExecutionPolicy,
): IRSection | null {
  const persona = input.persona;
  if (!persona?.description) {
    return null;
  }

  const prefix = persona.name ? `The user is ${persona.name}: ` : 'The user is: ';
  const content = resolveTemplate(templateEngine, `${prefix}${persona.description}`, input.variables ?? {});
  return createSection(node.name, resolvePlacementOrder(group, node.placement), [{
    role: node.role,
    content: applyNamesBehavior(content, node.role, input, policies.namesBehavior, node.placement.kind === 'in_chat'),
    source: `prompt-graph:${node.id}`,
    prunable: false,
  }], true, {
    insertion: toSectionInsertion(node.placement),
  });
}

function compileChatHistoryNode(
  group: PromptNodeGroup,
  node: ChatHistoryNode,
  templateEngine: TemplateEngine,
  input: PromptGraphCompilerInput,
  policies: PromptExecutionPolicy,
): IRSection | null {
  const variables = input.variables ?? {};
  const historyGovernance = resolvePromptRuntimeGovernancePolicy({
    sourceKind: 'history',
    fallback: { budgetGroup: 'history', pinned: false, prunable: true },
  });
  const messages = (input.chatHistory ?? [])
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message, index) => ({
      role: message.role,
      content: applyNamesBehavior(
        resolveTemplate(templateEngine, message.content, variables),
        message.role,
        input,
        policies.namesBehavior,
        true,
      ),
      source: `prompt-graph:${node.id}:chat:${index}`,
      prunable: historyGovernance.prunable,
      priority: index,
    } satisfies IRMessage));

  return createSection(node.name, resolvePlacementOrder(group, node.placement), messages, historyGovernance.pinned, {
    semantic: 'chat_history',
    budgetGroup: historyGovernance.budgetGroup,
  });
}

function compileWorldbookNode(
  group: PromptNodeGroup,
  node: WorldbookNode,
  templateEngine: TemplateEngine,
  input: PromptGraphCompilerInput,
): IRSection | null {
  const variables = input.variables ?? {};
  const worldbookGovernance = resolvePromptRuntimeGovernancePolicy({
    sourceKind: 'worldbook',
    fallback: { budgetGroup: 'worldbook', pinned: false, prunable: true },
  });
  const messages = (input.worldbookEntries ?? [])
    .filter((entry) => {
      if ((entry.position ?? 'before') !== node.position) {
        return false;
      }
      if (node.position === 'outlet') {
        return entry.outletName === node.outletName;
      }
      if (node.position === 'depth' && node.depth !== undefined) {
        return entry.depth === node.depth;
      }
      return true;
    })
    .map((entry) => ({
      role: entry.role ?? node.role,
      content: resolveTemplate(templateEngine, entry.content, variables),
      source: `prompt-graph:${node.id}:worldbook:${entry.id}`,
      prunable: worldbookGovernance.prunable,
    } satisfies IRMessage));

  const insertion = node.position === 'depth'
    ? { kind: 'in_chat' as const, depth: node.depth ?? 0, order: 0 }
    : node.position === 'outlet' && node.placement.kind === 'anchor'
      ? findAnchorInsertion(group, node.placement)
      : toSectionInsertion(node.placement);

  return createSection(node.name, resolvePlacementOrder(group, node.placement), messages, worldbookGovernance.pinned, {
    insertion,
    budgetGroup: worldbookGovernance.budgetGroup,
  });
}

function compileExampleDialogueNode(
  group: PromptNodeGroup,
  node: ExampleDialogueNode,
  templateEngine: TemplateEngine,
  input: PromptGraphCompilerInput,
  policies: PromptExecutionPolicy,
): IRSection | null {
  const exampleDialogue = input.exampleDialogue?.trim();
  if (!exampleDialogue) {
    return null;
  }
  const exampleGovernance = resolvePromptRuntimeGovernancePolicy({
    sourceKind: 'examples',
    fallback: { budgetGroup: 'examples', pinned: false, prunable: true },
  });

  const content = resolveTemplate(templateEngine, exampleDialogue, input.variables ?? {});
  return createSection(node.name, resolvePlacementOrder(group, node.placement), [{
    role: node.role,
    content: applyNamesBehavior(content, node.role, input, policies.namesBehavior, node.placement.kind === 'in_chat'),
    source: `prompt-graph:${node.id}`,
    prunable: exampleGovernance.prunable,
  }], exampleGovernance.pinned, {
    insertion: toSectionInsertion(node.placement),
    budgetGroup: exampleGovernance.budgetGroup,
  });
}

function compileMemoryNode(
  group: PromptNodeGroup,
  node: MemoryNode,
  templateEngine: TemplateEngine,
  input: PromptGraphCompilerInput,
  policies: PromptExecutionPolicy,
): IRSection | null {
  const summary = input.memorySummary?.trim();
  if (!summary) {
    return null;
  }
  const memoryGovernance = resolvePromptRuntimeGovernancePolicy({
    sourceKind: 'memory',
    fallback: { budgetGroup: 'memory', pinned: false, prunable: false },
  });

  const content = resolveTemplate(templateEngine, `[Memory Summary]\n${summary}`, input.variables ?? {});
  return createSection(node.name, resolvePlacementOrder(group, node.placement), [{
    role: node.role,
    content: applyNamesBehavior(content, node.role, input, policies.namesBehavior, node.placement.kind === 'in_chat'),
    source: `prompt-graph:${node.id}`,
    prunable: memoryGovernance.prunable,
  }], memoryGovernance.pinned, {
    insertion: toSectionInsertion(node.placement),
    budgetGroup: memoryGovernance.budgetGroup,
  });
}

function compileToolResultNode(
  group: PromptNodeGroup,
  node: ToolResultNode,
  templateEngine: TemplateEngine,
  input: PromptGraphCompilerInput,
  policies: PromptExecutionPolicy,
): IRSection | null {
  const raw = input.toolResults?.[node.toolName]?.trim();
  if (!raw) {
    return null;
  }

  const content = resolveTemplate(templateEngine, raw, input.variables ?? {});
  return createSection(node.name, resolvePlacementOrder(group, node.placement), [{
    role: node.role,
    content: applyNamesBehavior(content, node.role, input, policies.namesBehavior, node.placement.kind === 'in_chat'),
    source: `prompt-graph:${node.id}`,
    prunable: false,
  }], true, {
    insertion: toSectionInsertion(node.placement),
  });
}

function compileContributorNode(
  group: PromptNodeGroup,
  node: ContributorNode,
  templateEngine: TemplateEngine,
  input: PromptGraphCompilerInput,
  policies: PromptExecutionPolicy,
): IRSection | null {
  const content = resolveTemplate(templateEngine, buildContributorContent(node), input.variables ?? {});
  if (!content.trim()) {
    return null;
  }

  const governance = resolvePromptRuntimeGovernancePolicy({
    sourceKind: node.sourceKind,
    fallback: { budgetGroup: `section:${node.sourceKind}`, pinned: false, prunable: false },
  });
  return createSection(buildContributorSectionName(node), resolvePlacementOrder(group, node.placement), [{
    role: node.role,
    content: applyNamesBehavior(content, node.role, input, policies.namesBehavior, node.placement.kind === 'in_chat'),
    source: node.sourceKind,
    prunable: governance.prunable,
  }], governance.pinned, {
    insertion: toSectionInsertion(node.placement),
    budgetGroup: governance.budgetGroup,
  });
}

function compileNode(
  group: PromptNodeGroup,
  node: PromptNode,
  templateEngine: TemplateEngine,
  input: PromptGraphCompilerInput,
  policies: PromptExecutionPolicy,
): IRSection | null {
  switch (node.nodeType) {
    case 'static_text':
    case 'variable_template':
      return compileStaticTextNode(group, node, templateEngine, input, policies);
    case 'marker':
      return null;
    case 'character':
      return compileCharacterNode(group, node, templateEngine, input, policies);
    case 'persona':
      return compilePersonaNode(group, node, templateEngine, input, policies);
    case 'chat_history':
      return compileChatHistoryNode(group, node, templateEngine, input, policies);
    case 'worldbook':
      return compileWorldbookNode(group, node, templateEngine, input);
    case 'example_dialogue':
      return compileExampleDialogueNode(group, node, templateEngine, input, policies);
    case 'memory':
      return compileMemoryNode(group, node, templateEngine, input, policies);
    case 'tool_result':
      return compileToolResultNode(group, node, templateEngine, input, policies);
    case 'contributor':
      return compileContributorNode(group, node, templateEngine, input, policies);
  }
}

export function compilePromptGraph(
  document: PromptGraphDocument,
  input: PromptGraphCompilerInput,
): PromptIR {
  const group = findGroup(document, document.rootGroupId);
  const templateEngine = new TemplateEngine();
  const intent = input.intent ?? DEFAULT_TRIGGER;

  const sections = group.nodes
    .filter((node) => shouldIncludeNode(node, intent))
    .map((node) => compileNode(group, node, templateEngine, input, document.policies))
    .filter((section): section is IRSection => section !== null);

  if (intent === 'continue' && document.policies.continueNudgePrompt?.trim()) {
    const continueSection = createSection(
      'continueNudge',
      sections.reduce((max, section) => Math.max(max, section.order), 0) + 1,
      [{
        role: 'system',
        content: document.policies.continueNudgePrompt.trim(),
        source: 'prompt-graph:continue-nudge',
        prunable: false,
      }],
    );

    if (continueSection) {
      sections.push(continueSection);
    }
  }

  sections.sort((left, right) => left.order - right.order);

  return {
    sections,
    metadata: {
      maxTokens: input.maxTokens,
      reservedForReply: input.reservedForReply,
      tokenizer: input.tokenCounter?.name,
    },
  };
}

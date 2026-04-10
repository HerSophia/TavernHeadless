import type { PromptIR, IRSection, IRMessage, ChatRole, PromptRunIntent } from '@tavern/core';
import type { STPreset, STPromptEntry } from './types/preset.js';
import type { STWorldBookEntry } from './types/worldbook.js';
import type { TriggerResult } from './worldbook/trigger-engine.js';
import { WI_ROLE } from './types/worldbook.js';

export interface CompatAssemblerInput {
  preset: STPreset;
  worldBookResults?: TriggerResult;
  chatHistory: { role: 'user' | 'assistant'; content: string }[];
  characterDescription?: string;
  characterPersonality?: string;
  scenario?: string;
  exampleDialogue?: string;
  personaDescription?: string;
  variables?: Record<string, unknown>;
  intent?: PromptRunIntent;
  namesBehavior?: 'off' | 'always';
  userName?: string;
  assistantName?: string;
  macroRuntime?: (args: {
    phase: 'assemble';
    values: Record<string, string>;
    sampleText: string;
  }) => { text: string };
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function renderTemplate(
  text: string,
  variables: Record<string, unknown>,
  macroRuntime?: CompatAssemblerInput['macroRuntime'],
): string {
  if (!text) return text;

  // compat 主链路的模板文本应优先走 st-macros/runtime。
  // 这里保留的本地 {{key}} 替换只作为最小兼容 fallback，
  // 用于缺少 macroRuntime 的旧调用方，不应再承担主语义来源。

  const hasTemplateMarkers = text.includes('{{') && text.includes('}}');
  if (!hasTemplateMarkers) {
    return text;
  }

  const stringValues = Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [key, valueToString(value)]),
  );

  if (macroRuntime) {
    return macroRuntime({
      phase: 'assemble',
      values: stringValues,
      sampleText: text,
    }).text;
  }

  return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return valueToString(variables[key]);
    }

    return `{{${key}}}`;
  });
}

function wiRoleToChatRole(role: number): ChatRole {
  switch (role) {
    case WI_ROLE.USER:
      return 'user';
    case WI_ROLE.ASSISTANT:
      return 'assistant';
    default:
      return 'system';
  }
}

function shouldIncludePromptEntry(promptEntry: STPromptEntry | undefined, intent: PromptRunIntent): boolean {
  if (!promptEntry?.behavior?.triggers || promptEntry.behavior.triggers.length === 0) {
    return true;
  }

  return promptEntry.behavior.triggers.includes(intent);
}

function toInsertion(promptEntry: STPromptEntry | undefined): IRSection['insertion'] | undefined {
  const placement = promptEntry?.behavior?.placement;
  if (!placement || placement.kind !== 'in_chat') {
    return undefined;
  }

  return {
    kind: 'in_chat',
    depth: placement.depth,
    order: placement.order,
  };
}

function applyNamesBehavior(
  content: string,
  role: ChatRole,
  namesBehavior: 'off' | 'always',
  userName?: string,
  assistantName?: string,
): string {
  if (namesBehavior !== 'always' || content.trim().length === 0) {
    return content;
  }

  if (role === 'user') {
    const name = userName?.trim() || 'User';
    return content.startsWith(`${name}: `) ? content : `${name}: ${content}`;
  }

  if (role === 'assistant') {
    const name = assistantName?.trim() || 'Assistant';
    return content.startsWith(`${name}: `) ? content : `${name}: ${content}`;
  }

  return content;
}

function worldBookEntriesToMessages(
  entries: STWorldBookEntry[],
  wiFormat: string,
  variables: Record<string, unknown>,
  macroRuntime?: CompatAssemblerInput['macroRuntime'],
): IRMessage[] {
  if (entries.length === 0) return [];

  const messages: IRMessage[] = [];
  for (const entry of entries) {
    const content = renderTemplate(
      wiFormat.replace('{0}', entry.content),
      variables,
      macroRuntime,
    );
    if (content.trim()) {
      messages.push({
        role: 'system',
        content,
        source: `worldbook:${entry.uid}`,
        prunable: false,
      });
    }
  }
  return messages;
}

function makePromptSection(args: {
  name: string;
  order: number;
  content?: string;
  variables: Record<string, unknown>;
  source?: string;
  role?: ChatRole;
  pinned?: boolean;
  insertion?: IRSection['insertion'];
  semantic?: IRSection['semantic'];
  namesBehavior?: 'off' | 'always';
  userName?: string;
  assistantName?: string;
  macroRuntime?: CompatAssemblerInput['macroRuntime'];
}): IRSection | null {
  if (!args.content?.trim()) return null;
  const rendered = renderTemplate(args.content, args.variables, args.macroRuntime);
  if (!rendered.trim()) return null;

  const role = args.role ?? 'system';
  const finalContent = args.insertion?.kind === 'in_chat'
    ? applyNamesBehavior(rendered, role, args.namesBehavior ?? 'off', args.userName, args.assistantName)
    : rendered;

  return {
    name: args.name,
    order: args.order,
    pinned: args.pinned ?? true,
    ...(args.insertion ? { insertion: args.insertion } : {}),
    ...(args.semantic ? { semantic: args.semantic } : {}),
    messages: [{
      role,
      content: finalContent,
      source: args.source ?? args.name,
      prunable: false,
    }],
  };
}

function getPromptEntry(preset: STPreset, identifier: string): STPromptEntry | undefined {
  return preset.prompts.find((entry) => entry.identifier === identifier);
}

function resolveOutletSectionPlacement(
  preset: STPreset,
  outletName: string,
  fallbackOrder: number,
): {
  order: number;
  insertion?: IRSection['insertion'];
} {
  const promptOrderIndex = preset.promptOrder.indexOf(outletName);
  const promptEntry = getPromptEntry(preset, outletName);
  const placement = promptEntry?.behavior?.placement;

  return {
    order: promptOrderIndex >= 0 ? promptOrderIndex : fallbackOrder,
    ...(placement?.kind === 'in_chat'
      ? {
          insertion: {
            kind: 'in_chat' as const,
            depth: placement.depth,
            order: placement.order,
          },
        }
      : {}),
  };
}

export function assembleCompat(input: CompatAssemblerInput): PromptIR {
  const {
    preset,
    worldBookResults,
    chatHistory,
    characterDescription,
    characterPersonality,
    scenario,
    exampleDialogue,
    personaDescription,
    variables = {},
    intent = 'normal',
    namesBehavior = 'off',
    userName,
    assistantName,
    macroRuntime,
  } = input;

  const sections: IRSection[] = [];
  let orderIndex = 0;

  for (const identifier of preset.promptOrder) {
    const currentOrder = orderIndex++;
    const promptEntry = getPromptEntry(preset, identifier);
    if (!shouldIncludePromptEntry(promptEntry, intent)) {
      continue;
    }

    switch (identifier) {
      case 'main':
      case 'nsfw':
      case 'jailbreak':
      case 'enhanceDefinitions': {
        const section = makePromptSection({
          name: identifier,
          order: currentOrder,
          content: promptEntry?.content,
          variables,
          source: `preset:${identifier}`,
          role: promptEntry?.role ?? 'system',
          insertion: toInsertion(promptEntry),
          namesBehavior,
          userName,
          assistantName,
          macroRuntime,
        });
        if (section) sections.push(section);
        break;
      }
      case 'worldInfoBefore': {
        const entryMessages = worldBookEntriesToMessages(worldBookResults?.before ?? [], preset.wiFormat, variables, macroRuntime);
        if (entryMessages.length > 0) {
          sections.push({
            name: 'worldInfoBefore',
            order: currentOrder,
            budgetGroup: 'worldbook',
            pinned: true,
            ...(toInsertion(promptEntry) ? { insertion: toInsertion(promptEntry) } : {}),
            messages: entryMessages,
          });
        }
        break;
      }
      case 'worldInfoAfter': {
        const entryMessages = worldBookEntriesToMessages(worldBookResults?.after ?? [], preset.wiFormat, variables, macroRuntime);
        if (entryMessages.length > 0) {
          sections.push({
            name: 'worldInfoAfter',
            order: currentOrder,
            budgetGroup: 'worldbook',
            pinned: true,
            ...(toInsertion(promptEntry) ? { insertion: toInsertion(promptEntry) } : {}),
            messages: entryMessages,
          });
        }
        break;
      }
      case 'charDescription': {
        const section = makePromptSection({
          name: 'charDescription',
          order: currentOrder,
          content: characterDescription,
          variables,
          role: promptEntry?.role ?? 'system',
          insertion: toInsertion(promptEntry),
          namesBehavior,
          userName,
          assistantName,
          macroRuntime,
        });
        if (section) sections.push(section);
        break;
      }
      case 'charPersonality': {
        const section = makePromptSection({
          name: 'charPersonality',
          order: currentOrder,
          content: characterPersonality,
          variables,
          role: promptEntry?.role ?? 'system',
          insertion: toInsertion(promptEntry),
          namesBehavior,
          userName,
          assistantName,
          macroRuntime,
        });
        if (section) sections.push(section);
        break;
      }
      case 'scenario': {
        const section = makePromptSection({
          name: 'scenario',
          order: currentOrder,
          content: scenario,
          variables,
          role: promptEntry?.role ?? 'system',
          insertion: toInsertion(promptEntry),
          namesBehavior,
          userName,
          assistantName,
          macroRuntime,
        });
        if (section) sections.push(section);
        break;
      }
      case 'personaDescription': {
        const section = makePromptSection({
          name: 'personaDescription',
          order: currentOrder,
          content: personaDescription,
          variables,
          role: promptEntry?.role ?? 'system',
          insertion: toInsertion(promptEntry),
          namesBehavior,
          userName,
          assistantName,
          macroRuntime,
        });
        if (section) sections.push(section);
        break;
      }
      case 'dialogueExamples': {
        const section = makePromptSection({
          name: 'dialogueExamples',
          order: currentOrder,
          content: exampleDialogue,
          variables,
          role: promptEntry?.role ?? 'system',
          insertion: toInsertion(promptEntry),
          namesBehavior,
          userName,
          assistantName,
          macroRuntime,
        });
        if (section) sections.push(section);
        break;
      }
      case 'chatHistory': {
        // chatHistory 保持显式语义：不在 compat assembler 内展开宏。
        // 如需展开，应由上游先统一进入 st-macros/runtime，再传入已定稿文本。

        sections.push({
          name: 'chatHistory',
          order: currentOrder,
          budgetGroup: 'history',
          pinned: false,
          semantic: 'chat_history',
          messages: chatHistory.map((message, index) => ({
            role: message.role,
            content: applyNamesBehavior(message.content, message.role, namesBehavior, userName, assistantName),
            source: `history:${index}`,
            prunable: true,
            priority: index,
          })),
        });
        break;
      }
      default: {
        const promptEntrySection = makePromptSection({
          name: identifier,
          order: currentOrder,
          content: promptEntry?.content,
          variables,
          source: `preset:${identifier}`,
          role: promptEntry?.role ?? 'system',
          insertion: toInsertion(promptEntry),
          namesBehavior,
          userName,
          assistantName,
          macroRuntime,
        });
        if (promptEntrySection) sections.push(promptEntrySection);
        break;
      }
    }
  }

  if (worldBookResults?.atDepth.length) {
    for (const depthEntry of worldBookResults.atDepth) {
      sections.push({
        name: `worldInfoDepth:${depthEntry.depth}`,
        order: orderIndex++,
        budgetGroup: 'worldbook',
        pinned: true,
        insertion: {
          kind: 'in_chat',
          depth: depthEntry.depth,
          order: depthEntry.entry.order,
        },
        messages: [{
          role: wiRoleToChatRole(depthEntry.entry.position),
          content: renderTemplate(depthEntry.entry.content, variables, macroRuntime),
          source: `worldbook:${depthEntry.entry.uid}`,
          prunable: false,
        }],
      });
    }
  }

  const outletEntries = worldBookResults?.outletEntries ?? {};
  for (const [outletName, entries] of Object.entries(outletEntries)) {
    const placement = resolveOutletSectionPlacement(preset, outletName, orderIndex++);
    sections.push({
      name: `worldInfoOutlet:${outletName}`,
      order: placement.order,
      budgetGroup: 'worldbook',
      pinned: true,
      ...(placement.insertion ? { insertion: placement.insertion } : {}),
      messages: entries.map((entry) => ({
        role: 'system',
        content: renderTemplate(entry.content, variables, macroRuntime),
        source: `worldbook:${entry.uid}`,
        prunable: false,
      })),
    });
  }

  return {
    sections,
    metadata: {
      maxTokens: preset.maxContext,
      reservedForReply: preset.maxTokens,
    },
  };
}

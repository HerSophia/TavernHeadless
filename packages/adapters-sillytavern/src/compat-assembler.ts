import type { PromptIR, IRSection, IRMessage, ChatRole, PromptRunIntent } from '@tavern/core';
import type { STPreset, STPromptEntry } from './types/preset.js';
import type { STWorldBookEntry } from './types/worldbook.js';
import type { TriggerResult } from './worldbook/trigger-engine.js';
import { WI_ROLE } from './types/worldbook.js';

// ── 公开类型 ──────────────────────────────────────────

/** compat_strict 编排器的输入 */
export interface CompatAssemblerInput {
  /** 酒馆预设 */
  preset: STPreset;
  /** 世界书触发结果（可选） */
  worldBookResults?: TriggerResult;
  /** 聊天历史（从旧到新） */
  chatHistory: { role: 'user' | 'assistant'; content: string }[];
  /** 角色描述 */
  characterDescription?: string;
  /** 角色个性 */
  characterPersonality?: string;
  /** 场景描述 */
  scenario?: string;
  /** 示例对话 */
  exampleDialogue?: string;
  /** 用户人设描述 */
  personaDescription?: string;
  /** 模板变量（{{char}}, {{user}} 等） */
  variables?: Record<string, unknown>;
  /** 运行意图 */
  intent?: PromptRunIntent;
  /** 名称行为最小策略 */
  namesBehavior?: 'off' | 'always';
  /** 用户显示名 */
  userName?: string;
  /** 助手显示名 */
  assistantName?: string;
}

// ── 内部工具 ──────────────────────────────────────────

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** 简易模板渲染：替换 {{key}} */
function renderTemplate(text: string, variables: Record<string, unknown>): string {
  if (!text) return text;
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
): IRMessage[] {
  if (entries.length === 0) return [];

  const messages: IRMessage[] = [];
  for (const entry of entries) {
    const content = renderTemplate(
      wiFormat.replace('{0}', entry.content),
      variables,
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
}): IRSection | null {
  if (!args.content?.trim()) return null;
  const rendered = renderTemplate(args.content, args.variables);
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

// ── 主函数 ────────────────────────────────────────────

/**
 * compat_strict 编排器：将酒馆预设 + 世界书 + 聊天历史组装成 PromptIR。
 */
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
        });
        if (section) sections.push(section);
        break;
      }
      case 'worldInfoBefore': {
        const entryMessages = worldBookEntriesToMessages(worldBookResults?.before ?? [], preset.wiFormat, variables);
        if (entryMessages.length > 0) {
          sections.push({
            name: 'worldInfoBefore',
            order: currentOrder,
            pinned: true,
            ...(toInsertion(promptEntry) ? { insertion: toInsertion(promptEntry) } : {}),
            messages: entryMessages,
          });
        }
        break;
      }
      case 'worldInfoAfter': {
        const entryMessages = worldBookEntriesToMessages(worldBookResults?.after ?? [], preset.wiFormat, variables);
        if (entryMessages.length > 0) {
          sections.push({
            name: 'worldInfoAfter',
            order: currentOrder,
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
        });
        if (section) sections.push(section);
        break;
      }
      case 'dialogueExamples': {
        if (exampleDialogue?.trim()) {
          const fullContent = `${preset.newExampleChatPrompt}\n${renderTemplate(exampleDialogue, variables)}`;
          sections.push({
            name: 'dialogueExamples',
            order: currentOrder,
            pinned: true,
            ...(toInsertion(promptEntry) ? { insertion: toInsertion(promptEntry) } : {}),
            messages: [{
              role: promptEntry?.role ?? 'system',
              content: fullContent,
              source: 'dialogueExamples',
              prunable: false,
            }],
          });
        }
        break;
      }
      case 'chatHistory': {
        const messages: IRMessage[] = [];

        if (preset.newChatPrompt) {
          messages.push({
            role: 'system',
            content: preset.newChatPrompt,
            source: 'newChatPrompt',
            prunable: false,
          });
        }

        for (let i = 0; i < chatHistory.length; i++) {
          const msg = chatHistory[i]!;
          messages.push({
            role: msg.role,
            content: applyNamesBehavior(
              renderTemplate(msg.content, variables),
              msg.role,
              namesBehavior,
              userName,
              assistantName,
            ),
            source: `chat:${i}`,
            prunable: true,
            priority: i,
          });
        }

        sections.push({
          name: 'chatHistory',
          order: currentOrder,
          pinned: false,
          semantic: 'chat_history',
          messages,
        });
        break;
      }
      default: {
        if (promptEntry && !promptEntry.marker && promptEntry.content?.trim()) {
          const section = makePromptSection({
            name: identifier,
            order: currentOrder,
            content: promptEntry.content,
            variables,
            source: `preset:${identifier}`,
            role: promptEntry.role ?? 'system',
            insertion: toInsertion(promptEntry),
            namesBehavior,
            userName,
            assistantName,
          });
          if (section) sections.push(section);
        }
        break;
      }
    }
  }

  if (worldBookResults?.atDepth && worldBookResults.atDepth.length > 0) {
    for (const depthEntry of worldBookResults.atDepth) {
      const content = renderTemplate(
        preset.wiFormat.replace('{0}', depthEntry.entry.content),
        variables,
      );
      if (!content.trim()) continue;

      sections.push({
        name: `worldInfoDepth:${depthEntry.depth}`,
        order: 1000 + depthEntry.depth,
        pinned: true,
        insertion: {
          kind: 'in_chat',
          depth: depthEntry.depth,
          order: depthEntry.entry.order,
        },
        messages: [{
          role: wiRoleToChatRole(depthEntry.role),
          content,
          source: `worldbook:${depthEntry.entry.uid}@depth${depthEntry.depth}`,
          prunable: false,
        }],
      });
    }
  }

  const outletEntries = Object.entries(worldBookResults?.outletEntries ?? {});
  if (outletEntries.length > 0) {
    let fallbackOrder = sections.reduce((max, section) => Math.max(max, section.order), 0) + 1;
    for (const [outletName, entries] of outletEntries) {
      const entryMessages = worldBookEntriesToMessages(entries, preset.wiFormat, variables);
      if (entryMessages.length === 0) {
        continue;
      }

      const placement = resolveOutletSectionPlacement(preset, outletName, fallbackOrder++);
      sections.push({
        name: `worldInfoOutlet:${outletName}`,
        order: placement.order,
        pinned: true,
        ...(placement.insertion ? { insertion: placement.insertion } : {}),
        messages: entryMessages,
      });
    }
  }

  if (intent === 'continue' && preset.continueNudgePrompt.trim()) {
    const section = makePromptSection({
      name: 'continueNudge',
      order: sections.reduce((max, section) => Math.max(max, section.order), 0) + 1,
      content: preset.continueNudgePrompt,
      variables,
      source: 'continueNudgePrompt',
      role: 'system',
    });
    if (section) sections.push(section);
  }

  return {
    sections,
    metadata: {
      maxTokens: preset.maxContext,
      reservedForReply: preset.maxTokens,
    },
  };
}

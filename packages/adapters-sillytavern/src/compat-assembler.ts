import type { PromptIR, IRSection, IRMessage, ChatRole } from '@tavern/core';
import type { STPreset, STPromptEntry } from './types/preset.js';
import type { STWorldBookEntry } from './types/worldbook.js';
import type { TriggerResult, DepthEntry } from './worldbook/trigger-engine.js';
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

/** 将世界书 role 数字转为 ChatRole */
function wiRoleToChatRole(role: number): ChatRole {
  switch (role) {
    case WI_ROLE.USER: return 'user';
    case WI_ROLE.ASSISTANT: return 'assistant';
    default: return 'system';
  }
}

/** 将世界书条目转为 IR 消息 */
function worldBookEntriesToMessages(
  entries: STWorldBookEntry[],
  wiFormat: string,
  variables: Record<string, unknown>,
): IRMessage[] {
  if (entries.length === 0) return [];

  // 合并所有条目的 content，按 wiFormat 格式化
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

/** 创建一个包含单条系统消息的 section（如果 content 非空） */
function makeSystemSection(
  name: string,
  order: number,
  content: string | undefined,
  variables: Record<string, unknown>,
  source?: string,
): IRSection | null {
  if (!content?.trim()) return null;
  const rendered = renderTemplate(content, variables);
  if (!rendered.trim()) return null;

  return {
    name,
    order,
    pinned: true,
    messages: [{
      role: 'system',
      content: rendered,
      source: source ?? name,
      prunable: false,
    }],
  };
}

/** 查找预设中的 prompt entry 并获取 content */
function getPromptContent(preset: STPreset, identifier: string): string | undefined {
  const entry = preset.prompts.find(p => p.identifier === identifier);
  return entry?.content;
}

// ── 主函数 ────────────────────────────────────────────

/**
 * compat_strict 编排器：将酒馆预设 + 世界书 + 聊天历史组装成 PromptIR。
 *
 * 按照 preset.promptOrder 的顺序创建 IRSection，严格复刻酒馆的
 * prompt_order 拼装逻辑。
 *
 * ## 支持的 identifier
 *
 * | identifier | 内容来源 |
 * |---|---|
 * | `main` | preset.prompts[main].content |
 * | `worldInfoBefore` | worldBookResults.before |
 * | `charDescription` | characterDescription |
 * | `charPersonality` | characterPersonality |
 * | `scenario` | scenario |
 * | `personaDescription` | personaDescription |
 * | `nsfw` / `enhanceDefinitions` | preset.prompts 中的内容 |
 * | `worldInfoAfter` | worldBookResults.after |
 * | `dialogueExamples` | exampleDialogue |
 * | `chatHistory` | chatHistory |
 * | `jailbreak` | preset.prompts[jailbreak].content |
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
  } = input;

  const sections: IRSection[] = [];
  let orderIndex = 0;

  // 遍历 promptOrder 创建各 section
  for (const identifier of preset.promptOrder) {
    const currentOrder = orderIndex++;

    switch (identifier) {
      // ── 预设提示词 sections ──
      case 'main':
      case 'nsfw':
      case 'jailbreak':
      case 'enhanceDefinitions': {
        const content = getPromptContent(preset, identifier);
        const section = makeSystemSection(identifier, currentOrder, content, variables, `preset:${identifier}`);
        if (section) sections.push(section);
        break;
      }

      // ── 世界书 before ──
      case 'worldInfoBefore': {
        const entries = worldBookResults?.before ?? [];
        const messages = worldBookEntriesToMessages(entries, preset.wiFormat, variables);
        if (messages.length > 0) {
          sections.push({
            name: 'worldInfoBefore',
            order: currentOrder,
            pinned: true,
            messages,
          });
        }
        break;
      }

      // ── 世界书 after ──
      case 'worldInfoAfter': {
        const entries = worldBookResults?.after ?? [];
        const messages = worldBookEntriesToMessages(entries, preset.wiFormat, variables);
        if (messages.length > 0) {
          sections.push({
            name: 'worldInfoAfter',
            order: currentOrder,
            pinned: true,
            messages,
          });
        }
        break;
      }

      // ── 角色信息 sections ──
      case 'charDescription': {
        const section = makeSystemSection('charDescription', currentOrder, characterDescription, variables);
        if (section) sections.push(section);
        break;
      }

      case 'charPersonality': {
        const section = makeSystemSection('charPersonality', currentOrder, characterPersonality, variables);
        if (section) sections.push(section);
        break;
      }

      case 'scenario': {
        const section = makeSystemSection('scenario', currentOrder, scenario, variables);
        if (section) sections.push(section);
        break;
      }

      case 'personaDescription': {
        const section = makeSystemSection('personaDescription', currentOrder, personaDescription, variables);
        if (section) sections.push(section);
        break;
      }

      // ── 示例对话 ──
      case 'dialogueExamples': {
        if (exampleDialogue?.trim()) {
          const fullContent = `${preset.newExampleChatPrompt}\n${renderTemplate(exampleDialogue, variables)}`;
          sections.push({
            name: 'dialogueExamples',
            order: currentOrder,
            pinned: true,
            messages: [{
              role: 'system',
              content: fullContent,
              source: 'dialogueExamples',
              prunable: false,
            }],
          });
        }
        break;
      }

      // ── 聊天历史 ──
      case 'chatHistory': {
        const messages: IRMessage[] = [];

        // 新对话标记
        if (preset.newChatPrompt) {
          messages.push({
            role: 'system',
            content: preset.newChatPrompt,
            source: 'newChatPrompt',
            prunable: false,
          });
        }

        // 聊天消息（从旧到新）
        for (let i = 0; i < chatHistory.length; i++) {
          const msg = chatHistory[i]!;
          messages.push({
            role: msg.role,
            content: renderTemplate(msg.content, variables),
            source: `chat:${i}`,
            prunable: true,
            priority: i, // 旧消息优先被裁剪
          });
        }

        sections.push({
          name: 'chatHistory',
          order: currentOrder,
          pinned: false,
          messages,
        });
        break;
      }

      // ── 其他自定义 prompt entries ──
      default: {
        const promptEntry = preset.prompts.find(p => p.identifier === identifier);
        if (promptEntry && !promptEntry.marker && promptEntry.content?.trim()) {
          const section = makeSystemSection(
            identifier,
            currentOrder,
            promptEntry.content,
            variables,
            `preset:${identifier}`,
          );
          if (section) sections.push(section);
        }
        break;
      }
    }
  }

  // ── @depth 条目注入 ──
  if (worldBookResults?.atDepth && worldBookResults.atDepth.length > 0) {
    for (const depthEntry of worldBookResults.atDepth) {
      const content = renderTemplate(
        preset.wiFormat.replace('{0}', depthEntry.entry.content),
        variables,
      );
      if (!content.trim()) continue;

      sections.push({
        name: `worldInfoDepth:${depthEntry.depth}`,
        order: 1000 + depthEntry.depth, // 放在最后，由 MessageBuilder 处理 depth 插入
        pinned: true,
        messages: [{
          role: wiRoleToChatRole(depthEntry.role),
          content,
          source: `worldbook:${depthEntry.entry.uid}@depth${depthEntry.depth}`,
          prunable: false,
        }],
      });
    }
  }

  return {
    sections,
    metadata: {
      maxTokens: preset.maxContext,
      reservedForReply: preset.maxTokens,
    },
  };
}

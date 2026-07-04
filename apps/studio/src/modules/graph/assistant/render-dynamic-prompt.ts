/**
 * 动态提示词渲染（图助手 · 提示词阶段二）。
 *
 * 纯函数：把收集到的上下文数据块渲染成一段「本回合动态上下文文本」，随 respond 注入。
 *
 * 两条路径：
 * - 用户未写模板（留空 / 纯空白）：走内置默认模板，按固定顺序把所有已开启且非空的数据块
 *   拼起来，每块带一个小标题。用户只动 context 页开关即可见效。
 *- 用户写了模板：按模板渲染，占位符 `{{key}}` 替换为对应块文本。空值降级：含「无对应数据」
 *   占位符的整行省略，不把 `{{selection}}` 原样发出去。
 */
import {
  CONTEXT_BLOCK_KEYS,
  CONTEXT_BLOCK_PLACEHOLDER,
  type ContextBlockKey,
} from "./context-config";
import type { ContextBlocks } from"./collect-context-blocks";

/** 数据块键 → 默认模板里的中文小标题。 */
const DEFAULT_BLOCK_HEADING: Record<ContextBlockKey, string> = {
  graphSummary: "【图结构概要】",
  selection: "【当前选中】",
  graphVersion: "【图版本】",
  diagnostics: "【诊断信息】",
  projectMeta: "【项目元信息】",
};

/** 占位符 token → 数据块键的反查表。 */
const PLACEHOLDER_TO_KEY: Record<string, ContextBlockKey> = Object.fromEntries(
  CONTEXT_BLOCK_KEYS.map((key) => [CONTEXT_BLOCK_PLACEHOLDER[key],key]),
) as Record<string, ContextBlockKey>;

/** 匹配 `{{ token }}` 占位符（容忍内部空白）。 */
const PLACEHOLDER_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/** 内置默认模板：按固定顺序拼接所有非空块，每块「小标题 + 内容」。 */
function renderDefaultTemplate(blocks: ContextBlocks): string {
  const sections: string[] = [];
  for (const key of CONTEXT_BLOCK_KEYS) {
    const content = blocks[key];
    if (content && content.trim().length > 0) {
      sections.push(`${DEFAULT_BLOCK_HEADING[key]}\n${content.trim()}`);
    }
  }
  return sections.join("\n\n");
}

/**
 *用户模板渲染：逐行处理。
 *
 * 对每一行：
 * - 找出该行所有占位符。
 * - 若存在「无对应数据」的占位符（块缺席或为空），整行省略（空值降级）。
 * - 否则把占位符替换为块文本，保留该行。
 * - 无占位符的行原样保留。
 */
function renderUserTemplate(template: string, blocks: ContextBlocks): string {
  const lines = template.split("\n");
  const kept: string[] = [];
  for(const line of lines) {
    const tokens = [...line.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]!);
    if (tokens.length === 0) {
      kept.push(line);
      continue;
    }
    const hasMissing = tokens.some((token) => {
      const key = PLACEHOLDER_TO_KEY[token];
      const value = key ? blocks[key] : undefined;
      return !value || value.trim().length === 0;
    });
    if (hasMissing) {
      // 含无对应数据的占位符：整行省略，避免把原始占位符发出去。
      continue;
    }
    const replaced = line.replace(PLACEHOLDER_PATTERN, (whole, token: string) => {
      const key = PLACEHOLDER_TO_KEY[token];
      const value = key ?blocks[key] : undefined;
      return value ? value.trim() : whole;
    });
    kept.push(replaced);
  }
  return kept.join("\n").trim();
}

/**
 * 渲染本回合动态上下文文本。
 *
 * @param blocks 已收集的数据块（仅含开启且非空的块）。
 * @param template 用户动态模板；留空 / 纯空白时走内置默认模板。
 * @returns 最终注入文本；无任何内容时返回空串（调用方据此判断是否注入）。
 */
export function renderDynamicPrompt(blocks: ContextBlocks, template?: string | null): string {
  const trimmedTemplate = template?.trim();
  if (!trimmedTemplate) {
    return renderDefaultTemplate(blocks).trim();
  }
  return renderUserTemplate(trimmedTemplate, blocks);
}

import type { VariableEntry } from '@tavern/shared';
import type { VariableContext } from '../types.js';
import type { VariableResolver } from '../variables/resolver/variable-resolver.js';

/**
 * 模板渲染选项
 */
export interface TemplateOptions {
  /**
   * 未找到变量时的行为：
   * - `'keep'`（默认）：保留原始 `{{name}}` 占位符
   * - `'empty'`：替换为空字符串
   * - `'error'`：抛出错误
   */
  undefinedBehavior?: 'keep' | 'empty' | 'error';
}

/**
 * 匹配 `{{variable_name}}` 或 `{{variable_name:default_value}}`
 * 支持空格容错：`{{ name }}` `{{ name : default }}`
 */
const TEMPLATE_REGEX = /\{\{\s*([^{}:]+?)\s*(?::\s*([^{}]*?)\s*)?\}\}/g;

/**
 * 将变量值转为字符串
 */
function valueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * 模板引擎
 *
 * 支持 `{{variable_name}}` 和 `{{variable_name:default_value}}` 语法。
 * 兼容酒馆风格的双花括号占位符。
 */
export class TemplateEngine {
  /**
   * 同步渲染：使用预解析的变量 Map
   */
  render(
    template: string,
    variables: Map<string, unknown>,
    options?: TemplateOptions
  ): string {
    const behavior = options?.undefinedBehavior ?? 'keep';

    return template.replace(TEMPLATE_REGEX, (match, name: string, defaultValue?: string) => {
      const key = name.trim();

      if (variables.has(key)) {
        return valueToString(variables.get(key));
      }

      // 有默认值时使用默认值
      if (defaultValue !== undefined) {
        return defaultValue.trim();
      }

      // 未找到变量
      switch (behavior) {
        case 'empty':
          return '';
        case 'error':
          throw new TemplateVariableError(key, template);
        case 'keep':
        default:
          return match;
      }
    });
  }

  /**
   * 异步渲染：使用 VariableResolver 实时查询
   *
   * 先提取所有变量名，批量解析后再同步渲染。
   */
  async renderAsync(
    template: string,
    resolver: VariableResolver,
    context: VariableContext,
    options?: TemplateOptions
  ): Promise<string> {
    const names = this.extractVariableNames(template);

    if (names.length === 0) return template;

    const resolved = await resolver.resolveMany(names, context);

    // 将 VariableEntry Map 转为 value Map
    const variables = new Map<string, unknown>();
    for (const [key, entry] of resolved) {
      variables.set(key, entry.value);
    }

    return this.render(template, variables, options);
  }

  /**
   * 提取模板中的所有变量名（去重）
   */
  extractVariableNames(template: string): string[] {
    const names = new Set<string>();
    let match: RegExpExecArray | null;

    // 创建新正则避免共享 lastIndex 状态
    const regex = new RegExp(TEMPLATE_REGEX.source, TEMPLATE_REGEX.flags);

    while ((match = regex.exec(template)) !== null) {
      const name = match[1]?.trim();
      if (name) names.add(name);
    }

    return [...names];
  }
}

/**
 * 模板变量未找到错误
 */
export class TemplateVariableError extends Error {
  constructor(
    public readonly variableName: string,
    public readonly template: string
  ) {
    super(`Template variable "${variableName}" is not defined`);
    this.name = 'TemplateVariableError';
  }
}

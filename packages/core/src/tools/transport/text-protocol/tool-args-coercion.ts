import type { ToolParameterSchema } from '../../types.js';

/** 整数 / 小数字符串的判定（允许前导负号、可选小数部分）。 */
const NUMERIC_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * 按单个参数的声明类型，对字符串值做精确类型还原。
 *
 * 只在以下精确场景转换，其余一律原样返回：
 * - `boolean`：字符串恰为 `"true"` / `"false"`。
 * - `number` / `integer`：字符串匹配 `^-?\d+(\.\d+)?$` 且转换结果有限；
 *   `integer` 还要求转换结果为整数。
 * - `array`：字符串能 `JSON.parse` 且结果是数组。
 */
function coerceScalar(value: string, declaredType: string): unknown {
  if (declaredType === 'boolean') {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return value;
  }

  if (declaredType === 'number' || declaredType === 'integer') {
    if (!NUMERIC_STRING_PATTERN.test(value)) {
      return value;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return value;
    }
    if (declaredType === 'integer' && !Number.isInteger(parsed)) {
      return value;
    }
    return parsed;
  }

  if (declaredType === 'array') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      //非合法 JSON，保持原字符串，交由后续校验处理。
    }
    return value;
  }

  return value;
}

/**
 * text_protocol 工具调用参数的执行前类型容错。
 *
 * 文本协议下模型只能输出字符串化的 JSON，部分模型（尤其是 Claude）会把布尔、
 *数字、数组也写成带引号的字符串，导致工具执行因类型不符而失败。本函数依据工具
 * 声明的参数 schema，把这些「形似目标类型的字符串」精确还原为对应类型。
 *
 * 约束：
 * - 只处理顶层参数，不递归进入嵌套对象或数组元素。
 * - 只在类型精确匹配时转换（见 {@link coerceScalar}），其余原样保留。
 * - 不在 native function calling 路径使用；该路径由 SDK 负责类型化。
 *
 * @param args - 解析得到的顶层参数对象。
 * @param parameters - 工具声明的参数 schema；缺失时不做任何转换。
 * @returns 若发生任何转换则返回新对象；否则返回传入的原引用。
 */
export function coerceTextProtocolToolArgs(
  args: Record<string, unknown>,
  parameters?: ToolParameterSchema,
): Record<string, unknown> {
  const properties = parameters?.properties;
  if (!properties) {
    return args;
  }

  let changed = false;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    const declaredType = properties[key]?.type;
    if (typeof value === 'string' && typeof declaredType === 'string') {
      const coerced = coerceScalar(value, declaredType);
      if (coerced !== value) {
        changed = true;
      }
      result[key] = coerced;
    } else {
      result[key] = value;
    }
  }

  return changed ? result : args;
}

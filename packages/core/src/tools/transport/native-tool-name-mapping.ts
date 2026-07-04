//── native function calling 工具名清洗与还原 ──────────────────────

/**
 * OpenAI 等 provider 对 function name 有格式约束：只允许 [a-zA-Z0-9_-]，长度 1..64。
 *
 * NodeGraph 等工具名带点号（如 `nodegraph.graph.create`），原样作为 function name 会被
 * provider 拒绝（400 Bad Request）。这里把非法字符清洗成下划线后作为 schema 名，并维护
 * 反查表，使模型按清洗名调用后能还原回原始工具名。下游执行、确认、事件、transcript
 * 全部仍使用原始工具名，不受影响。
 *
 *文本协议（text_protocol）路径不需要清洗：那里工具名只是 prompt 中的纯文本，不进 provider
 * 的结构化 function 定义。本清洗只用于 native function calling 的 schema 名导出与回填。
 */

/** 合法 native function name 约束：只允许字母、数字、下划线、连字符，长度 1..64。 */
const VALID_NATIVE_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
/** 非法字符匹配（清洗时替换为下划线）。 */
const INVALID_NATIVE_TOOL_NAME_CHAR = /[^a-zA-Z0-9_-]/g;
/** provider 允许的最大 function name 长度。 */
const MAX_NATIVE_TOOL_NAME_LENGTH = 64;

/** 判断工具名是否已符合 native function name 约束。 */
export function isValidNativeToolName(name: string): boolean {
  return VALID_NATIVE_TOOL_NAME.test(name);
}

/** 把单个工具名清洗成符合约束的形式（非法字符替换为下划线，并截断到 64）。 */
function sanitizeNativeToolName(name: string): string {
  const replaced = name.replace(INVALID_NATIVE_TOOL_NAME_CHAR, "_");
  const truncated = replaced.length > MAX_NATIVE_TOOL_NAME_LENGTH
    ? replaced.slice(0, MAX_NATIVE_TOOL_NAME_LENGTH)
    : replaced;
  // 兜底：极端情况下保证非空（正常清洗保留长度，不会清空）。
  return truncated.length > 0 ? truncated : "_";
}

/** 在保证不超过 64 长度的前提下，为重名追加数字后缀。 */
function buildSuffixedName(base: string, suffix: number): string {
  const suffixText = `_${suffix}`;
  const maxBaseLength = MAX_NATIVE_TOOL_NAME_LENGTH - suffixText.length;
  const trimmedBase = base.length > maxBaseLength ? base.slice(0, maxBaseLength) : base;
  return `${trimmedBase}${suffixText}`;
}

/** native 工具名映射：原始名 ↔ provider 可接受的 schema 名。 */
export interface NativeToolNameMapping {
  /** 原始工具名 → schema 名。原名合法时返回原名。*/
  toSchemaName(originalName: string): string;
  /** schema 名 → 原始工具名。无法还原时返回输入本身。 */
  toOriginalName(schemaName: string): string;
  /** 是否发生过清洗或去重改写（用于诊断）。 */
  readonly hasRewrites: boolean;
}

/**
 * 根据一组原始工具名构建 native 工具名映射。
 *
 * 合法名保持不变；非法名清洗为下划线形式；清洗后若与已有 schema 名冲突，追加 `_2`/`_3`…
 * 后缀保持唯一。
 */
export function buildNativeToolNameMapping(names: readonly string[]): NativeToolNameMapping {
  const originalToSchema = new Map<string, string>();
  const schemaToOriginal = new Map<string, string>();
  const usedSchemaNames = new Set<string>();
  let hasRewrites = false;

  for (const original of names) {
    if (originalToSchema.has(original)) {
      continue;
    }

    let schemaName = isValidNativeToolName(original) ? original : sanitizeNativeToolName(original);
    if (schemaName !== original) {
      hasRewrites= true;
    }

    if (usedSchemaNames.has(schemaName)) {
      let suffix = 2;
      let candidate = buildSuffixedName(schemaName, suffix);
      while (usedSchemaNames.has(candidate)) {
        suffix += 1;
        candidate = buildSuffixedName(schemaName, suffix);
      }
      schemaName = candidate;
      hasRewrites = true;
    }

    usedSchemaNames.add(schemaName);
    originalToSchema.set(original, schemaName);
    schemaToOriginal.set(schemaName, original);
  }

  return {
    toSchemaName: (originalName) => originalToSchema.get(originalName) ?? originalName,
    toOriginalName: (schemaName) => schemaToOriginal.get(schemaName) ?? schemaName,
    hasRewrites,
  };
}

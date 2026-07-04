/**
 * "@" 提及的输入阶段触发判定（图助手 · 提及阶段）。
 *
 * 纯函数：根据 textarea 当前值与光标位置，判断光标处是否正在输入一个提及，
 * 并给出过滤词 query。规则见设计 §3.3：
 * - 前边界：`@` 前必须是行首或一个空白字符，避免 `foo@bar`、邮箱等误触发。
 * - 空格封口：从 `@` 到光标之间一旦出现空白，提及即封口，不再激活。
 *
 * 注意这只用于「输入候选过滤阶段」，与发送 / 渲染阶段基于解析索引的 token 识别是两回事。
 */

/** 激活中的提及查询：`@` 的起始下标（含 `@`）与其后的过滤词。 */
export interface ActiveMentionQuery {
  /** `@` 字符在文本中的下标。替换插入时从这里到光标整体替换。 */
  start: number;
  /** `@` 之后到光标之间的过滤词（不含 `@`）。 */
  query: string;
}

/** 是否为空白字符（空格、制表、换行等）。 */
function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

/**
 * 判定光标处是否正在输入一个提及。
 *
 * @param text textarea 当前完整值。
 * @param caret 光标位置（selectionStart）。
 * @returns 命中返回 {@link ActiveMentionQuery}，否则返回 null。
 */
export function findActiveMentionQuery(text: string, caret: number): ActiveMentionQuery | null {
  const pos = Math.max(0, Math.min(caret, text.length));

  // 从光标向左找最近的 `@`；中途遇到空白即封口（无激活提及）。
  for (let i = pos - 1; i >= 0; i -= 1) {
    const char = text[i]!;
    if (isWhitespace(char)) {
      return null;
    }
    if (char === "@") {
      // 前边界：`@` 前必须是行首或空白。
      const prev = i > 0 ? text[i - 1]! : "";
      if (i === 0 || isWhitespace(prev)) {
        return { start: i, query: text.slice(i + 1, pos) };
      }
      return null;
    }
  }
  return null;
}

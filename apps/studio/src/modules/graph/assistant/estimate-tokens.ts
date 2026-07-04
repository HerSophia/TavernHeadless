/**
 * 动态上下文 token 预算（图助手 · 提示词阶段四）。
 *
 * 前端不引入重型 tokenizer，只做一个粗略估算：CJK 字符按每字约 1 token，
 * 其余（ASCII / 标点 / 空白）按约 4 字符 1 token。用于「避免撑爆上下文」的预算控制，
 * 不追求与后端精确对齐。纯函数，便于单测。
 */

/** CJK 区段（粗略覆盖中日韩统一表意文字、兼容表意文字与全角符号）。 */
const CJK_PATTERN = /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** 超出预算时附加的省略提示（计入预算）。 */
const TRUNCATION_NOTICE = "\n\n……（上下文超出预算，已截断）";

/**粗略估算文本 token 数。 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK_PATTERN.test(ch)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return cjk + Math.ceil(other / 4);
}

/** 预算裁剪结果。 */
export interface TokenBudgetResult {
  /** 裁剪后的文本（未超限时与输入相同）。 */
  text: string;
  /** 裁剪后文本的估算 token 数。 */
  tokens: number;
  /** 是否发生了截断。 */
  truncated: boolean;
}

/**
 * 按 token 预算裁剪文本。
 *
 * `maxTokens < 0` 表示不限制，原样返回。超限时按字符二分截断到预算内，
 * 并在末尾追加省略提示；省略提示本身计入预算，保证结果估算不超过 `maxTokens`。
 */
export function applyTokenBudget(text: string, maxTokens: number): TokenBudgetResult {
  const tokens = estimateTokens(text);
  if (maxTokens < 0 || tokens <= maxTokens) {
    return { text, tokens, truncated: false };
  }
  const noticeTokens = estimateTokens(TRUNCATION_NOTICE);
  const budgetForBody = Math.max(0, maxTokens - noticeTokens);
  // 二分找到 token 估算不超过预算的最大字符前缀。
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(text.slice(0, mid)) <= budgetForBody) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const body = text.slice(0, lo).trimEnd();
  const composed = `${body}${TRUNCATION_NOTICE}`;
  return { text: composed, tokens: estimateTokens(composed), truncated: true };
}

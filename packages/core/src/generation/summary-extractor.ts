// ── 摘要提取器 ────────────────────────────────────────
// 从 LLM 输出中提取 <summary>...</summary> 等标签内容。
// 提取顺序：先提取摘要，再做正则后处理，避免正则把摘要标签删掉。

/** 摘要提取结果 */
export interface SummaryExtractionResult {
  /** 提取到的摘要列表 */
  summaries: string[];
  /** 去除摘要标签后的文本 */
  cleanedText: string;
}

/** 摘要提取器选项 */
export interface SummaryExtractorOptions {
  /** 要识别的标签名列表（默认：summary, 摘要, memory, 记忆, memo） */
  tagNames?: string[];
  /** 是否保留标签内容在文本中（默认 false） */
  keepInText?: boolean;
}

/** 默认识别的标签名 */
const DEFAULT_TAG_NAMES = ['summary', '摘要', 'memory', '记忆', 'memo'];

/**
 * 从文本中提取摘要标签内容。
 *
 * 支持 `<summary>内容</summary>` 格式，大小写不敏感。
 * 多个匹配都会被提取。标签可以跨多行。
 *
 * @param text - LLM 输出的原始文本
 * @param options - 提取选项
 * @returns 提取结果（摘要列表 + 清理后文本）
 *
 * @example
 * ```typescript
 * const result = extractSummaries(
 *   '故事内容...\n<summary>Alice向Bob表白</summary>\n更多内容',
 * );
 * // result.summaries = ['Alice向Bob表白']
 * // result.cleanedText = '故事内容...\n\n更多内容'
 * ```
 */
export function extractSummaries(
  text: string,
  options?: SummaryExtractorOptions,
): SummaryExtractionResult {
  const tagNames = options?.tagNames ?? DEFAULT_TAG_NAMES;
  const keepInText = options?.keepInText ?? false;

  if (!text || tagNames.length === 0) {
    return { summaries: [], cleanedText: text };
  }

  const summaries: string[] = [];
  let cleanedText = text;

  for (const tagName of tagNames) {
    // 转义标签名中的正则特殊字符
    const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 匹配 <tagName>...</tagName>，支持多行，大小写不敏感
    const regex = new RegExp(
      `<${escaped}>([\\s\\S]*?)<\\/${escaped}>`,
      'gi',
    );

    let match: RegExpExecArray | null;
    while ((match = regex.exec(cleanedText)) !== null) {
      const content = match[1]!.trim();
      if (content) {
        summaries.push(content);
      }
    }

    // 从文本中移除匹配的标签
    if (!keepInText) {
      cleanedText = cleanedText.replace(regex, '');
    }
  }

  // 清理多余空行（连续 3 个以上换行 → 2 个换行）
  if (!keepInText && summaries.length > 0) {
    cleanedText = cleanedText
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return { summaries, cleanedText };
}

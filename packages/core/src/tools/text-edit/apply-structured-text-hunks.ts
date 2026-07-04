// ── 结构化文本 hunk 匹配与应用算法 ────────────────────────────────────
//
// 纯函数实现，不依赖资源、数据库或具体载体，可被多个 provider 复用。
//
// 匹配策略按优先级分两层：
//   1. 精确唯一匹配：oldContent 在全文只出现一处时直接采用，忽略 startLine。
//   2. 重复时按 startLine + lineDelta 定位：换算到当前文本的目标行，选最接近的一处匹配。
//
// 多 hunk 顺序应用时用 lineDelta 维护行号偏移：模型给出的 startLine 基于读取时的
// 原始文本，每应用一个 hunk 会按替换前后真实换行数差累加偏移，从而把后续 hunk 的
// startLine 平移到当前文本坐标。
//
// 原子性：任一 hunk失败则整体不产出 newText，仅返回逐项诊断。

import type {
  StructuredTextHunk,
  TextHunkApplyResult,
  TextHunkOutcome,
} from "./types.js";

/**统计字符串中真实换行符的数量 */
function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      count += 1;
    }
  }
  return count;
}

/**
 * 把1-based 行号转换为字符偏移（该行起始位置）。
 *
 * 行号小于等于 1 时返回 0；超过文本总行数时返回文本长度。
 */
function lineToOffset(text: string, line: number): number {
  if (line <= 1) {
    return 0;
  }
  let seenNewlines = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      seenNewlines += 1;
      if (seenNewlines === line - 1) {
        return i + 1;
      }
    }
  }
  return text.length;
}

/** 把字符偏移转换为 1-based 行号 */
function offsetToLine(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  for (let i = 0; i < clamped; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

/** 查找 needle 在 haystack 中的所有非重叠出现位置（起始偏移） */
function findAllMatches(haystack: string, needle: string): number[] {
  const positions: number[] = [];
  if (needle.length === 0) {
    return positions;
  }
  let from = 0;
  for (;;) {
    const found = haystack.indexOf(needle, from);
    if (found === -1) {
      break;
    }
    positions.push(found);
    from = found + needle.length;
  }
  return positions;
}

/**
 * 把一组结构化 hunk顺序应用到文本上。
 *
 * @param text -当前完整文本（调用方读取到的原始内容）
 * @param hunks - 结构化 hunk 数组，按输入顺序应用
 * @returns 应用结果。`ok` 为 true 时`newText` 为应用后的完整文本；
 *          任一 hunk 失败则 `ok` 为 false、不产出 `newText`，并在 `hunks` 中逐项给出诊断。
 *
 * @example
 * ```typescript
 * const result = applyStructuredTextHunks("hello world", [
 *   { oldContent: "world", newContent: "there" },
 * ]);
 * // result.ok === true
 * // result.newText === "hello there"
 * ```
 */
export function applyStructuredTextHunks(
  text: string,
  hunks: readonly StructuredTextHunk[],
): TextHunkApplyResult {
  const outcomes: TextHunkOutcome[] = [];

  // workingText 随每个成功 hunk 的替换而变化。
  // lineDelta 表示「原始文本行号 → 当前 workingText 行号」的偏移：
  //   workingLine = originalLine + lineDelta
  let workingText = text;
  let lineDelta = 0;
  let anyFailed = false;

  for (let index = 0; index < hunks.length; index += 1) {
    const hunk = hunks[index];
    const oldContent = hunk?.oldContent ?? "";
    const newContent = hunk?.newContent ?? "";

    if (oldContent.length === 0) {
      anyFailed = true;
      outcomes.push({
        index,
        matched: false,
        reason:
          "oldContent must not be empty. Provide the exact existing text to replace.",
      });
      continue;
    }

    const matches = findAllMatches(workingText, oldContent);

    if (matches.length === 0) {
      anyFailed = true;
      outcomes.push({
        index,
        matched: false,
        reason:
          "oldContent wasnot found in the current text. The content may have changed; re-read the latest content before editing.",
      });
      continue;
    }

    let chosenStart: number;
    let matchKind: TextHunkOutcome["matchKind"];

    if (matches.length === 1) {
      // 第一层：精确唯一匹配，忽略 startLine。
      chosenStart = matches[0]!;
      matchKind = "exact";
    } else {
      // 第二层：重复匹配，需借助 startLine 定位。
      if (typeof hunk?.startLine !== "number") {
        anyFailed = true;
        const candidateLines = matches.map(
          (pos) => offsetToLine(workingText, pos) - lineDelta,
        );
        outcomes.push({
          index,
          matched: false,
          reason:
            "oldContent matched multiple locations.Provide startLine to disambiguate, or extend oldContent so it becomes unique.",
          candidateLines,
        });
        continue;
      }

      // 把基于原始文本的 startLine 平移到当前 workingText 坐标，
      // 再换算成字符偏移，选最接近该偏移的匹配。
      const targetWorkingLine = hunk.startLine + lineDelta;
      const targetOffset = lineToOffset(workingText, targetWorkingLine);

      let bestIndex = 0;
      let bestDistance = Math.abs(matches[0]! - targetOffset);
      for (let m = 1; m < matches.length; m += 1) {
        const distance = Math.abs(matches[m]! - targetOffset);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = m;
        }
      }
      chosenStart = matches[bestIndex]!;
      matchKind = "line_anchored";
    }

    const chosenEnd = chosenStart + oldContent.length;
    workingText =
      workingText.slice(0, chosenStart) +
      newContent +
      workingText.slice(chosenEnd);
    lineDelta += countNewlines(newContent) - countNewlines(oldContent);

    outcomes.push({
      index,
      matched: true,
      matchKind,
    });
  }

  if (anyFailed) {
    return {
      ok: false,
      hunks: outcomes,
    };
  }

  return {
    ok: true,
    newText: workingText,
    hunks: outcomes,
  };
}

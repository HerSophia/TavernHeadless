// ── 结构化文本 hunk 局部编辑类型 ────────────────────────────────────
//
// 这些类型描述 apply_diff 风格的局部编辑：用一组 hunk 描述
// 「把某段旧内容替换为某段新内容」，而不是重写整段文本。
// 算法本身是纯函数，不依赖资源、数据库或具体载体。

/**
 * 单个结构化 hunk。
 *
 * 表示一次连续片段替换：把当前文本中的 `oldContent` 换成 `newContent`。
 */
export interface StructuredTextHunk {
  /**要被替换的原始内容，必须与当前文本精确匹配 */
  oldContent: string;

  /** 替换后的最终内容 */
  newContent: string;

  /**
   * 可选，1-based 行号，基于调用方读取时的原始文本。
   *
   * 仅当 `oldContent` 在文本中重复出现、需要消歧时才会被使用；
   * `oldContent` 唯一匹配时会被忽略，避免陈旧行号导致本可成功的替换失败。
   */
  startLine?: number;
}

/**
 * 单个 hunk 的匹配方式。
 *
 * - `exact`：全文唯一匹配，直接采用。
 * - `line_anchored`：重复匹配时借助 `startLine` 定位到最接近的一处。
 */
export type TextHunkMatchKind = "exact" | "line_anchored";

/**
 * 单个 hunk 的处理结果。
 */
export interface TextHunkOutcome {
  /** 该 hunk 在输入数组中的下标，0-based */
  index: number;

  /** 是否成功匹配并应用 */
  matched: boolean;

  /** 匹配方式，仅在 `matched` 为 true 时给出 */
  matchKind?: TextHunkMatchKind;

  /** 失败原因，面向模型的英文说明，仅在 `matched` 为 false时给出 */
  reason?: string;

  /**
   * 重复匹配且未提供 `startLine` 时，给出所有候选行号（基于原始文本，1-based），
   * 便于模型补充 `startLine` 或调整 `oldContent` 使其唯一。
   */
  candidateLines?: number[];
}

/**
 * 应用一组 hunk 的整体结果。
 *
 * 采用原子语义：只有全部 hunk 都成功时 `ok` 才为 true 并给出 `newText`；
 * 任一 hunk 失败则 `ok` 为 false、不产出 `newText`，并在 `hunks` 中逐项给出诊断。
 */
export interface TextHunkApplyResult {
  /** 是否全部 hunk 成功应用 */
  ok: boolean;

  /** 全部成功时给出应用后的完整文本 */
  newText?: string;

  /** 每个 hunk的处理结果，顺序与输入一致 */
  hunks: TextHunkOutcome[];
}

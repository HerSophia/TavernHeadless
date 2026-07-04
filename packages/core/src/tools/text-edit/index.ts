// ── 结构化文本 hunk 局部编辑模块导出 ────────────────────────────────────

export type {
  StructuredTextHunk,
  TextHunkMatchKind,
  TextHunkOutcome,
  TextHunkApplyResult,
} from "./types.js";

export { applyStructuredTextHunks } from "./apply-structured-text-hunks.js";

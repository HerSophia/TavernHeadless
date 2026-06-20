/**
 * 本地实时校验 composable（B10 阶段 6）。
 *
 * 把纯函数 `validateGraphDocument` 包成随文档变化自动重算的 `computed`，
 * 供诊断浮层 / 面板与保存门槛复用。校验在主线程同步进行（图规模小、validator 轻量），
 * 结果确定且可单测（逻辑全在纯层）。
 */
import type { NodeGraphDocument } from "@tavern/core/node-graph";
import { computed, type ComputedRef, type Ref } from "vue";

import {
  EMPTY_LOCAL_VALIDATION,
  sortDiagnostics,
  validateGraphDocument,
  type LocalValidationResult,
} from "./local-validation";

export function useLocalValidation(
  document: Ref<NodeGraphDocument | null> | ComputedRef<NodeGraphDocument | null>,
): {
  validation: ComputedRef<LocalValidationResult>;
  sortedDiagnostics: ComputedRef<ReturnType<typeof sortDiagnostics>>;
} {
  const validation = computed<LocalValidationResult>(() =>
    document.value ? validateGraphDocument(document.value) : EMPTY_LOCAL_VALIDATION,
  );
  const sortedDiagnostics = computed(() => sortDiagnostics(validation.value.diagnostics));
  return { validation, sortedDiagnostics };
}

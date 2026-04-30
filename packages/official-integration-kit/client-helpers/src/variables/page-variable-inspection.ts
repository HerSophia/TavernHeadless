import type {
  PageStagedVariableWriteRecord,
  PageStagedVariableWriteSnapshot,
  PageVariablePromotionTraceSnapshot,
  VariablePromotionTraceRecord,
} from "@tavern/sdk";

import { formatVariablePreview } from "./flatten-variable-snapshot.js";

export type PageStagedVariableWriteLike = Pick<PageStagedVariableWriteSnapshot, "items"> | null | undefined;
export type VariablePromotionTraceLike = Pick<PageVariablePromotionTraceSnapshot, "items"> | null | undefined;

export type FlattenedPageStagedVariableWrite = {
  createdAt: number;
  decisionReason: string | null;
  id: string;
  intent: PageStagedVariableWriteRecord["intent"];
  key: string;
  op: PageStagedVariableWriteRecord["op"];
  preview: string;
  reason: string;
  resolvedAt: number | null;
  source: PageStagedVariableWriteRecord["source"];
  evidence: PageStagedVariableWriteRecord["evidence"];
  status: PageStagedVariableWriteRecord["status"];
  value: unknown | null;
};

export type GroupedVariablePromotionTrace = {
  key: string;
  latestCreatedAt: number;
  items: VariablePromotionTraceRecord[];
};

export function flattenPageStagedVariableWrites(
  snapshot: PageStagedVariableWriteLike,
): FlattenedPageStagedVariableWrite[] {
  if (!snapshot) {
    return [];
  }

  return [...snapshot.items]
    .map((item) => ({
      createdAt: item.createdAt,
      decisionReason: item.decisionReason,
      id: item.id,
      intent: item.intent,
      key: item.key,
      op: item.op,
      preview: formatVariablePreview(item.value),
      reason: item.reason,
      resolvedAt: item.resolvedAt,
      source: item.source,
      evidence: item.evidence,
      status: item.status,
      value: item.value,
    }))
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return right.createdAt - left.createdAt;
      }

      const keyOrder = left.key.localeCompare(right.key);
      if (keyOrder !== 0) {
        return keyOrder;
      }

      return left.id.localeCompare(right.id);
    });
}

export function groupVariablePromotionTrace(
  snapshot: VariablePromotionTraceLike,
): GroupedVariablePromotionTrace[] {
  if (!snapshot) {
    return [];
  }

  const groups = new Map<string, VariablePromotionTraceRecord[]>();

  for (const item of snapshot.items) {
    const entries = groups.get(item.key) ?? [];
    entries.push(item);
    groups.set(item.key, entries);
  }

  return Array.from(groups.entries())
    .map(([key, items]) => ({
      key,
      latestCreatedAt: items.reduce((latest, item) => Math.max(latest, item.createdAt), 0),
      items: [...items].sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => right.latestCreatedAt - left.latestCreatedAt || left.key.localeCompare(right.key));
}

import {
  flattenPageStagedVariableWrites,
  flattenVariableSnapshot,
  groupVariablePromotionTrace,
  sortVariableInspectorRows,
  type FlattenedPageStagedVariableWrite,
  type GroupedVariablePromotionTrace,
  type VariableInspectorRow,
} from "@tavern/client-helpers";
import type {
  PageStagedVariableWriteSnapshot,
  PageVariablePromotionTraceSnapshot,
  ResolvedVariablesSnapshot,
  VariablesResource,
} from "@tavern/sdk";
import { computed, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from "vue";

import { apiClient } from "../../../lib/api";
import type { TimelineMessage } from "../../../stores/workspace";

type InspectorTimelineMessage = Pick<TimelineMessage, "at" | "floorId" | "id" | "pageId" | "persisted" | "seq">;
type VariablesResourceLike = Pick<VariablesResource, "resolveContext"> & Partial<Pick<VariablesResource, "getPagePromotions" | "getPageStagedWrites">>;

type UseWorkspaceInspectorVariablesOptions = {
  accountId: MaybeRefOrGetter<string>;
  resource?: VariablesResourceLike;
  sessionId: MaybeRefOrGetter<string | null | undefined>;
  timeline: MaybeRefOrGetter<readonly InspectorTimelineMessage[]>;
};

type ResolvedTarget = {
  accountId: string;
  floorId?: string;
  pageId?: string;
  sessionId: string;
};

type PageVariableInspectionBundle = {
  promotions: PageVariablePromotionTraceSnapshot | null;
  resolved: ResolvedVariablesSnapshot;
  staged: PageStagedVariableWriteSnapshot | null;
};

type UseWorkspaceInspectorVariablesResult = {
  error: Ref<string | null>;
  loading: Ref<boolean>;
  promotionGroups: Ref<GroupedVariablePromotionTrace[]>;
  rawPromotions: Ref<PageVariablePromotionTraceSnapshot | null>;
  rawSnapshot: Ref<ResolvedVariablesSnapshot | null>;
  rawStagedWrites: Ref<PageStagedVariableWriteSnapshot | null>;
  refresh: (force?: boolean) => Promise<void>;
  rows: Ref<VariableInspectorRow[]>;
  stagedWrites: Ref<FlattenedPageStagedVariableWrite[]>;
};

export function useWorkspaceInspectorVariables(
  options: UseWorkspaceInspectorVariablesOptions,
): UseWorkspaceInspectorVariablesResult {
  const resource = options.resource ?? apiClient.variables;
  const cache = new Map<string, PageVariableInspectionBundle>();
  const error = ref<string | null>(null);
  const loading = ref(false);
  const rawPromotions = ref<PageVariablePromotionTraceSnapshot | null>(null);
  const rawSnapshot = ref<ResolvedVariablesSnapshot | null>(null);
  const rawStagedWrites = ref<PageStagedVariableWriteSnapshot | null>(null);
  const promotionGroups = ref<GroupedVariablePromotionTrace[]>([]);
  const rows = ref<VariableInspectorRow[]>([]);
  const stagedWrites = ref<FlattenedPageStagedVariableWrite[]>([]);
  let requestVersion = 0;

  const target = computed<ResolvedTarget | null>(() => {
    const accountId = toValue(options.accountId);
    const sessionId = toValue(options.sessionId);

    if (!accountId || !sessionId) {
      return null;
    }

    const context = resolveLatestVariableContext(toValue(options.timeline));
    return {
      accountId,
      floorId: context.floorId,
      pageId: context.pageId,
      sessionId,
    };
  });

  const targetKey = computed(() => {
    const currentTarget = target.value;
    return currentTarget ? buildTargetKey(currentTarget) : "";
  });

  const timelineFingerprint = computed(() => resolveTimelineFingerprint(toValue(options.timeline)));

  watch(
    [targetKey, timelineFingerprint],
    ([nextTargetKey, nextFingerprint], previousValue) => {
      const [previousTargetKey, previousFingerprint] = previousValue ?? ["", ""];
      const forceRefresh = Boolean(
        nextTargetKey
          && nextTargetKey === previousTargetKey
          && nextFingerprint !== previousFingerprint,
      );

      void refresh(forceRefresh);
    },
    { immediate: true },
  );

  async function refresh(force = false): Promise<void> {
    const currentTarget = target.value;
    if (!currentTarget) {
      requestVersion += 1;
      error.value = null;
      loading.value = false;
      clearBundle();
      return;
    }

    const cacheKey = buildTargetKey(currentTarget);
    if (!force) {
      const cachedBundle = cache.get(cacheKey);
      if (cachedBundle) {
        applyBundle(cachedBundle);
        loading.value = false;
        error.value = null;
        return;
      }
    }

    const currentRequestVersion = ++requestVersion;
    loading.value = true;
    error.value = null;

    try {
      const bundle = await loadInspectionBundle(resource, currentTarget);

      if (currentRequestVersion !== requestVersion) {
        return;
      }

      cache.set(cacheKey, bundle);
      applyBundle(bundle);
    } catch (cause) {
      if (currentRequestVersion !== requestVersion) {
        return;
      }

      error.value = cause instanceof Error ? cause.message : "Unknown error";
    } finally {
      if (currentRequestVersion === requestVersion) {
        loading.value = false;
      }
    }
  }

  function applyBundle(bundle: PageVariableInspectionBundle): void {
    rawSnapshot.value = bundle.resolved;
    rows.value = sortVariableInspectorRows(flattenVariableSnapshot(bundle.resolved));
    rawStagedWrites.value = bundle.staged;
    stagedWrites.value = flattenPageStagedVariableWrites(bundle.staged);
    rawPromotions.value = bundle.promotions;
    promotionGroups.value = groupVariablePromotionTrace(bundle.promotions);
  }

  function clearBundle(): void {
    rawSnapshot.value = null;
    rows.value = [];
    rawStagedWrites.value = null;
    stagedWrites.value = [];
    rawPromotions.value = null;
    promotionGroups.value = [];
  }

  return {
    error,
    loading,
    promotionGroups,
    rawPromotions,
    rawSnapshot,
    rawStagedWrites,
    refresh,
    rows,
    stagedWrites,
  };
}

async function loadInspectionBundle(
  resource: VariablesResourceLike,
  target: ResolvedTarget,
): Promise<PageVariableInspectionBundle> {
  const [resolved, staged, promotions] = await Promise.all([
    resource.resolveContext({
      accountId: target.accountId,
      floorId: target.floorId,
      includeLayers: true,
      pageId: target.pageId,
      sessionId: target.sessionId,
    }),
    target.pageId && resource.getPageStagedWrites
      ? resource.getPageStagedWrites({
          accountId: target.accountId,
          pageId: target.pageId,
        })
      : Promise.resolve(null),
    target.pageId && resource.getPagePromotions
      ? resource.getPagePromotions({
          accountId: target.accountId,
          pageId: target.pageId,
        })
      : Promise.resolve(null),
  ]);

  return {
    promotions,
    resolved,
    staged,
  };
}

export function resolveLatestVariableContext(
  timeline: readonly InspectorTimelineMessage[],
): Pick<ResolvedTarget, "floorId" | "pageId"> {
  let floorId: string | undefined;
  let pageId: string | undefined;

  for (let index = timeline.length - 1; index >= 0 && (!floorId || !pageId); index -= 1) {
    const item = timeline[index];

    if (!item?.persisted) {
      continue;
    }

    if (!pageId && item.pageId) {
      pageId = item.pageId;
    }

    if (!floorId && item.floorId) {
      floorId = item.floorId;
    }
  }

  return {
    floorId,
    pageId,
  };
}

function buildTargetKey(target: ResolvedTarget): string {
  return [target.accountId, target.sessionId, target.floorId ?? "", target.pageId ?? ""].join("\u0000");
}

function resolveTimelineFingerprint(timeline: readonly InspectorTimelineMessage[]): string {
  const persistedMessages = timeline.filter((item) => item?.persisted);
  const latest = persistedMessages[persistedMessages.length - 1];

  return [
    persistedMessages.length,
    latest?.id ?? "",
    latest?.floorId ?? "",
    latest?.pageId ?? "",
    latest?.seq ?? "",
    latest?.at ?? "",
  ].join("|");
}

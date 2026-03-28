import { flattenVariableSnapshot, sortVariableInspectorRows, type VariableInspectorRow } from "@tavern/client-helpers";
import type { ResolvedVariablesSnapshot, VariablesResource } from "@tavern/sdk";
import { computed, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from "vue";

import { apiClient } from "../../../lib/api";
import type { TimelineMessage } from "../../../stores/workspace";

type InspectorTimelineMessage = Pick<TimelineMessage, "at" | "floorId" | "id" | "pageId" | "persisted" | "seq">;
type VariablesResourceLike = Pick<VariablesResource, "resolveContext">;

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

type UseWorkspaceInspectorVariablesResult = {
  error: Ref<string | null>;
  loading: Ref<boolean>;
  rawSnapshot: Ref<ResolvedVariablesSnapshot | null>;
  refresh: (force?: boolean) => Promise<void>;
  rows: Ref<VariableInspectorRow[]>;
};

export function useWorkspaceInspectorVariables(
  options: UseWorkspaceInspectorVariablesOptions,
): UseWorkspaceInspectorVariablesResult {
  const resource = options.resource ?? apiClient.variables;
  const cache = new Map<string, ResolvedVariablesSnapshot>();
  const error = ref<string | null>(null);
  const loading = ref(false);
  const rawSnapshot = ref<ResolvedVariablesSnapshot | null>(null);
  const rows = ref<VariableInspectorRow[]>([]);
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
      rawSnapshot.value = null;
      rows.value = [];
      return;
    }

    const cacheKey = buildTargetKey(currentTarget);
    if (!force) {
      const cachedSnapshot = cache.get(cacheKey);
      if (cachedSnapshot) {
        applySnapshot(cachedSnapshot);
        loading.value = false;
        error.value = null;
        return;
      }
    }

    const currentRequestVersion = ++requestVersion;
    loading.value = true;
    error.value = null;

    try {
      const snapshot = await resource.resolveContext({
        accountId: currentTarget.accountId,
        floorId: currentTarget.floorId,
        includeLayers: true,
        pageId: currentTarget.pageId,
        sessionId: currentTarget.sessionId,
      });

      if (currentRequestVersion !== requestVersion) {
        return;
      }

      cache.set(cacheKey, snapshot);
      applySnapshot(snapshot);
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

  function applySnapshot(snapshot: ResolvedVariablesSnapshot): void {
    rawSnapshot.value = snapshot;
    rows.value = sortVariableInspectorRows(flattenVariableSnapshot(snapshot));
  }

  return {
    error,
    loading,
    rawSnapshot,
    refresh,
    rows,
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

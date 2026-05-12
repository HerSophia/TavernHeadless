import type {
  OperationLogRecord,
  OperationLogsResource,
  PromptRuntimeHistoricalExplain,
  PromptRuntimeResource,
  SessionBranchDiff,
  SessionBranchSummary,
  SessionsResource,
  SessionTimeline,
  TimelineFloor,
} from "@tavern/sdk";
import { computed, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from "vue";

import { apiClient } from "../../../lib/api";

type SessionsResourceLike = Pick<SessionsResource, "diffBranches" | "listBranches" | "timeline">;
type OperationLogsResourceLike = Pick<OperationLogsResource, "listForSession">;
type PromptRuntimeResourceLike = Pick<PromptRuntimeResource, "getFloorExplain">;

type UseWorkspaceInspectorVcOptions = {
  accountId: MaybeRefOrGetter<string>;
  operationLogsResource?: OperationLogsResourceLike;
  promptRuntimeResource?: PromptRuntimeResourceLike;
  sessionId: MaybeRefOrGetter<string | null | undefined>;
  sessionsResource?: SessionsResourceLike;
};

type ResolvedTarget = {
  accountId: string;
  sessionId: string;
};

export type WorkspaceInspectorVcBranch = {
  diff: SessionBranchDiff | null;
  floors: TimelineFloor[];
  summary: SessionBranchSummary;
  timeline: SessionTimeline | null;
};

export type WorkspaceInspectorVcExplainEntry = {
  branchId: string;
  error: string | null;
  explain: PromptRuntimeHistoricalExplain | null;
  floor: TimelineFloor;
};

export type UseWorkspaceInspectorVcResult = {
  branches: Ref<WorkspaceInspectorVcBranch[]>;
  error: Ref<string | null>;
  explains: Ref<WorkspaceInspectorVcExplainEntry[]>;
  loading: Ref<boolean>;
  operationLogs: Ref<OperationLogRecord[]>;
  refresh: (force?: boolean) => Promise<void>;
};

type WorkspaceInspectorVcSnapshot = {
  branches: WorkspaceInspectorVcBranch[];
  explains: WorkspaceInspectorVcExplainEntry[];
  operationLogs: OperationLogRecord[];
};

const BRANCH_LIMIT = 8;
const TIMELINE_LIMIT = 12;
const EXPLAIN_LIMIT = 6;
const OPERATION_LOG_LIMIT = 12;

export function useWorkspaceInspectorVc(options: UseWorkspaceInspectorVcOptions): UseWorkspaceInspectorVcResult {
  const sessionsResource = options.sessionsResource ?? apiClient.sessions;
  const operationLogsResource = options.operationLogsResource ?? apiClient.operationLogs;
  const promptRuntimeResource = options.promptRuntimeResource ?? apiClient.promptRuntime;
  const cache = new Map<string, WorkspaceInspectorVcSnapshot>();
  const branches = ref<WorkspaceInspectorVcBranch[]>([]);
  const error = ref<string | null>(null);
  const explains = ref<WorkspaceInspectorVcExplainEntry[]>([]);
  const loading = ref(false);
  const operationLogs = ref<OperationLogRecord[]>([]);
  let requestVersion = 0;

  const target = computed<ResolvedTarget | null>(() => {
    const accountId = toValue(options.accountId)?.trim();
    const sessionId = toValue(options.sessionId)?.trim();

    if (!accountId || !sessionId) {
      return null;
    }

    return { accountId, sessionId };
  });

  const targetKey = computed(() => {
    const currentTarget = target.value;
    return currentTarget ? [currentTarget.accountId, currentTarget.sessionId].join("\u0000") : "";
  });

  watch(
    targetKey,
    () => {
      void refresh();
    },
    { immediate: true },
  );

  async function refresh(force = false): Promise<void> {
    const currentTarget = target.value;
    if (!currentTarget) {
      requestVersion += 1;
      applySnapshot(null);
      error.value = null;
      loading.value = false;
      return;
    }

    const cacheKey = targetKey.value;
    if (!force) {
      const cachedSnapshot = cache.get(cacheKey);
      if (cachedSnapshot) {
        applySnapshot(cachedSnapshot);
        error.value = null;
        loading.value = false;
        return;
      }
    }

    const currentRequestVersion = ++requestVersion;
    loading.value = true;
    error.value = null;

    try {
      const [branchRows, logResult] = await Promise.all([
        sessionsResource.listBranches({
          accountId: currentTarget.accountId,
          limit: BRANCH_LIMIT,
          offset: 0,
          sessionId: currentTarget.sessionId,
          sortBy: "updated_at",
          sortOrder: "desc",
        }),
        operationLogsResource.listForSession({
          accountId: currentTarget.accountId,
          limit: OPERATION_LOG_LIMIT,
          offset: 0,
          sessionId: currentTarget.sessionId,
          sortOrder: "desc",
        }),
      ]);

      const [timelineByBranch, diffByBranch] = await Promise.all([
        loadTimelines(currentTarget, branchRows, sessionsResource),
        loadDiffs(currentTarget, branchRows, sessionsResource),
      ]);

      const branchViews = branchRows.map<WorkspaceInspectorVcBranch>((summary) => {
        const timeline = timelineByBranch.get(summary.branchId) ?? null;
        return {
          diff: diffByBranch.get(summary.branchId) ?? null,
          floors: timeline?.floors ?? [],
          summary,
          timeline,
        };
      });

      const explainEntries = await loadExplains(currentTarget, branchViews, promptRuntimeResource);
      if (currentRequestVersion !== requestVersion) {
        return;
      }

      const nextSnapshot: WorkspaceInspectorVcSnapshot = {
        branches: branchViews,
        explains: explainEntries,
        operationLogs: logResult.logs,
      };
      cache.set(cacheKey, nextSnapshot);
      applySnapshot(nextSnapshot);
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

  function applySnapshot(snapshot: WorkspaceInspectorVcSnapshot | null): void {
    branches.value = snapshot?.branches ?? [];
    explains.value = snapshot?.explains ?? [];
    operationLogs.value = snapshot?.operationLogs ?? [];
  }

  return {
    branches,
    error,
    explains,
    loading,
    operationLogs,
    refresh,
  };
}

async function loadTimelines(
  target: ResolvedTarget,
  branchRows: SessionBranchSummary[],
  sessionsResource: SessionsResourceLike,
): Promise<Map<string, SessionTimeline>> {
  const entries = await Promise.all(branchRows.map(async (branch) => {
    try {
      const timeline = await sessionsResource.timeline({
        accountId: target.accountId,
        branchId: branch.branchId,
        limit: TIMELINE_LIMIT,
        offset: 0,
        sessionId: target.sessionId,
      });
      return [branch.branchId, timeline] as const;
    } catch {
      return [branch.branchId, null] as const;
    }
  }));

  return new Map(entries.filter((entry): entry is readonly [string, SessionTimeline] => entry[1] !== null));
}

async function loadDiffs(
  target: ResolvedTarget,
  branchRows: SessionBranchSummary[],
  sessionsResource: SessionsResourceLike,
): Promise<Map<string, SessionBranchDiff>> {
  const entries = await Promise.all(branchRows.map(async (branch) => {
    if (branch.branchId === "main") {
      return [branch.branchId, null] as const;
    }

    try {
      const diff = await sessionsResource.diffBranches({
        accountId: target.accountId,
        baseBranchId: "main",
        sessionId: target.sessionId,
        targetBranchId: branch.branchId,
      });
      return [branch.branchId, diff] as const;
    } catch {
      return [branch.branchId, null] as const;
    }
  }));

  return new Map(entries.filter((entry): entry is readonly [string, SessionBranchDiff] => entry[1] !== null));
}

async function loadExplains(
  target: ResolvedTarget,
  branchViews: WorkspaceInspectorVcBranch[],
  promptRuntimeResource: PromptRuntimeResourceLike,
): Promise<WorkspaceInspectorVcExplainEntry[]> {
  const candidates = collectExplainCandidates(branchViews);
  return Promise.all(candidates.map(async ({ branchId, floor }) => {
    try {
      const explain = await promptRuntimeResource.getFloorExplain({
        accountId: target.accountId,
        floorId: floor.id,
      });
      return { branchId, error: null, explain, floor };
    } catch (cause) {
      return {
        branchId,
        error: cause instanceof Error ? cause.message : "Unknown error",
        explain: null,
        floor,
      };
    }
  }));
}

function collectExplainCandidates(branchViews: WorkspaceInspectorVcBranch[]): Array<{ branchId: string; floor: TimelineFloor }> {
  const byFloorId = new Map<string, { branchId: string; floor: TimelineFloor }>();

  for (const branch of branchViews) {
    const sortedFloors = [...branch.floors].sort((left, right) => right.floorNo - left.floorNo || right.createdAt - left.createdAt);
    for (const floor of sortedFloors) {
      if (floor.state !== "committed" || byFloorId.has(floor.id)) {
        continue;
      }
      byFloorId.set(floor.id, { branchId: branch.summary.branchId, floor });
    }
  }

  return [...byFloorId.values()]
    .sort((left, right) => right.floor.floorNo - left.floor.floorNo || right.floor.createdAt - left.floor.createdAt)
    .slice(0, EXPLAIN_LIMIT);
}

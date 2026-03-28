import { computed, reactive, ref } from "vue";
import { defineStore } from "pinia";

import {
  fetchLibraryAssets as fetchLibraryAssetsApi,
  fetchSessionTimeline,
  type WorkspaceTimelineMessage,
  type WorkspaceLibraryAsset
} from "../lib/workspace-api";

import { createAssetsActions } from "./workspace/actions/assets";
import { createMessageActions } from "./workspace/actions/messages";
import { createSessionActions } from "./workspace/actions/session";
import { createWorldbookActions } from "./workspace/actions/worldbook";
import { DEFAULT_ASSETS, DEFAULT_SESSIONS } from "./workspace/defaults";
import { mergeLibraryAsset, toTimelineMessage } from "./workspace/mappers";
import { useWorkspaceUiStore } from "./workspace-ui";
import type {
  LibraryHydrationResult,
  MessageBucketLocation,
  SessionState,
  TimelineHydrationResult,
  TimelineMessage,
  WorkspaceAsset
} from "./workspace/types";

export * from "./workspace/types";

export const useWorkspaceStore = defineStore("workspace", () => {
  const apiStatus = ref("Checking /health ...");
  const workspaceUi = useWorkspaceUiStore();

  const accounts = ref(["studio-alpha", "studio-beta"]);
  const users = ref(["Detective Rowan", "Archivist Lin", "Field Agent Mira"]);

  const accountIndex = ref(0);
  const userIndex = ref(0);
  const sessionSeed = ref(4);
  const renameSeed = ref(1);
  const activeSessionIndex = ref(0);

  const sessions = ref<SessionState[]>([...DEFAULT_SESSIONS]);
  const assetLibrary = ref<WorkspaceAsset[]>([...DEFAULT_ASSETS]);
  const timelineMessages = reactive<Record<string, TimelineMessage[]>>({});

  let timelineSeed = 0;

  const currentAccount = computed(() => accounts.value[accountIndex.value] ?? "studio-alpha");

  const libraryAssets = computed(() => assetLibrary.value.filter((asset) => asset.account === currentAccount.value));

  const activeSession = computed(() => {
    if (sessions.value.length === 0) {
      return null;
    }

    if (activeSessionIndex.value < 0 || activeSessionIndex.value >= sessions.value.length) {
      activeSessionIndex.value = 0;
    }

    return sessions.value[activeSessionIndex.value] ?? null;
  });

  const runtimeCharacterName = computed(() => activeSession.value?.characterName ?? "Seraphina v4");
  const runtimeUserName = computed(() => activeSession.value?.userName ?? users.value[userIndex.value] ?? "Unknown User");
  const runtimeWorldbookCount = computed(() => activeSession.value?.worldbookCount ?? 0);

  const activeTimeline = computed(() => {
    const sessionId = activeSession.value?.id;
    if (!sessionId) {
      return [] as TimelineMessage[];
    }

    return ensureTimeline(sessionId);
  });

  const isStreaming = computed(() => activeTimeline.value.some((item) => item.streaming));

  function createMessageId(prefix: string): string {
    timelineSeed += 1;
    return `${prefix}-${Date.now()}-${timelineSeed}`;
  }

  function createSessionId(seed: number): string {
    const left = String(seed).padStart(4, "0");
    const right = Math.random().toString(16).slice(2, 6);
    return `${left}-${right}`;
  }

  function ensureTimeline(sessionId: string): TimelineMessage[] {
    if (!timelineMessages[sessionId]) {
      timelineMessages[sessionId] = [];
    }

    return timelineMessages[sessionId] ?? [];
  }

  function replaceTimeline(sessionId: string, messages: WorkspaceTimelineMessage[]): TimelineMessage[] {
    const bucket = ensureTimeline(sessionId);
    bucket.splice(0, bucket.length, ...messages.map(toTimelineMessage));
    return bucket;
  }

  function findActiveMessage(messageId: string): MessageBucketLocation | null {
    const sessionId = activeSession.value?.id;
    if (!sessionId) {
      return null;
    }

    const bucket = ensureTimeline(sessionId);
    const index = bucket.findIndex((item) => item.id === messageId);
    if (index < 0) {
      return null;
    }

    return {
      bucket,
      index
    };
  }

  async function hydrateSessionTimeline(sessionId: string, accountId = currentAccount.value): Promise<TimelineHydrationResult> {
    try {
      const messages = await fetchSessionTimeline(sessionId, accountId);
      replaceTimeline(sessionId, messages);
      return {
        apiSyncFailed: false,
        count: messages.length
      };
    } catch {
      return {
        apiSyncFailed: true,
        count: ensureTimeline(sessionId).length
      };
    }
  }


  function mergeAccountLibraryAssets(accountId: string, assets: WorkspaceLibraryAsset[]): void {
    const previousById = new Map(
      assetLibrary.value
        .filter((asset) => asset.account === accountId)
        .map((asset) => [asset.id, asset] as const)
    );

    const merged = assets.map((asset) => {
      const previous = previousById.get(asset.id);
      return mergeLibraryAsset(accountId, asset, previous);
    });

    assetLibrary.value = [
      ...assetLibrary.value.filter((asset) => asset.account !== accountId),
      ...merged
    ];
  }

  async function hydrateLibraryAssets(accountId = currentAccount.value): Promise<LibraryHydrationResult> {
    try {
      const assets = await fetchLibraryAssetsApi(accountId);
      mergeAccountLibraryAssets(accountId, assets);
      return {
        apiSyncFailed: false,
        count: assets.length
      };
    } catch {
      return {
        apiSyncFailed: true,
        count: libraryAssets.value.length
      };
    }
  }

  const {
    archiveSession,
    clearTimelineCache,
    createSession,
    deleteSession,
    ensureSessionAnchor,
    hydrateActiveTimeline,
    hydrateFromApi,
    hydrateTimelineBySessionId,
    openSession,
    renameSession,
    resetWorkspaceContext,
    switchAccount
  } = createSessionActions({
    activeSession,
    activeSessionIndex,
    accountIndex,
    accounts,
    apiStatus,
    createSessionId,
    currentAccount,
    ensureTimeline,
    hydrateLibraryAssets,
    hydrateSessionTimeline,
    renameSeed,
    runtimeCharacterName,
    runtimeUserName,
    sessionSeed,
    sessions,
    timelineMessages,
    userIndex
  });


  function findLibraryAsset(assetId: string): WorkspaceAsset | null {
    return libraryAssets.value.find((asset) => asset.id === assetId) ?? null;
  }

  function previewLibraryAsset(assetId: string): WorkspaceAsset | null {
    return findLibraryAsset(assetId);
  }

  const {
    deleteTimelineMessage,
    editAndRegenerateFromMessage,
    retryMessageFloor,
    sendMessage,
    updateTimelineMessage
  } = createMessageActions({
    activeSession,
    createMessageId,
    currentAccount,
    ensureTimeline,
    findActiveMessage,
    hydrateActiveTimeline,
    hydrateSessionTimeline,
    isStreaming,
    recordRespondStreamEvent: workspaceUi.recordRespondStreamEvent,
    resetRespondStreamState: workspaceUi.resetRespondStreamState
  });

  function touchLibraryAsset(asset: WorkspaceAsset): void {
    asset.uses += 1;
    asset.updatedAt = Date.now();
  }

  function syncSessionWorldbookCount(session: SessionState): void {
    session.worldbookCount = session.worldbookProfileId ? 1 : 0;
  }

  const {
    applyAssetFromLibrary,
    deleteCharacterLibraryAsset,
    deletePresetLibraryAsset,
    deleteWorldbookLibraryAsset,
    importAssetsIntoLibrary,
    loadCharacterAssetDetail,
    loadPresetAssetDetail,
    loadWorldbookAssetDetail,
    restoreCharacterLibraryAsset,
    saveCharacterAsset,
    savePresetAsset,
    saveWorldbookAsset,
    toggleLibraryFavorite
  } = createAssetsActions({
    activeSession,
    currentAccount,
    findLibraryAsset,
    hydrateLibraryAssets,
    libraryAssets,
    sessions,
    syncSessionWorldbookCount,
    touchLibraryAsset
  });

  const {
    attachWorldbook,
    bindWorldbookToActiveSession,
    detachWorldbook,
    isWorldbookBoundToActiveSession,
    unbindWorldbookFromActiveSession
  } = createWorldbookActions({
    activeSession,
    findLibraryAsset,
    libraryAssets,
    syncSessionWorldbookCount,
    touchLibraryAsset
  });



  function replaceUser(): SessionState | null {
    userIndex.value = (userIndex.value + 1) % users.value.length;
    const session = activeSession.value;
    if (!session) {
      return null;
    }

    session.userName = users.value[userIndex.value] ?? session.userName;
    return session;
  }



  return {
    accounts,
    activeSession,
    activeSessionIndex,
    applyAssetFromLibrary,
    activeTimeline,
    apiStatus,
    archiveSession,
    attachWorldbook,
    clearTimelineCache,
    bindWorldbookToActiveSession,
    deleteWorldbookLibraryAsset,
    createSession,
    currentAccount,
    editAndRegenerateFromMessage,
    deleteSession,
    detachWorldbook,
    deleteTimelineMessage,
    ensureSessionAnchor,
    hydrateLibraryAssets,
    hydrateActiveTimeline,
    hydrateFromApi,
    hydrateTimelineBySessionId,
    loadCharacterAssetDetail,
    loadPresetAssetDetail,
    loadWorldbookAssetDetail,
    isStreaming,
    openSession,
    isWorldbookBoundToActiveSession,
    libraryAssets,
    saveCharacterAsset,
    deleteCharacterLibraryAsset,
    restoreCharacterLibraryAsset,
    deletePresetLibraryAsset,
    previewLibraryAsset,
    renameSession,
    retryMessageFloor,
    importAssetsIntoLibrary,
    updateTimelineMessage,
    replaceUser,
    resetWorkspaceContext,
    runtimeCharacterName,
    savePresetAsset,
    saveWorldbookAsset,
    toggleLibraryFavorite,
    runtimeUserName,
    runtimeWorldbookCount,
    sendMessage,
    sessions,
    switchAccount,
    unbindWorldbookFromActiveSession,
    users
  };
});

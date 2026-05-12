import type { ComputedRef, Ref } from "vue";

import {
  archiveSession as archiveSessionApi,
  createSession as createSessionApi,
  fetchHealthStatus,
  fetchSessions,
  removeSession,
  renameSession as renameSessionApi
} from "../../../lib/workspace-api";
import { toLocalSession } from "../mappers";
import type {
  HydrateWorkspaceResult,
  LibraryHydrationResult,
  SessionState,
  TimelineHydrationResult,
  TimelineMessage,
  WorkspaceLocale
} from "../types";

type SessionActionsContext = {
  activeSession: ComputedRef<SessionState | null>;
  activeSessionIndex: Ref<number>;
  accountIndex: Ref<number>;
  accounts: Ref<string[]>;
  apiStatus: Ref<string>;
  createSessionId: (seed: number) => string;
  currentAccount: ComputedRef<string>;
  ensureTimeline: (sessionId: string) => TimelineMessage[];
  hydrateLibraryAssets: (accountId?: string) => Promise<LibraryHydrationResult>;
  hydrateSessionTimeline: (sessionId: string, accountId?: string) => Promise<TimelineHydrationResult>;
  renameSeed: Ref<number>;
  runtimeCharacterName: ComputedRef<string>;
  runtimeUserName: ComputedRef<string>;
  sessionSeed: Ref<number>;
  sessions: Ref<SessionState[]>;
  timelineMessages: Record<string, TimelineMessage[]>;
  userIndex: Ref<number>;
};

export function createSessionActions(context: SessionActionsContext) {
  function clearTimelineCache(): void {
    Object.keys(context.timelineMessages).forEach((key) => {
      delete context.timelineMessages[key];
    });
  }

  function resetWorkspaceContext(): void {
    context.activeSessionIndex.value = 0;
    clearTimelineCache();
  }

  function switchAccount(): string {
    context.accountIndex.value = (context.accountIndex.value + 1) % context.accounts.value.length;
    resetWorkspaceContext();
    context.userIndex.value = 0;
    return context.currentAccount.value;
  }

  function createFallbackSession(seed: number, accountId: string): SessionState {
    return {
      account: accountId,
      archived: false,
      characterName: context.runtimeCharacterName.value,
      id: context.createSessionId(seed),
      title: {
        en: `New Session ${seed}`,
        zh: `新会话 ${seed}`
      },
      userName: context.runtimeUserName.value,
      deepBinding: false,
      presetId: null,
      presetVersionId: null,
      regexProfileId: null,
      regexProfileVersionId: null,
      worldbookProfileId: null,
      worldbookVersionId: null,
      worldbookCount: 0
    };
  }

  function ensureSessionAnchor(accountId: string): void {
    if (context.sessions.value.length > 0) {
      return;
    }

    const seed = context.sessionSeed.value;
    context.sessionSeed.value += 1;
    context.sessions.value = [createFallbackSession(seed, accountId)];
    context.activeSessionIndex.value = 0;
  }

  async function hydrateFromApi(accountId = context.currentAccount.value): Promise<HydrateWorkspaceResult> {
    try {
      context.apiStatus.value = await fetchHealthStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      context.apiStatus.value = `Health check error: ${message}`;
    }

    const libraryResult = await context.hydrateLibraryAssets(accountId);

    try {
      const remoteSessions = await fetchSessions(accountId);

      if (remoteSessions.length > 0) {
        context.sessions.value = remoteSessions.map(toLocalSession);
        clearTimelineCache();
        context.activeSessionIndex.value = 0;
      } else {
        context.sessions.value = [];
        ensureSessionAnchor(accountId);
      }

      const sessionId = context.sessions.value[context.activeSessionIndex.value]?.id;
      if (!sessionId) {
        return {
          sessionSyncFailed: false,
          timelineSyncFailed: false,
          librarySyncFailed: libraryResult.apiSyncFailed
        };
      }

      const timelineResult = await context.hydrateSessionTimeline(sessionId, accountId);

      return {
        librarySyncFailed: libraryResult.apiSyncFailed,
        sessionSyncFailed: false,
        timelineSyncFailed: timelineResult.apiSyncFailed
      };
    } catch {
      ensureSessionAnchor(accountId);
      return {
        sessionSyncFailed: true,
        timelineSyncFailed: false,
        librarySyncFailed: libraryResult.apiSyncFailed
      };
    }
  }

  async function hydrateActiveTimeline(): Promise<TimelineHydrationResult> {
    const sessionId = context.activeSession.value?.id;
    if (!sessionId) {
      return {
        apiSyncFailed: false,
        count: 0
      };
    }

    return context.hydrateSessionTimeline(sessionId, context.currentAccount.value);
  }

  async function hydrateTimelineBySessionId(sessionId: string): Promise<TimelineHydrationResult> {
    if (!sessionId) {
      return {
        apiSyncFailed: false,
        count: 0
      };
    }

    return context.hydrateSessionTimeline(sessionId, context.currentAccount.value);
  }

  function openSession(index: number): SessionState | null {
    if (index < 0 || index >= context.sessions.value.length) {
      return null;
    }

    context.activeSessionIndex.value = index;
    const sessionId = context.sessions.value[index]?.id;
    if (sessionId) {
      context.ensureTimeline(sessionId);
    }

    return context.sessions.value[index] ?? null;
  }

  async function createSession(locale: WorkspaceLocale): Promise<{ apiSyncFailed: boolean; session: SessionState }> {
    const seed = context.sessionSeed.value;
    context.sessionSeed.value += 1;

    try {
      const created = await createSessionApi(
        locale === "zh" ? `新会话 ${seed}` : `New Session ${seed}`,
        context.currentAccount.value
      );

      if (created) {
        const local = toLocalSession(created);
        context.sessions.value.unshift(local);
        context.ensureTimeline(local.id);
        context.activeSessionIndex.value = 0;
        return {
          apiSyncFailed: false,
          session: local
        };
      }
    } catch {
      // keep fallback flow
    }

    const fallback = createFallbackSession(seed, context.currentAccount.value);
    context.sessions.value.unshift(fallback);
    context.ensureTimeline(fallback.id);
    context.activeSessionIndex.value = 0;

    return {
      apiSyncFailed: true,
      session: fallback
    };
  }

  async function renameSession(index: number): Promise<{ apiSyncFailed: boolean; session: SessionState | null }> {
    const session = context.sessions.value[index];
    if (!session) {
      return {
        apiSyncFailed: false,
        session: null
      };
    }

    const seed = context.renameSeed.value;
    context.renameSeed.value += 1;

    session.title = {
      en: `Session Revision ${seed}`,
      zh: `会话 ${seed}号修订`
    };

    try {
      await renameSessionApi(session.id, session.title.en, context.currentAccount.value);
      return {
        apiSyncFailed: false,
        session
      };
    } catch {
      return {
        apiSyncFailed: true,
        session
      };
    }
  }

  async function archiveSession(index: number): Promise<{ apiSyncFailed: boolean; session: SessionState | null }> {
    const session = context.sessions.value[index];
    if (!session || session.archived) {
      return {
        apiSyncFailed: false,
        session: null
      };
    }

    session.archived = true;

    if (index === context.activeSessionIndex.value) {
      const nextActive = context.sessions.value.findIndex((item) => !item.archived);
      if (nextActive >= 0) {
        context.activeSessionIndex.value = nextActive;
      }
    }

    try {
      await archiveSessionApi(session.id, context.currentAccount.value);
      return {
        apiSyncFailed: false,
        session
      };
    } catch {
      return {
        apiSyncFailed: true,
        session
      };
    }
  }

  async function deleteSession(index: number): Promise<{
    apiSyncFailed: boolean;
    guarded: boolean;
    session: SessionState | null;
  }> {
    if (context.sessions.value.length <= 1) {
      return {
        apiSyncFailed: false,
        guarded: true,
        session: null
      };
    }

    const removed = context.sessions.value.splice(index, 1)[0] ?? null;
    if (!removed) {
      return {
        apiSyncFailed: false,
        guarded: false,
        session: null
      };
    }

    delete context.timelineMessages[removed.id];

    if (index < context.activeSessionIndex.value) {
      context.activeSessionIndex.value -= 1;
    }

    context.activeSessionIndex.value = Math.max(
      0,
      Math.min(context.activeSessionIndex.value, context.sessions.value.length - 1)
    );

    try {
      await removeSession(removed.id, context.currentAccount.value);
      return {
        apiSyncFailed: false,
        guarded: false,
        session: removed
      };
    } catch {
      return {
        apiSyncFailed: true,
        guarded: false,
        session: removed
      };
    }
  }

  return {
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
  };
}

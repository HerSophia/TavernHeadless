import type { ComputedRef, Ref } from "vue";

import type { SessionState, WorkspaceLocale } from "../../../stores/workspace";
import type { EventTone } from "../../../stores/workspace-ui";

type AddEvent = (key: string, tone?: EventTone, vars?: Record<string, number | string>) => void;

type WorkspaceSessionStore = {
  archiveSession: (index: number) => Promise<{ apiSyncFailed: boolean; session: SessionState | null }>;
  createSession: (locale: WorkspaceLocale) => Promise<{ apiSyncFailed: boolean }>;
  deleteSession: (index: number) => Promise<{ apiSyncFailed: boolean; guarded: boolean; session: SessionState | null }>;
  hydrateTimelineBySessionId: (sessionId: string) => Promise<{ apiSyncFailed: boolean }>;
  openSession: (index: number) => SessionState | null;
  renameSession: (index: number) => Promise<{ apiSyncFailed: boolean; session: SessionState | null }>;
};

type UseWorkspaceSessionActionsOptions = {
  addEvent: AddEvent;
  onSessionOpened: () => void;
  resolveSessionTitle: (session: SessionState | null) => string;
  sessions: Ref<SessionState[]>;
  workspace: WorkspaceSessionStore;
  workspaceLocale: ComputedRef<WorkspaceLocale>;
};

export function useWorkspaceSessionActions(options: UseWorkspaceSessionActionsOptions) {
  function openSession(index: number, eventKey = "events.sessionOpen"): void {
    const session = options.workspace.openSession(index);
    if (!session) {
      options.addEvent("events.sessionNone", "warn");
      return;
    }
    options.addEvent(eventKey, "info", {
      title: options.resolveSessionTitle(session)
    });

    void options.workspace.hydrateTimelineBySessionId(session.id).then((result) => {
      if (result.apiSyncFailed) {
        options.addEvent("events.timelineSyncFailed", "warn");
      }
    });

    options.onSessionOpened();
  }

  async function createSession(): Promise<void> {
    const result = await options.workspace.createSession(options.workspaceLocale.value);
    if (result.apiSyncFailed) {
      options.addEvent("events.apiSyncFailed", "warn");
    }
    openSession(0, "events.sessionCreate");
  }

  async function renameSession(index: number): Promise<void> {
    const result = await options.workspace.renameSession(index);
    if (!result.session) {
      options.addEvent("events.sessionNone", "warn");
      return;
    }

    options.addEvent("events.sessionRename", "info", {
      title: options.resolveSessionTitle(result.session)
    });

    if (result.apiSyncFailed) {
      options.addEvent("events.apiSyncFailed", "warn");
    }
  }

  async function archiveSession(index: number): Promise<void> {
    const initial = options.sessions.value[index];
    if (!initial) {
      options.addEvent("events.sessionNone", "warn");
      return;
    }

    if (initial.archived) {
      return;
    }

    const result = await options.workspace.archiveSession(index);
    if (!result.session) {
      return;
    }

    options.addEvent("events.sessionArchive", "warn", {
      title: options.resolveSessionTitle(result.session)
    });

    if (result.apiSyncFailed) {
      options.addEvent("events.apiSyncFailed", "warn");
    }
  }

  async function deleteSession(index: number): Promise<void> {
    const result = await options.workspace.deleteSession(index);
    if (result.guarded) {
      options.addEvent("events.sessionLastGuard", "warn");
      return;
    }

    if (!result.session) {
      options.addEvent("events.sessionNone", "warn");
      return;
    }

    options.addEvent("events.sessionDelete", "warn", {
      title: options.resolveSessionTitle(result.session)
    });

    if (result.apiSyncFailed) {
      options.addEvent("events.apiSyncFailed", "warn");
    }
  }

  return {
    archiveSession,
    createSession,
    deleteSession,
    openSession,
    renameSession
  };
}

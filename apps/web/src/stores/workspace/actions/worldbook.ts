import type { ComputedRef } from "vue";

import type { SessionState, WorkspaceAsset } from "../types";

type WorldbookActionsContext = {
  activeSession: ComputedRef<SessionState | null>;
  findLibraryAsset: (assetId: string) => WorkspaceAsset | null;
  libraryAssets: ComputedRef<WorkspaceAsset[]>;
  syncSessionWorldbookCount: (session: SessionState) => void;
  touchLibraryAsset: (asset: WorkspaceAsset) => void;
};

export function createWorldbookActions(context: WorldbookActionsContext) {
  function isWorldbookBoundToActiveSession(assetId: string): boolean {
    const session = context.activeSession.value;
    if (!session) {
      return false;
    }

    return session.worldbookProfileId === assetId;
  }

  function attachWorldbook(): SessionState | null {
    const session = context.activeSession.value;
    if (!session) {
      return null;
    }

    const worldbookAssets = context.libraryAssets.value.filter((asset) => asset.kind === "worldbook");
    if (worldbookAssets.length === 0) {
      return session;
    }

    const currentIndex = worldbookAssets.findIndex((asset) => asset.id === session.worldbookProfileId);
    const next = worldbookAssets[(currentIndex + 1 + worldbookAssets.length) % worldbookAssets.length] ?? worldbookAssets[0];
    if (!next) {
      return session;
    }

    session.worldbookProfileId = next.id;
    context.syncSessionWorldbookCount(session);
    context.touchLibraryAsset(next);
    return session;
  }

  function unbindWorldbookFromActiveSession(targetAssetId?: string): { guarded: boolean; session: SessionState | null } {
    const session = context.activeSession.value;
    if (!session) {
      return {
        guarded: false,
        session: null
      };
    }

    if (!session.worldbookProfileId) {
      return {
        guarded: true,
        session
      };
    }

    if (targetAssetId && session.worldbookProfileId !== targetAssetId) {
      return {
        guarded: true,
        session
      };
    }

    session.worldbookProfileId = null;
    context.syncSessionWorldbookCount(session);

    return {
      guarded: false,
      session
    };
  }

  function detachWorldbook(): { guarded: boolean; session: SessionState | null } {
    return unbindWorldbookFromActiveSession();
  }

  function bindWorldbookToActiveSession(assetId: string): {
    bindingChanged: boolean;
    ok: boolean;
    reason?: "missing" | "no_session" | "unsupported";
    session: SessionState | null;
  } {
    const session = context.activeSession.value;
    if (!session) {
      return {
        bindingChanged: false,
        ok: false,
        reason: "no_session",
        session: null
      };
    }

    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        bindingChanged: false,
        ok: false,
        reason: "missing",
        session
      };
    }

    if (asset.kind !== "worldbook") {
      return {
        bindingChanged: false,
        ok: false,
        reason: "unsupported",
        session
      };
    }

    const previous = session.worldbookProfileId;
    session.worldbookProfileId = asset.id;
    context.syncSessionWorldbookCount(session);
    context.touchLibraryAsset(asset);

    return {
      bindingChanged: previous !== asset.id,
      ok: true,
      session
    };
  }

  return {
    attachWorldbook,
    bindWorldbookToActiveSession,
    detachWorldbook,
    isWorldbookBoundToActiveSession,
    unbindWorldbookFromActiveSession
  };
}

import type { ComputedRef } from "vue";

import { updateSessionAssetBindings as updateSessionAssetBindingsApi } from "../../../lib/workspace-api";
import type { SessionState, WorkspaceAsset } from "../types";

type WorldbookActionsContext = {
  activeSession: ComputedRef<SessionState | null>;
  currentAccount: ComputedRef<string>;
  findLibraryAsset: (assetId: string) => WorkspaceAsset | null;
  libraryAssets: ComputedRef<WorkspaceAsset[]>;
  syncSessionWorldbookCount: (session: SessionState) => void;
  touchLibraryAsset: (asset: WorkspaceAsset) => void;
};

export function createWorldbookActions(context: WorldbookActionsContext) {
  async function persistWorldbookBinding(session: SessionState, worldbookProfileId: string | null): Promise<boolean> {
    try {
      const updated = await updateSessionAssetBindingsApi(
        session.id,
        { worldbookProfileId },
        session.account || context.currentAccount.value
      );
      session.deepBinding = updated.deepBinding;
      session.worldbookProfileId = updated.worldbookProfileId;
      session.worldbookVersionId = updated.worldbookVersionId;
      context.syncSessionWorldbookCount(session);
      return false;
    } catch {
      return true;
    }
  }

  function isWorldbookBoundToActiveSession(assetId: string): boolean {
    const session = context.activeSession.value;
    if (!session) {
      return false;
    }

    return session.worldbookProfileId === assetId;
  }

  async function attachWorldbook(): Promise<{ apiSyncFailed: boolean; session: SessionState | null }> {
    const session = context.activeSession.value;
    if (!session) {
      return { apiSyncFailed: false, session: null };
    }

    const worldbookAssets = context.libraryAssets.value.filter((asset) => asset.kind === "worldbook");
    if (worldbookAssets.length === 0) {
      return { apiSyncFailed: false, session };
    }

    const currentIndex = worldbookAssets.findIndex((asset) => asset.id === session.worldbookProfileId);
    const next = worldbookAssets[(currentIndex + 1 + worldbookAssets.length) % worldbookAssets.length] ?? worldbookAssets[0];
    if (!next) {
      return { apiSyncFailed: false, session };
    }

    const previous = session.worldbookProfileId;
    session.worldbookProfileId = next.id;
    context.syncSessionWorldbookCount(session);
    const apiSyncFailed = previous === next.id
      ? false
      : await persistWorldbookBinding(session, next.id);
    context.touchLibraryAsset(next);
    return { apiSyncFailed, session };
  }

  async function unbindWorldbookFromActiveSession(targetAssetId?: string): Promise<{ apiSyncFailed: boolean; guarded: boolean; session: SessionState | null }> {
    const session = context.activeSession.value;
    if (!session) {
      return {
        apiSyncFailed: false,
        guarded: false,
        session: null
      };
    }

    if (!session.worldbookProfileId) {
      return {
        apiSyncFailed: false,
        guarded: true,
        session
      };
    }

    if (targetAssetId && session.worldbookProfileId !== targetAssetId) {
      return {
        apiSyncFailed: false,
        guarded: true,
        session
      };
    }

    session.worldbookProfileId = null;
    context.syncSessionWorldbookCount(session);
    const apiSyncFailed = await persistWorldbookBinding(session, null);

    return {
      apiSyncFailed,
      guarded: false,
      session
    };
  }

  async function detachWorldbook(): Promise<{ apiSyncFailed: boolean; guarded: boolean; session: SessionState | null }> {
    return unbindWorldbookFromActiveSession();
  }

  async function bindWorldbookToActiveSession(assetId: string): Promise<{
    apiSyncFailed: boolean;
    bindingChanged: boolean;
    ok: boolean;
    reason?: "missing" | "no_session" | "unsupported";
    session: SessionState | null;
  }> {
    const session = context.activeSession.value;
    if (!session) {
      return {
        apiSyncFailed: false,
        bindingChanged: false,
        ok: false,
        reason: "no_session",
        session: null
      };
    }

    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        apiSyncFailed: false,
        bindingChanged: false,
        ok: false,
        reason: "missing",
        session
      };
    }

    if (asset.kind !== "worldbook") {
      return {
        apiSyncFailed: false,
        bindingChanged: false,
        ok: false,
        reason: "unsupported",
        session
      };
    }

    const previous = session.worldbookProfileId;
    session.worldbookProfileId = asset.id;
    context.syncSessionWorldbookCount(session);
    const bindingChanged = previous !== asset.id;
    const apiSyncFailed = bindingChanged
      ? await persistWorldbookBinding(session, asset.id)
      : false;
    context.touchLibraryAsset(asset);

    return {
      apiSyncFailed,
      bindingChanged,
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

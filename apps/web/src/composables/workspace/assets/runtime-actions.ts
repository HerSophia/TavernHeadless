import type { ComputedRef, Ref } from "vue";

import { countTurnSummaries, resolveTurnCompletionEventKey } from "../messages/turn-result-events";
import type {
  AssetApplyResult,
  AssetFavoriteResult,
  SendMessageResult,
  SessionState,
  WorkspaceAsset
} from "../../../stores/workspace";
import type { EventTone } from "../../../stores/workspace-ui";

type AddEvent = (key: string, tone?: EventTone, vars?: Record<string, number | string>) => void;

type WorkspaceRuntimeStore = {
  applyAssetFromLibrary: (assetId: string) => Promise<AssetApplyResult>;
  attachWorldbook: () => Promise<{ apiSyncFailed: boolean; session: SessionState | null }>;
  detachWorldbook: () => Promise<{ apiSyncFailed: boolean; guarded: boolean; session: SessionState | null }>;
  previewLibraryAsset: (assetId: string) => WorkspaceAsset | null;
  replaceUser: () => SessionState | null;
  sendMessage: (content: string) => Promise<SendMessageResult>;
  toggleLibraryFavorite: (assetId: string) => AssetFavoriteResult;
};

type UseWorkspaceRuntimeActionsOptions = {
  activeSession: ComputedRef<SessionState | null>;
  addEvent: AddEvent;
  flashBindingCard: () => void;
  isStreaming: ComputedRef<boolean>;
  messageInput: Ref<string>;
  resolveAssetKindLabel: (kind: WorkspaceAsset["kind"]) => string;
  workspace: WorkspaceRuntimeStore;
};

export function useWorkspaceRuntimeActions(options: UseWorkspaceRuntimeActionsOptions) {
  function replaceUser(): void {
    const session = options.workspace.replaceUser();
    if (!session) {
      return;
    }

    options.flashBindingCard();
    options.addEvent("events.replaceUser", "info", {
      user: session.userName
    });
  }

  async function attachWorldbook(): Promise<void> {
    const result = await options.workspace.attachWorldbook();
    const session = result.session;
    if (!session) {
      return;
    }

    options.flashBindingCard();
    options.addEvent("events.attachWorldbook", "success", {
      count: session.worldbookCount
    });
    if (result.apiSyncFailed) {
      options.addEvent("events.apiSyncFailed", "warn");
    }
  }

  async function detachWorldbook(): Promise<void> {
    const result = await options.workspace.detachWorldbook();
    if (!result.session) {
      return;
    }

    if (result.guarded) {
      options.addEvent("events.noWorldbook", "warn");
      return;
    }

    options.flashBindingCard();
    options.addEvent("events.detachWorldbook", "warn", {
      count: result.session.worldbookCount
    });
    if (result.apiSyncFailed) {
      options.addEvent("events.apiSyncFailed", "warn");
    }
  }

  function applyUserAsset(): void {
    options.flashBindingCard();
    options.addEvent("events.applyUser", "success");
  }

  function openLibraryAsset(assetId: string): void {
    const asset = options.workspace.previewLibraryAsset(assetId);
    if (!asset) {
      options.addEvent("events.assetMissing", "warn");
      return;
    }

    options.addEvent("events.assetOpen", "info", {
      asset: asset.name,
      kind: options.resolveAssetKindLabel(asset.kind)
    });
  }

  async function applyLibraryAsset(assetId: string): Promise<void> {
    const result = await options.workspace.applyAssetFromLibrary(assetId);
    if (!result.ok || !result.asset) {
      if (result.reason === "no_session") {
        options.addEvent("events.sessionNone", "warn");
        return;
      }

      options.addEvent("events.assetMissing", "warn");
      return;
    }

    if (result.bindingChanged) {
      options.flashBindingCard();
    }

    options.addEvent("events.assetApplied", "success", {
      asset: result.asset.name,
      kind: options.resolveAssetKindLabel(result.asset.kind)
    });
    if (result.apiSyncFailed) {
      options.addEvent("events.apiSyncFailed", "warn");
    }
  }

  function toggleAssetFavorite(assetId: string): void {
    const result = options.workspace.toggleLibraryFavorite(assetId);
    if (!result.ok || !result.asset) {
      options.addEvent("events.assetMissing", "warn");
      return;
    }

    options.addEvent(result.asset.favorite ? "events.assetPinned" : "events.assetUnpinned", "info", {
      asset: result.asset.name,
      kind: options.resolveAssetKindLabel(result.asset.kind)
    });
  }

  async function sendMessage(): Promise<void> {
    if (!options.activeSession.value) {
      return;
    }

    if (options.isStreaming.value) {
      options.addEvent("events.streamingGuard", "warn");
      return;
    }

    const text = options.messageInput.value;
    if (!text.trim()) {
      return;
    }

    options.messageInput.value = "";
    options.addEvent("events.respondStart", "info");

    const result = await options.workspace.sendMessage(text);

    if (result.streamFallback) {
      options.addEvent("events.streamFallback", "warn");
    }

    if (result.localFallback) {
      options.addEvent("events.respondLocalFallback", "warn");
    }

    if (!result.ok) {
      options.addEvent("events.apiSyncFailed", "warn");
      return;
    }

    if (result.timelineSyncFailed) {
      options.addEvent("events.timelineSyncFailed", "warn");
    }

    const successVars: Record<string, number | string> = {
      ms: result.latencyMs,
      tokens: result.tokens
    };
    const summaryCount = countTurnSummaries(result.result);
    if (summaryCount > 0) {
      successVars.summaries = summaryCount;
    }
    if (result.result?.finalState && result.result.finalState !== "committed") {
      successVars.state = result.result.finalState;
    }

    options.addEvent(resolveTurnCompletionEventKey("events.respondDone", result.result), "success", successVars);
  }

  return {
    applyLibraryAsset,
    applyUserAsset,
    attachWorldbook,
    detachWorldbook,
    openLibraryAsset,
    replaceUser,
    sendMessage,
    toggleAssetFavorite
  };
}

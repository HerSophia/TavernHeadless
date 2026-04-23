import { computed, reactive, type ComputedRef } from "vue";

import { countTurnSummaries, resolveTurnCompletionEventKey } from "./turn-result-events";

import type {
  RegenerateFromMessageResult,
  TimelineMessage,
  UpdateOrDeleteResult
} from "../../../stores/workspace";
import type { WorkspaceReplayBlockingExecution, WorkspaceReplayBlockingSessionStateMutation } from "../../../lib/workspace-api";
import type { EventTone } from "../../../stores/workspace-ui";

type AddEvent = (key: string, tone?: EventTone, vars?: Record<string, number | string>) => void;

type WorkspaceMessageStore = {
  deleteTimelineMessage: (messageId: string) => Promise<UpdateOrDeleteResult>;
  editAndRegenerateFromMessage: (messageId: string, content: string) => Promise<RegenerateFromMessageResult>;
  retryMessageFloor: (
    messageId: string,
    options?: { confirmedExecutionIds?: string[]; confirmedSessionStateMutationIds?: string[] }
  ) => Promise<RegenerateFromMessageResult>;
  updateTimelineMessage: (messageId: string, content: string) => Promise<UpdateOrDeleteResult>;
};

type UseWorkspaceMessageDialogOptions = {
  activeTimeline: ComputedRef<TimelineMessage[]>;
  addEvent: AddEvent;
  runtimeCharacterName: ComputedRef<string>;
  t: (key: string, vars?: Record<string, number | string>) => string;
  workspace: WorkspaceMessageStore;
};

export function useWorkspaceMessageDialog(options: UseWorkspaceMessageDialogOptions) {
  const messageDialog = reactive({
    deleteOpen: false,
    draft: "",
    editOpen: false,
    retryOpen: false,
    targetId: "",
    targetRole: null as TimelineMessage["role"] | null
  });

  const toolReplayConfirmDialog = reactive({
    blockingExecutions: [] as WorkspaceReplayBlockingExecution[],
    blockingSessionStateMutations: [] as WorkspaceReplayBlockingSessionStateMutation[],
    busy: false,
    open: false
  });

  function getMessageRoleLabel(role: TimelineMessage["role"]): string {
    if (role === "assistant") {
      return options.runtimeCharacterName.value;
    }

    if (role === "narrator") {
      return options.t("chat.narrator");
    }

    if (role === "system") {
      return options.t("chat.system");
    }

    return options.t("chat.user");
  }

  function getTimelineMessage(messageId: string): TimelineMessage | null {
    return options.activeTimeline.value.find((item) => item.id === messageId) ?? null;
  }

  function setMessageDialogTarget(message: TimelineMessage): void {
    messageDialog.targetId = message.id;
    messageDialog.targetRole = message.role;
    messageDialog.draft = message.content;
  }

  function clearMessageDialogTarget(): void {
    messageDialog.targetId = "";
    messageDialog.targetRole = null;
    messageDialog.draft = "";
  }

  function resetToolReplayConfirmDialog(): void {
    toolReplayConfirmDialog.blockingExecutions = [];
    toolReplayConfirmDialog.blockingSessionStateMutations = [];
    toolReplayConfirmDialog.busy = false;
    toolReplayConfirmDialog.open = false;
  }

  function closeMessageDialogs(): void {
    messageDialog.deleteOpen = false;
    messageDialog.editOpen = false;
    messageDialog.retryOpen = false;
    resetToolReplayConfirmDialog();
  }

  const messageDialogRoleLabel = computed(() => {
    if (!messageDialog.targetRole) {
      return options.t("chat.system");
    }

    return getMessageRoleLabel(messageDialog.targetRole);
  });

  function buildTurnCompletionEventVars(
    role: string,
    result?: RegenerateFromMessageResult["result"]
  ): Record<string, number | string> {
    const vars: Record<string, number | string> = {
      role,
      tokens: result?.totalTokens ?? 0
    };
    const summaryCount = countTurnSummaries(result);
    if (summaryCount > 0) {
      vars.summaries = summaryCount;
    }
    if (result?.finalState && result.finalState !== "committed") {
      vars.state = result.finalState;
    }
    return vars;
  }

  function openEditMessageDialog(messageId: string): void {
    const target = getTimelineMessage(messageId);
    if (!target) {
      options.addEvent("events.messageMissing", "warn");
      return;
    }

    if (target.streaming) {
      options.addEvent("events.streamingGuard", "warn");
      return;
    }

    setMessageDialogTarget(target);
    messageDialog.editOpen = true;
  }

  function openDeleteMessageDialog(messageId: string): void {
    const target = getTimelineMessage(messageId);
    if (!target) {
      options.addEvent("events.messageMissing", "warn");
      return;
    }

    if (target.streaming) {
      options.addEvent("events.streamingGuard", "warn");
      return;
    }

    setMessageDialogTarget(target);
    messageDialog.deleteOpen = true;
  }

  function openRetryFloorDialog(messageId: string): void {
    const target = getTimelineMessage(messageId);
    if (!target) {
      options.addEvent("events.messageMissing", "warn");
      return;
    }

    if (target.streaming) {
      options.addEvent("events.streamingGuard", "warn");
      return;
    }

    resetToolReplayConfirmDialog();
    setMessageDialogTarget(target);
    messageDialog.retryOpen = true;
  }

  async function confirmEditMessage(): Promise<void> {
    if (!messageDialog.targetId) {
      options.addEvent("events.messageMissing", "warn");
      return;
    }

    const target = getTimelineMessage(messageDialog.targetId);
    if (!target) {
      options.addEvent("events.messageMissing", "warn");
      closeMessageDialogs();
      clearMessageDialogTarget();
      return;
    }

    const result = await options.workspace.updateTimelineMessage(messageDialog.targetId, messageDialog.draft);
    if (!result.ok) {
      if (result.reason === "empty") {
        options.addEvent("events.messageEmptyGuard", "warn");
        return;
      }

      if (result.reason === "guarded") {
        options.addEvent("events.streamingGuard", "warn");
        return;
      }

      if (result.reason === "missing") {
        options.addEvent("events.messageMissing", "warn");
        closeMessageDialogs();
        clearMessageDialogTarget();
        return;
      }

      options.addEvent("events.messageUpdateFailed", "warn");
      return;
    }

    closeMessageDialogs();
    clearMessageDialogTarget();

    options.addEvent("events.messageUpdated", "success", {
      role: getMessageRoleLabel(target.role)
    });
  }

  async function confirmEditAndRegenerate(): Promise<void> {
    if (!messageDialog.targetId) {
      options.addEvent("events.messageMissing", "warn");
      return;
    }

    const target = getTimelineMessage(messageDialog.targetId);
    if (!target) {
      options.addEvent("events.messageMissing", "warn");
      closeMessageDialogs();
      clearMessageDialogTarget();
      return;
    }

    const result = await options.workspace.editAndRegenerateFromMessage(messageDialog.targetId, messageDialog.draft);
    if (!result.ok) {
      if (result.reason === "empty") {
        options.addEvent("events.messageEmptyGuard", "warn");
        return;
      }

      if (result.reason === "guarded") {
        options.addEvent("events.streamingGuard", "warn");
        return;
      }

      if (result.reason === "missing") {
        options.addEvent("events.messageMissing", "warn");
        closeMessageDialogs();
        clearMessageDialogTarget();
        return;
      }

      if (result.reason === "unsupported") {
        options.addEvent("events.messageRegenerateUnsupported", "warn");
        return;
      }

      options.addEvent("events.messageRegenerateFailed", "warn");
      return;
    }

    closeMessageDialogs();
    clearMessageDialogTarget();

    if (result.apiSyncFailed) {
      options.addEvent("events.timelineSyncFailed", "warn");
    }

    options.addEvent(
      resolveTurnCompletionEventKey("events.messageRegenerated", result.result),
      "success",
      buildTurnCompletionEventVars(getMessageRoleLabel(target.role), result.result)
    );
  }

  async function confirmDeleteMessage(): Promise<void> {
    if (!messageDialog.targetId) {
      options.addEvent("events.messageMissing", "warn");
      return;
    }

    const result = await options.workspace.deleteTimelineMessage(messageDialog.targetId);
    if (!result.ok) {
      if (result.reason === "missing") {
        options.addEvent("events.messageMissing", "warn");
        closeMessageDialogs();
        clearMessageDialogTarget();
        return;
      }

      if (result.reason === "guarded") {
        options.addEvent("events.streamingGuard", "warn");
        return;
      }

      options.addEvent("events.messageDeleteFailed", "warn");
      return;
    }

    closeMessageDialogs();
    clearMessageDialogTarget();

    options.addEvent("events.messageDeleted", "warn", {
      role: result.message ? getMessageRoleLabel(result.message.role) : options.t("chat.system")
    });
  }

  async function confirmRetryFloor(): Promise<void> {
    if (!messageDialog.targetId) {
      options.addEvent("events.messageMissing", "warn");
      return;
    }

    const target = getTimelineMessage(messageDialog.targetId);
    if (!target) {
      options.addEvent("events.messageMissing", "warn");
      closeMessageDialogs();
      clearMessageDialogTarget();
      return;
    }

    const result = await options.workspace.retryMessageFloor(messageDialog.targetId);
    if (!result.ok) {
      if (result.reason === "guarded") {
        options.addEvent("events.streamingGuard", "warn");
        return;
      }

      if (result.reason === "confirmation_required") {
        toolReplayConfirmDialog.blockingExecutions = result.blockingExecutions ?? [];
        toolReplayConfirmDialog.blockingSessionStateMutations = result.blockingSessionStateMutations ?? [];
        toolReplayConfirmDialog.open = true;
        messageDialog.retryOpen = false;
        options.addEvent("events.messageRetryConfirmationRequired", "warn", {
          count: toolReplayConfirmDialog.blockingExecutions.length + toolReplayConfirmDialog.blockingSessionStateMutations.length
        });
        return;
      }

      if (result.reason === "blocked") {
        closeMessageDialogs();
        clearMessageDialogTarget();
        options.addEvent("events.messageRetryReplayBlocked", "warn", {
          count: (result.blockingExecutions?.length ?? 0) + (result.blockingSessionStateMutations?.length ?? 0)
        });
        return;
      }

      if (result.reason === "missing") {
        options.addEvent("events.messageMissing", "warn");
        closeMessageDialogs();
        clearMessageDialogTarget();
        return;
      }

      if (result.reason === "unsupported") {
        options.addEvent("events.messageRetryUnsupported", "warn");
        return;
      }

      options.addEvent("events.messageRetryFailed", "warn");
      return;
    }

    closeMessageDialogs();
    clearMessageDialogTarget();

    if (result.apiSyncFailed) {
      options.addEvent("events.timelineSyncFailed", "warn");
    }

    options.addEvent(
      resolveTurnCompletionEventKey("events.messageRetried", result.result),
      "success",
      buildTurnCompletionEventVars(getMessageRoleLabel(target.role), result.result)
    );
  }

  async function confirmToolReplay(): Promise<void> {
    if (!messageDialog.targetId) {
      options.addEvent("events.messageMissing", "warn");
      return;
    }

    const target = getTimelineMessage(messageDialog.targetId);
    if (!target) {
      options.addEvent("events.messageMissing", "warn");
      closeMessageDialogs();
      clearMessageDialogTarget();
      return;
    }

    toolReplayConfirmDialog.busy = true;

    try {
      const result = await options.workspace.retryMessageFloor(messageDialog.targetId, {
        confirmedExecutionIds: toolReplayConfirmDialog.blockingExecutions.map((execution: WorkspaceReplayBlockingExecution) => execution.executionId),
        ...(toolReplayConfirmDialog.blockingSessionStateMutations.length > 0
          ? { confirmedSessionStateMutationIds: toolReplayConfirmDialog.blockingSessionStateMutations.map((mutation) => mutation.mutationId) }
          : {})
      });

      if (!result.ok) {
        if (result.reason === "confirmation_required") {
          toolReplayConfirmDialog.blockingExecutions = result.blockingExecutions ?? [];
          toolReplayConfirmDialog.blockingSessionStateMutations = result.blockingSessionStateMutations ?? [];
          toolReplayConfirmDialog.open = true;
          options.addEvent("events.messageRetryConfirmationRequired", "warn", {
            count: toolReplayConfirmDialog.blockingExecutions.length + toolReplayConfirmDialog.blockingSessionStateMutations.length
          });
          return;
        }

        if (result.reason === "blocked") {
          closeMessageDialogs();
          clearMessageDialogTarget();
          options.addEvent("events.messageRetryReplayBlocked", "warn", {
            count: (result.blockingExecutions?.length ?? 0) + (result.blockingSessionStateMutations?.length ?? 0)
          });
          return;
        }

        if (result.reason === "guarded") {
          options.addEvent("events.streamingGuard", "warn");
          return;
        }

        if (result.reason === "missing") {
          options.addEvent("events.messageMissing", "warn");
          closeMessageDialogs();
          clearMessageDialogTarget();
          return;
        }

        if (result.reason === "unsupported") {
          options.addEvent("events.messageRetryUnsupported", "warn");
          return;
        }

        options.addEvent("events.messageRetryFailed", "warn");
        return;
      }

      closeMessageDialogs();
      clearMessageDialogTarget();

      if (result.apiSyncFailed) {
        options.addEvent("events.timelineSyncFailed", "warn");
      }

      options.addEvent(
        resolveTurnCompletionEventKey("events.messageRetried", result.result),
        "success",
        buildTurnCompletionEventVars(getMessageRoleLabel(target.role), result.result)
      );
    } finally {
      toolReplayConfirmDialog.busy = false;
    }
  }

  return {
    clearMessageDialogTarget,
    closeMessageDialogs,
    confirmDeleteMessage,
    confirmEditAndRegenerate,
    confirmEditMessage,
    confirmToolReplay,
    confirmRetryFloor,
    messageDialog,
    messageDialogRoleLabel,
    openDeleteMessageDialog,
    openEditMessageDialog,
    openRetryFloorDialog,
    toolReplayConfirmDialog
  };
}

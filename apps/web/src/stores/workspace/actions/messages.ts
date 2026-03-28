import type { ComputedRef } from "vue";

import {
  deleteMessageById,
  editAndRegenerateMessage as editAndRegenerateMessageApi,
  extractToolReplayBlockingExecutions,
  isToolReplayBlockedError,
  isToolReplayConfirmationRequiredError,
  respondInSession,
  retryFloor as retryFloorApi,
  streamSessionResponse,
  type StreamStartPayload,
  type WorkspaceRespondStreamEvent,
  type WorkspaceRespondResult,
  updateMessageContent
} from "../../../lib/workspace-api";
import { animateMockAssistantReply } from "../timeline-draft";
import type {
  MessageBucketLocation,
  RegenerateFromMessageResult,
  SendMessageResult,
  SessionState,
  TimelineHydrationResult,
  TimelineMessage,
  UpdateOrDeleteResult
} from "../types";

type MessageActionsContext = {
  activeSession: ComputedRef<SessionState | null>;
  createMessageId: (prefix: string) => string;
  currentAccount: ComputedRef<string>;
  ensureTimeline: (sessionId: string) => TimelineMessage[];
  findActiveMessage: (messageId: string) => MessageBucketLocation | null;
  hydrateActiveTimeline: () => Promise<TimelineHydrationResult>;
  hydrateSessionTimeline: (sessionId: string, accountId?: string) => Promise<TimelineHydrationResult>;
  isStreaming: ComputedRef<boolean>;
  recordRespondStreamEvent?: (event: WorkspaceRespondStreamEvent) => void;
  resetRespondStreamState?: () => void;
};

function applyDraftFloorMetadata(
  message: TimelineMessage,
  metadata: {
    floorId?: string;
    floorNo?: number;
    floorState?: string;
  }
): void {
  if (metadata.floorId) {
    message.floorId = metadata.floorId;
  }

  if (metadata.floorNo !== undefined) {
    message.floorNo = metadata.floorNo;
  }

  if (metadata.floorState) {
    message.floorState = metadata.floorState;
  }
}

function applyStreamStartMetadata(messages: TimelineMessage[], payload: StreamStartPayload): void {
  messages.forEach((message) => {
    applyDraftFloorMetadata(message, {
      floorId: payload.floor_id,
      floorNo: payload.floor_no
    });
  });
}

function applyRespondResultMetadata(messages: TimelineMessage[], result: WorkspaceRespondResult): void {
  messages.forEach((message) => {
    applyDraftFloorMetadata(message, {
      floorId: result.floorId,
      floorNo: result.floorNo,
      floorState: result.finalState
    });
  });
}

export function createMessageActions(context: MessageActionsContext) {
  async function updateTimelineMessage(messageId: string, nextContent: string): Promise<UpdateOrDeleteResult> {
    const location = context.findActiveMessage(messageId);
    if (!location) {
      return {
        apiSyncFailed: false,
        message: null,
        ok: false,
        reason: "missing"
      };
    }

    const message = location.bucket[location.index] ?? null;
    if (!message || message.streaming) {
      return {
        apiSyncFailed: false,
        message,
        ok: false,
        reason: "guarded"
      };
    }

    const content = nextContent.trim();
    if (!content) {
      return {
        apiSyncFailed: false,
        message,
        ok: false,
        reason: "empty"
      };
    }

    const previousContent = message.content;
    message.content = content;

    if (!message.persisted) {
      return {
        apiSyncFailed: false,
        message,
        ok: true
      };
    }

    try {
      const updated = await updateMessageContent(messageId, content, context.currentAccount.value);
      if (!updated) {
        message.content = previousContent;
        return {
          apiSyncFailed: true,
          message,
          ok: false,
          reason: "failed"
        };
      }

      message.content = updated.content;
      return {
        apiSyncFailed: false,
        message,
        ok: true
      };
    } catch {
      message.content = previousContent;
      return {
        apiSyncFailed: true,
        message,
        ok: false,
        reason: "failed"
      };
    }
  }

  async function deleteTimelineMessage(messageId: string): Promise<UpdateOrDeleteResult> {
    const location = context.findActiveMessage(messageId);
    if (!location) {
      return {
        apiSyncFailed: false,
        message: null,
        ok: false,
        reason: "missing"
      };
    }

    const message = location.bucket[location.index] ?? null;
    if (!message || message.streaming) {
      return {
        apiSyncFailed: false,
        message,
        ok: false,
        reason: "guarded"
      };
    }

    if (message.persisted) {
      try {
        const deleted = await deleteMessageById(messageId, context.currentAccount.value);
        if (!deleted) {
          return {
            apiSyncFailed: true,
            message,
            ok: false,
            reason: "failed"
          };
        }
      } catch {
        return {
          apiSyncFailed: true,
          message,
          ok: false,
          reason: "failed"
        };
      }
    }

    location.bucket.splice(location.index, 1);

    return {
      apiSyncFailed: false,
      message,
      ok: true
    };
  }

  async function editAndRegenerateFromMessage(
    messageId: string,
    nextContent: string
  ): Promise<RegenerateFromMessageResult> {
    const location = context.findActiveMessage(messageId);
    if (!location) {
      return {
        apiSyncFailed: false,
        ok: false,
        reason: "missing"
      };
    }

    const message = location.bucket[location.index] ?? null;
    if (!message || message.streaming) {
      return {
        apiSyncFailed: false,
        ok: false,
        reason: "guarded"
      };
    }

    if (!message.persisted) {
      return {
        apiSyncFailed: false,
        ok: false,
        reason: "unsupported"
      };
    }

    if (message.role !== "user") {
      return {
        apiSyncFailed: false,
        ok: false,
        reason: "unsupported"
      };
    }

    const content = nextContent.trim();
    if (!content) {
      return {
        apiSyncFailed: false,
        ok: false,
        reason: "empty"
      };
    }

    try {
      const regenerateResult = await editAndRegenerateMessageApi(messageId, content, context.currentAccount.value);
      const timelineResult = await context.hydrateActiveTimeline();
      return {
        apiSyncFailed: timelineResult.apiSyncFailed,
        ok: true,
        reason: undefined,
        result: regenerateResult
      };
    } catch {
      return {
        apiSyncFailed: true,
        ok: false,
        reason: "failed"
      };
    }
  }

  async function retryMessageFloor(
    messageId: string,
    options?: { confirmedExecutionIds?: string[] }
  ): Promise<RegenerateFromMessageResult> {
    const location = context.findActiveMessage(messageId);
    if (!location) {
      return {
        apiSyncFailed: false,
        ok: false,
        reason: "missing"
      };
    }

    const message = location.bucket[location.index] ?? null;
    if (!message || message.streaming) {
      return {
        apiSyncFailed: false,
        ok: false,
        reason: "guarded"
      };
    }

    if (!message.persisted) {
      return {
        apiSyncFailed: false,
        ok: false,
        reason: "unsupported"
      };
    }

    if (!message.floorId) {
      return {
        apiSyncFailed: false,
        ok: false,
        reason: "unsupported"
      };
    }

    try {
      const regenerateResult = await retryFloorApi(
        message.floorId,
        context.currentAccount.value,
        options?.confirmedExecutionIds
      );
      const timelineResult = await context.hydrateActiveTimeline();
      return {
        apiSyncFailed: timelineResult.apiSyncFailed,
        ok: true,
        reason: undefined,
        result: regenerateResult
      };
    } catch (error) {
      const blockingExecutions = extractToolReplayBlockingExecutions(error);
      if (isToolReplayConfirmationRequiredError(error)) {
        return {
          apiSyncFailed: false,
          blockingExecutions,
          ok: false,
          reason: "confirmation_required"
        };
      }

      if (isToolReplayBlockedError(error)) {
        return {
          apiSyncFailed: false,
          blockingExecutions,
          ok: false,
          reason: "blocked"
        };
      }

      return {
        apiSyncFailed: true,
        ok: false,
        reason: "failed"
      };
    }
  }

  async function sendMessage(message: string): Promise<SendMessageResult> {
    const session = context.activeSession.value;
    if (!session) {
      return {
        latencyMs: 0,
        localFallback: false,
        timelineSyncFailed: false,
        ok: false,
        reason: "no_session",
        streamFallback: false,
        tokens: 0
      };
    }

    if (context.isStreaming.value) {
      return {
        latencyMs: 0,
        localFallback: false,
        timelineSyncFailed: false,
        ok: false,
        reason: "guarded",
        streamFallback: false,
        tokens: 0
      };
    }

    const text = message.trim();
    if (!text) {
      return {
        latencyMs: 0,
        localFallback: false,
        timelineSyncFailed: false,
        ok: false,
        reason: "empty",
        streamFallback: false,
        tokens: 0
      };
    }

    const bucket = context.ensureTimeline(session.id);
    const userMessage: TimelineMessage = {
      at: Date.now(),
      contentFormat: "text",
      content: text,
      floorId: undefined,
      floorNo: undefined,
      floorState: "draft",
      id: context.createMessageId("user"),
      persisted: false,
      role: "user",
      seq: bucket.length,
      source: "local"
    };
    bucket.push(userMessage);

    const assistantMessage: TimelineMessage = {
      at: Date.now(),
      contentFormat: "text",
      content: "",
      floorId: undefined,
      floorNo: undefined,
      floorState: "draft",
      id: context.createMessageId("assistant"),
      persisted: false,
      role: "assistant",
      seq: bucket.length,
      source: "local",
      streaming: true
    };
    bucket.push(assistantMessage);
    const draftMessages = [userMessage, assistantMessage];

    const startAt = Date.now();
    context.resetRespondStreamState?.();
    let streamDeliveredDoneEvent = false;

    try {
      const result = await streamSessionResponse(session.id, text, {
        accountId: context.currentAccount.value,
        onChunk: (chunk) => {
          assistantMessage.content += chunk;
        },
        onEvent: (event) => {
          if (event.type === "done") {
            streamDeliveredDoneEvent = true;
          }
          context.recordRespondStreamEvent?.(event);
        },
        onStart: (payload) => {
          applyStreamStartMetadata(draftMessages, payload);
        }
      });

      if (!streamDeliveredDoneEvent) {
        context.recordRespondStreamEvent?.({
          payload: {
            branchId: result.branchId,
            finalState: result.finalState,
            floorId: result.floorId,
            floorNo: result.floorNo,
            generatedText: result.generatedText,
            summaries: result.summaries,
            totalUsage: result.totalUsage
          },
          type: "done"
        });
      }

      applyRespondResultMetadata(draftMessages, result);
      assistantMessage.content = result.generatedText || assistantMessage.content;
      assistantMessage.streaming = false;
      assistantMessage.latencyMs = Date.now() - startAt;
      assistantMessage.tokens = Math.max(result.totalTokens, result.outputTokens);

      const timelineResult = await context.hydrateSessionTimeline(session.id, context.currentAccount.value);

      return {
        latencyMs: assistantMessage.latencyMs,
        localFallback: false,
        timelineSyncFailed: timelineResult.apiSyncFailed,
        ok: true,
        result,
        streamFallback: false,
        tokens: assistantMessage.tokens
      };
    } catch {
      context.resetRespondStreamState?.();
      // continue with respond fallback
    }

    try {
      const result = await respondInSession(session.id, text, context.currentAccount.value);
      context.recordRespondStreamEvent?.({
        payload: {
          branchId: result.branchId,
          finalState: result.finalState,
          floorId: result.floorId,
          floorNo: result.floorNo,
          generatedText: result.generatedText,
          summaries: result.summaries,
          totalUsage: result.totalUsage
        },
        type: "done"
      });

      applyRespondResultMetadata(draftMessages, result);
      assistantMessage.content = result.generatedText;
      assistantMessage.streaming = false;
      assistantMessage.latencyMs = Date.now() - startAt;
      assistantMessage.tokens = Math.max(result.totalTokens, result.outputTokens);

      const timelineResult = await context.hydrateSessionTimeline(session.id, context.currentAccount.value);

      return {
        latencyMs: assistantMessage.latencyMs,
        localFallback: false,
        timelineSyncFailed: timelineResult.apiSyncFailed,
        ok: true,
        result,
        streamFallback: true,
        tokens: assistantMessage.tokens
      };
    } catch {
      context.resetRespondStreamState?.();
      // continue with local fallback
    }

    try {
      await animateMockAssistantReply(assistantMessage, text, startAt);

      return {
        latencyMs: assistantMessage.latencyMs ?? 0,
        localFallback: true,
        timelineSyncFailed: false,
        ok: true,
        streamFallback: true,
        tokens: assistantMessage.tokens ?? 0
      };
    } catch {
      assistantMessage.streaming = false;

      return {
        latencyMs: Date.now() - startAt,
        localFallback: true,
        timelineSyncFailed: false,
        ok: false,
        reason: "failed",
        streamFallback: true,
        tokens: assistantMessage.tokens ?? 0
      };
    }
  }

  return {
    deleteTimelineMessage,
    editAndRegenerateFromMessage,
    retryMessageFloor,
    sendMessage,
    updateTimelineMessage
  };
}

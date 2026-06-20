/**
 * 聊天 store（B10 阶段 7）。
 *
 * 单一事实源：当前会话的时间线（floors / pages / messages）、流式发送状态与重生（retry）状态。
 * 会话**选择 / 列表**沿用共享 context store（顶栏切换器）；本 store 只负责选定会话后的
 * 时间线、流式正文与楼层操作。
 *
 * 流式：`sendMessage` 乐观地放一个临时「楼层」（用户输入 + 正在生成的 narrator 正文 + 公开阶段），
 * 流结束后重新拉取时间线得到落库的真实楼层再清除临时态；流式途中可 `abort` 中断。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  chatApi,
  streamRespond,
  type ChatStreamPhase,
  type SessionRecord,
  type SessionTimeline,
  type TimelineFloor,
} from "../lib/chat";

export interface ChatStreamState {
  active: boolean;
  phase: ChatStreamPhase | null;
  /** 乐观回显的用户输入。 */
  pendingUserText: string;
  /** 累加的 narrator 正文。 */
  text: string;
  error: string | null;
  floorNo: number | null;
}

function emptyStream(): ChatStreamState {
  return { active: false, phase: null, pendingUserText: "", text: "", error: null, floorNo: null };
}

function describeError(cause: unknown): string {
  if (cause && typeof cause === "object" && "message" in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return cause instanceof Error ? cause.message : String(cause);
}

export const useChatStore = defineStore("chat", () => {
  const timeline = ref<SessionTimeline | null>(null);
  const loadingTimeline = ref(false);
  const sending = ref(false);
  const regenerating = ref(false);
  const creating = ref(false);
  const error = ref<string | null>(null);
  const stream = ref<ChatStreamState>(emptyStream());
  let abortController: AbortController | null = null;

  const floors = computed<TimelineFloor[]>(() => timeline.value?.floors ?? []);
  const busy = computed(() => sending.value || regenerating.value);
  const latestFloor = computed<TimelineFloor | null>(() =>
    floors.value.length > 0 ? floors.value[floors.value.length - 1]! : null,
  );

  function resetStream(): void {
    stream.value = emptyStream();
  }

  async function loadTimeline(sessionId: string): Promise<void> {
    loadingTimeline.value = true;
    error.value = null;
    try {
      timeline.value = await chatApi.getTimeline(sessionId);
    } catch (cause) {
      timeline.value = null;
      error.value = describeError(cause);
    } finally {
      loadingTimeline.value = false;
    }
  }

  /** 建会话（仅创建，调用方负责刷新 context 会话列表并选中）。 */
  async function createSession(projectId: string, title?: string): Promise<SessionRecord | null> {
    creating.value = true;
    error.value = null;
    try {
      return await chatApi.createSession(projectId, title);
    } catch (cause) {
      error.value = describeError(cause);
      return null;
    } finally {
      creating.value = false;
    }
  }

  async function sendMessage(sessionId: string, text: string): Promise<void> {
    const message = text.trim();
    if (!message || sending.value) {
      return;
    }
    error.value = null;
    sending.value = true;
    stream.value = {
      active: true,
      phase: "preparing",
      pendingUserText: message,
      text: "",
      error: null,
      floorNo: null,
    };
    const controller = new AbortController();
    abortController = controller;
    try {
      await streamRespond({
        sessionId,
        message,
        signal: controller.signal,
        callbacks: {
          onStart: (payload) => {
            stream.value.floorNo = payload.floorNo ?? null;
          },
          onPhase: (phase) => {
            stream.value.phase = phase;
          },
          onChunk: (delta) => {
            stream.value.text += delta;
          },
          onError: (msg) => {
            stream.value.error = msg;
          },
        },
      });
      await loadTimeline(sessionId);
      resetStream();
    } catch (cause) {
      if (controller.signal.aborted) {
        resetStream();
        await loadTimeline(sessionId);
      } else {
        stream.value.error = describeError(cause);
      }
    } finally {
      sending.value = false;
      abortController = null;
    }
  }

  /** 中断进行中的流式生成。 */
  function abort(): void {
    abortController?.abort();
  }

  /** 重生（retry）最新楼层：重跑当前会话最后一回合，拉取新时间线。 */
  async function regenerateLatest(sessionId: string): Promise<void> {
    if (busy.value) {
      return;
    }
    regenerating.value = true;
    error.value = null;
    try {
      await chatApi.regenerate(sessionId);
      await loadTimeline(sessionId);
    } catch (cause) {
      error.value = describeError(cause);
    } finally {
      regenerating.value = false;
    }
  }

  function clearError(): void {
    error.value = null;
  }

  function reset(): void {
    timeline.value = null;
    error.value = null;
    resetStream();
  }

  return {
    // state
    timeline,
    loadingTimeline,
    sending,
    regenerating,
    creating,
    error,
    stream,
    // derived
    floors,
    busy,
    latestFloor,
    // actions
    loadTimeline,
    createSession,
    sendMessage,
    abort,
    regenerateLatest,
    resetStream,
    clearError,
    reset,
  };
});

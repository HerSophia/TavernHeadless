/**
 * 图编辑器临时对话助手 store（图临时对话助手 · 阶段 1）。
 *
 * 单一事实源：图编辑器内一段临时对话的会话记录、消息列表、流式发送状态与生命周期。
 * 复用聊天的乐观流式范式（`stores/chat.ts`）：`sendMessage` 懒创建会话 → 乐观回显用户输入
 * 与「生成中」正文 → 流结束后重新拉取 transcript 以落库真值覆盖乐观态；途中可 `abort`。
 *
 * 边界纪律：默认 inline，结果绝不自动写回图定义 / 变量 / 记忆 / 会话；保留策略交后端 TTL 兜底
 * （创建即带 1 小时 TTL）。切项目 / 卸载只 `reset()` 本地态，不替用户决定 finalize / discard。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  GRAPH_ASSISTANT_PURPOSE,
  streamTempRespond,
  tempConversationApi,
  type TemporaryConversationRecord,
  type TemporaryConversationTranscript,
} from "../lib/temp-conversation";
import {
  graphAssistantConfirmationApi,
  type GraphAssistantPendingToolCall,
} from "../lib/graph-assistant-confirmation-api";

/** 扁平化后的助手消息（仅保留渲染所需字段）。 */
export interface AssistantMessage {
  id: string;
  role: string;
  content: string;
  createdAt: number;
}

/** 流式发送的临时态（乐观回显 + 累加正文）。 */
export interface AssistantStreamState {
  active: boolean;
  /** 乐观回显的用户输入。 */
  pendingUserText: string;
  /** 累加的助手正文。 */
  text: string;
  error: string | null;
}

/** 懒创建会话所需上下文：优先 Project 作用域，缺省回退 Session。 */
export interface AssistantContext {
  projectId?: string | null;
  sessionId?: string | null;
}

/** 会话已非 active 时的本地兜底文案（UI 另以 i18n 按 status 呈现，见阶段 2/3）。 */
const NOT_ACTIVE_MESSAGE = "This conversation is no longer active.";

function emptyStream(): AssistantStreamState {
  return { active: false, pendingUserText: "", text: "", error: null };
}

function readStatus(cause: unknown): number | undefined {
  if (cause && typeof cause === "object" && "status" in cause) {
    const status = (cause as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

/** 读取第一方薄客户端错误体 `{ error: { code, message } }` 的嵌套字段。 */
function readErrorDetail(cause: unknown): { code?: unknown; message?: unknown } | undefined {
  if (cause && typeof cause === "object" && "detail" in cause) {
    const detail = (cause as { detail?: unknown }).detail;
    if (detail && typeof detail === "object" && "error" in detail) {
      const error = (detail as { error?: unknown }).error;
      if (error && typeof error === "object") {
        return error as { code?: unknown; message?: unknown };
      }
    }
  }
  return undefined;
}

function readCode(cause: unknown): string | undefined {
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }
  const nested = readErrorDetail(cause)?.code;
  return typeof nested === "string" ? nested : undefined;
}

function readMessage(cause: unknown): string {
  const nested = readErrorDetail(cause)?.message;
  if (typeof nested === "string" && nested.length > 0) {
    return nested;
  }
  if (cause && typeof cause === "object" && "message" in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return cause instanceof Error ? cause.message : String(cause);
}

/** 错误分类：区分终态（会话不可再写入）、会话不存在与权限不足，供 store 做相应收口。 */
interface ClassifiedError {
  message: string;
  /** 终态：会话已 finalize/discard/cancel/expire 或 409 conversation_not_active。 */
  terminal: boolean;
  /** 会话不存在：应清空本地会话回到空态。 */
  notFound: boolean;
  /** 权限不足（403 project_access_denied 等）：禁用发送并提示。 */
  accessDenied: boolean;
}

function classifyError(cause: unknown): ClassifiedError {
  const status = readStatus(cause);
  const code = readCode(cause);
  return {
    message: readMessage(cause),
    terminal: code === "conversation_not_active",
    notFound: status === 404 || code === "conversation_not_found",
    accessDenied: status === 403,
  };
}

/**
 * 把 transcript（floors[].pages[].messages[]）按顺序扁平化为助手消息。
 * `isHidden = true` 跳过；`contentFormat !== "text"` 仍按纯文本取 content（不解析 markdown/json）。
 */
export function flattenTranscript(transcript: TemporaryConversationTranscript): AssistantMessage[] {
  const result: AssistantMessage[] = [];
  for (const floor of transcript.floors) {
    for (const page of floor.pages) {
      for (const message of page.messages) {
        if (message.isHidden) {
          continue;
        }
        result.push({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        });
      }
    }
  }
  return result;
}

export const useGraphAssistantStore = defineStore("graph-assistant", () => {
  const conversation = ref<TemporaryConversationRecord | null>(null);
  const messages = ref<AssistantMessage[]>([]);
  const stream = ref<AssistantStreamState>(emptyStream());
  const sending = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** 当前错误是否为「软错误」（过期 / 终态 / 权限）：UI 以引导口吻呈现，不弹红。 */
  const errorSoft = ref(false);
  /** 当前回合暂停等待的「执行前确认闸」待确认工具调用（决策 B：通常一次一条）。 */
  const pendingToolCalls = ref<GraphAssistantPendingToolCall[]>([]);
  /** 正在批准 / 拒绝某条待确认（含批准后的同步续跑）。 */
  const resolving = ref(false);
  let abortController: AbortController | null = null;

  /** 会话处于 active（可发送 / 续写）。 */
  const isActive = computed(() => conversation.value?.status === "active");

  /** 是否有待确认工具调用：有则暂停在确认闸，输入禁用，须先批准 / 拒绝。 */
  const hasPending = computed(() => pendingToolCalls.value.length > 0);

  /** 会话过期时间戳（ms）；TTL 保留策略下由后端下发，用于推导「临时 · N 后过期」提示。 */
  const expiresAt = computed<number | null>(() => conversation.value?.expiresAt ?? null);

  function resetStream(): void {
    stream.value = emptyStream();
  }

  /** 刷新会话详情（终态错误后调用，使本地 status 反映后端真值 → isActive 收敛）。 */
  async function refreshConversation(): Promise<void> {
    const id = conversation.value?.id;
    if (!id) {
      return;
    }
    try {
      conversation.value = await tempConversationApi.getDetail(id);
    } catch {
      // 刷新失败不致命：保留现有会话态。
    }
  }

  /** 懒创建会话：已有 active 会话直接复用（幂等）；优先 Project 作用域，缺省回退 Session。 */
  async function ensureConversation(ctx: AssistantContext): Promise<TemporaryConversationRecord | null> {
    if (conversation.value && conversation.value.status === "active") {
      return conversation.value;
    }
    if (!ctx.projectId && !ctx.sessionId) {
      return null;
    }
    loading.value = true;
    error.value = null;
    errorSoft.value = false;
    try {
      const record = ctx.projectId
        ? await tempConversationApi.createFromProject(ctx.projectId, GRAPH_ASSISTANT_PURPOSE)
        : await tempConversationApi.createFromSession(ctx.sessionId as string, GRAPH_ASSISTANT_PURPOSE);
      conversation.value = record;
      messages.value = [];
      return record;
    } catch (cause) {
      const classified = classifyError(cause);
      error.value = classified.message;
      errorSoft.value = classified.accessDenied;
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** 拉取 transcript 并扁平化覆盖消息列表（落库真值）。 */
  async function loadTranscript(): Promise<void> {
    const id = conversation.value?.id;
    if (!id) {
      return;
    }
    loading.value = true;
    try {
      const transcript = await tempConversationApi.getTranscript(id);
      messages.value = flattenTranscript(transcript);
    } catch (cause) {
      error.value = classifyError(cause).message;
    } finally {
     loading.value = false;
    }
  }

  /**
   * 刷新当前会话的待确认工具调用列表。
   *
   * 每次流式发送 / 批准续跑结束后调用：非空表示这一回合在「执行前确认闸」暂停，
   * 须由用户批准 / 拒绝；空表示 agent 自然停止（控制权已交回）。
   * 拉取失败按非致命处理（保留现有列表，避免误清陈旧卡片）。
   */
  async function refreshPendingToolCalls(): Promise<void> {
    const id = conversation.value?.id;
    if (!id) {
      pendingToolCalls.value = [];
      return;
    }
    try {
      const response = await graphAssistantConfirmationApi.listPending(id);
      pendingToolCalls.value = response.items;
    } catch {
      // 非致命：保留现有待确认态。
    }
  }

  /** 发送一条用户消息：懒创建 → 乐观流式 → done 后回拉 transcript 覆盖乐观态。串行化（sending 守卫）。 */
  async function sendMessage(ctx: AssistantContext, text: string): Promise<void> {
    const message = text.trim();
    if (!message || sending.value || resolving.value) {
      return;
    }
    const convo = await ensureConversation(ctx);
    if (!convo) {
      return;
    }
    if (convo.status !== "active") {
      error.value = NOT_ACTIVE_MESSAGE;
      errorSoft.value = true;
      return;
    }
    error.value = null;
    errorSoft.value = false;
    sending.value = true;
    stream.value = { active: true, pendingUserText: message, text: "", error: null };
    const controller = new AbortController();
    abortController = controller;
    try {
      await streamTempRespond({
        conversationId: convo.id,
        message,
        signal: controller.signal,
        callbacks: {
          onChunk: (delta) => {
            stream.value.text += delta;
          },
          onError: (msg) => {
            stream.value.error = msg;
          },
        },
      });
      await loadTranscript();
      await refreshPendingToolCalls();
      resetStream();
    } catch (cause) {
      if (controller.signal.aborted) {
        resetStream();
        await loadTranscript();
        await refreshPendingToolCalls();
      } else {
        const classified = classifyError(cause);
        stream.value.error = classified.message;
        error.value = classified.message;
        // 过期 / 终态 / 权限均为软错误：UI 以引导口吻呈现，不弹红。
        errorSoft.value = classified.terminal || classified.notFound || classified.accessDenied;
        if (classified.terminal) {
          await refreshConversation();
        } else if (classified.notFound) {
          conversation.value = null;
        }
      }
    } finally {
      sending.value = false;
      abortController = null;
    }
  }

  /**
   * 解决一条待确认工具调用：approve（批准并由后端自动续跑多轮）或 reject（拒绝并交回控制权）。
   *
   * 完成后回拉 transcript 并刷新待确认列表：续跑可能再次进入待确认（列表非空），
   * 也可能自然停止（列表清空）。串行化（resolving 守卫）。
   */
  async function resolvePending(
    confirmationId: string,
    decision: "approve" | "reject",
  ): Promise<void> {
    const id = conversation.value?.id;
    if (!id || resolving.value) {
      return;
    }
    resolving.value = true;
    error.value = null;
    errorSoft.value = false;
    try {
      await graphAssistantConfirmationApi.resolve(id, confirmationId, decision);
      await loadTranscript();
      await refreshPendingToolCalls();
    } catch (cause) {
      const code = readCode(cause);
      const classified = classifyError(cause);
      error.value = classified.message;
      if (code === "pending_tool_call_not_found" || code === "pending_tool_call_not_pending") {
        // 待确认已失效（被并发处理 / 过期）：以引导口吻提示，并据后端真值刷新。
        errorSoft.value = true;
        await loadTranscript();
        await refreshPendingToolCalls();
      } else {
        errorSoft.value = classified.terminal || classified.notFound || classified.accessDenied;
        if (classified.terminal) {
          await refreshConversation();
        } else if (classified.notFound) {
          conversation.value = null;
          pendingToolCalls.value = [];
        }
      }
    } finally {
      resolving.value = false;
    }
  }

  /** 批准一条待确认工具调用（随后由后端自动续跑）。 */
  function approveToolCall(confirmationId: string): Promise<void> {
    return resolvePending(confirmationId, "approve");
  }

  /** 拒绝一条待确认工具调用（向 transcript 注入说明，控制权交回用户）。 */
  function rejectToolCall(confirmationId: string): Promise<void> {
    return resolvePending(confirmationId, "reject");
  }

  /** 中断进行中的流式生成。 */
  function abort(): void {
    abortController?.abort();
  }

  /** 完成（finalize）：转终态，后续发送被禁用。 */
  async function finalize(): Promise<void> {
    const id = conversation.value?.id;
    if (!id) {
      return;
    }
    try {
      conversation.value = await tempConversationApi.finalize(id);
    } catch (cause) {
      error.value = classifyError(cause).message;
    }
  }

  /** 丢弃（discard）：转终态。 */
  async function discard(): Promise<void> {
    const id = conversation.value?.id;
    if (!id) {
      return;
    }
    try {
      conversation.value = await tempConversationApi.discard(id);
    } catch (cause) {
      error.value = classifyError(cause).message;
    }
  }

  /** 取消（cancel）：先中断进行中的流，再转终态。 */
  async function cancel(): Promise<void> {
    abort();
    const id = conversation.value?.id;
    if (!id) {
      return;
    }
    try {
      conversation.value = await tempConversationApi.cancel(id);
    } catch (cause) {
      error.value = classifyError(cause).message;
    }
  }

  function clearError(): void {
    error.value = null;
    errorSoft.value = false;
  }

  /** 仅清本地态（切项目 / 卸载图编辑器时调用）；不替用户决定 finalize / discard。 */
  function reset(): void {
    abortController?.abort();
    abortController = null;
    conversation.value = null;
    messages.value = [];
    error.value = null;
    errorSoft.value = false;
    sending.value = false;
    pendingToolCalls.value = [];
    resolving.value = false;
    resetStream();
  }

  return {
    // state
    conversation,
    messages,
    stream,
    sending,
    loading,
    error,
    errorSoft,
    pendingToolCalls,
    resolving,
    // derived
    isActive,
    expiresAt,
    hasPending,
    // actions
    ensureConversation,
    sendMessage,
    loadTranscript,
    refreshPendingToolCalls,
    approveToolCall,
    rejectToolCall,
    abort,
    finalize,
    discard,
    cancel,
    clearError,
    reset,
  };
});

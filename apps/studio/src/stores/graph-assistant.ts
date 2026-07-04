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

import { canRetryFromStep, collectIrreversibleSideEffectsBefore } from "@tavern/client-helpers";

import {
  GRAPH_ASSISTANT_PURPOSE,
  streamTempRespond,
  streamTempRetry,
  streamTempRetryStep,
  tempConversationApi,
  type TempStreamStepNarration,
  type TempStreamToolEvent,
  type TemporaryConversationIrreversibleSideEffect,
  type TemporaryConversationRecord,
  type TemporaryConversationTranscript,
} from "../lib/temp-conversation";
import {
  graphAssistantConfirmationApi,
  type GraphAssistantPendingToolCall,
} from "../lib/graph-assistant-confirmation-api";
import { buildGraphContextSnapshot } from "../modules/graph/assistant/build-context-snapshot";
import { buildMentionsBlock } from "../modules/graph/assistant/build-mentions-block";
import type { MentionRef } from "../modules/graph/assistant/mention-types";
import { collectContextBlocks } from "../modules/graph/assistant/collect-context-blocks";
import { renderDynamicPrompt } from "../modules/graph/assistant/render-dynamic-prompt";
import { applyTokenBudget } from "../modules/graph/assistant/estimate-tokens";
import {
  buildFloorViews,
  type AssistantFloorView,
} from "../modules/graph/assistant/floor-view-model";
import { useGraphAssistantPromptStore } from "./graph-assistant-prompt";
import { useGraphAssistantGenerationStore } from "./graph-assistant-generation";
import { useGraphAssistantToolTransportStore } from "./graph-assistant-tool-transport";

/** 扁平化后的助手消息（仅保留渲染所需字段）。 */
export interface AssistantMessage {
  id: string;
  role: string;
  content: string;
  createdAt: number;
}

/** 流式发送的临时态（乐观回显 + 累加正文 + 累加思维链 + 本回合工具事件）。 */
export interface AssistantStreamState {
  active: boolean;
  /** 乐观回显的用户输入。 */
  pendingUserText: string;
  /** 累加的助手正文。 */
  text: string;
  /** 累加的推理（思维链）文本；模型不返回 reasoning 时恒为空串。 */
  reasoningText: string;
  /** 思考开始时间戳（首个 reasoning delta到达）；未开始为 null。 */
  reasoningStartedAt: number | null;
  /** 思考耗时（首个正文 chunk 到达时定格）；未定格为 null。 */
  reasoningDurationMs: number | null;
  /** 本回合流式期间收集的工具调用事件（按 executionId 合并），供进行中楼层卡片显示。 */
  toolEvents: TempStreamToolEvent[];
  /** 本回合流式期间收集的中间叙述（按 stepIndex 合并），供进行中楼层卡片在工具组前显示。 */
  stepNarrations: TempStreamStepNarration[];
  error: string | null;
}

/** 懒创建会话所需上下文：优先 Project 作用域，缺省回退 Session。 */
export interface AssistantContext {
  projectId?: string | null;
  sessionId?: string | null;
}

/** 会话已非 active 时的本地兜底文案（UI 另以 i18n 按 status 呈现，见阶段 2/3）。 */
const NOT_ACTIVE_MESSAGE = "This conversation is no longer active.";

/** step 级重试起点为写类工具（不可作为起点）时的本地兜底文案。 */
const RETRY_STEP_BLOCKED_MESSAGE = "这一步带有写类副作用，不能作为重试起点。";

/** 起点工具拿不到生成步号（旧数据），无法定位重试起点时的本地兼底文案。 */
const RETRY_STEP_UNLOCATABLE_MESSAGE = "这一步缺少生成步号（可能是早期数据），暂时无法从这一步重试。";

function emptyStream(): AssistantStreamState {
  return {
    active: false,
    pendingUserText: "",
    text: "",
    reasoningText: "",
   reasoningStartedAt: null,
    reasoningDurationMs: null,
    toolEvents: [],
    stepNarrations: [],
    error: null,
  };
}

/** 进入流式发送的初始态（乐观回显文本按调用方传入；重试无用户输入时传空串）。 */
function activeStream(pendingUserText: string): AssistantStreamState {
return {
    active: true,
    pendingUserText,
    text: "",
    reasoningText: "",
    reasoningStartedAt: null,
    reasoningDurationMs: null,
    toolEvents: [],
    stepNarrations: [],
    error: null,
  };
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
  /** 最近一次拉取的落库 transcript（楼层视图模型的事实源）。 */
  const transcript = ref<TemporaryConversationTranscript | null>(null);
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
  /**
   * 最近一次 step 级重试起点之前已产生、不会回滚的写类副作用清单。
   *
   * 发起 retryStep 前先用本地 step 序列 best-effort 填充，流结束后用后端返回的权威值覆盖。
   * 供将来 UI 提示用（本期不渲染）。
   */
  const lastRetryStepSideEffects = ref<TemporaryConversationIrreversibleSideEffect[]>([]);
  /**
   * 当前正在重试（floor / step 级）的目标楼层 id；非重试（respond 新楼层）为 null。
   *
   * 重试语义是「开新消息页」：在同一楼层就地产出新输出页版本，而非新建楼层。流式期间
   * 前端据此把「进行中」卡片就地渲染在被重试楼层位置（而非追加到列表末尾）。
   */
  const retryingFloorId = ref<string | null>(null);
  let abortController: AbortController | null = null;

  /** 按楼层分组的视图模型（取代扁平 messages 供新版楼层卡片渲染）。 */
  const floors = computed<AssistantFloorView[]>(() =>
    transcript.value ? buildFloorViews(transcript.value) : [],
  );

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
      const loaded = await tempConversationApi.getTranscript(id);
      transcript.value = loaded;
      messages.value = flattenTranscript(loaded);
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

  /**
   * 求值本回合动态上下文文本（图助手 · 提示词阶段二）。
   *
   * 按项目级配置采集画布数据块并用动态模板渲染：
   * 1. 确保 prompt 配置已加载到当前项目（未加载或换了项目时拉取）；
   * 2. 从 graph-editor / context store装配画布快照；
   * 3. 按 contextConfig 采集数据块，再用 dynamicTemplate（留空走内置默认模板）渲染。
   *
   * 任一步出错都降级为「不注入」（返回空串），不阻断发送。
   */
  async function resolveDynamicContext(projectId?: string | null): Promise<string> {
    if (!projectId) {
      return "";
    }
    try {
      const promptStore = useGraphAssistantPromptStore();
      if (promptStore.projectId !== projectId) {
        await promptStore.load(projectId);
      }
      const snapshot = buildGraphContextSnapshot();
      const blocks = collectContextBlocks(snapshot, promptStore.contextConfig);
      const rendered = renderDynamicPrompt(blocks, promptStore.dynamicTemplate);
      return applyTokenBudget(rendered, promptStore.contextConfig.maxTokens).text;
    } catch {
      // 上下文求值失败不致命：降级为不注入，照常发送。
      return "";
    }
  }

  /**
   * 构造流式发送的回调集合（respond / retry / retryStep 共用）。
   *
   * 全部回调都写 `stream.value`（响应式）：正文按 delta 累加并定格思考耗时，推理按 delta
   * 累加，中间叙述与工具事件按 id 合并（同 id 覆盖、新 id 追加）。
   */
  function buildStreamCallbacks() {
    return {
      onChunk: (delta: string) => {
        // 首个正文到达即视为思考结束，定格思考耗时（仅当此前已开始思考）。
        if (stream.value.reasoningStartedAt !== null && stream.value.reasoningDurationMs === null) {
          stream.value.reasoningDurationMs = Date.now() - stream.value.reasoningStartedAt;
        }
        stream.value.text += delta;
      },
      onReasoning: (delta: string) => {
        // 首个 reasoning delta 记录思考开始时间。
        if (stream.value.reasoningStartedAt === null) {
          stream.value.reasoningStartedAt = Date.now();
        }
        stream.value.reasoningText += delta;
      },
      onStepNarration: (narration: TempStreamStepNarration) => {
        //同一 stepIndex 覆盖、新 stepIndex 追加；供进行中楼层卡片在工具组前显示。
        const list = stream.value.stepNarrations;
        const idx = list.findIndex((item) => item.stepIndex === narration.stepIndex);
        if (idx >= 0) {
          list[idx] = narration;
        } else {
          list.push(narration);
    }
      },
      onTool: (event: TempStreamToolEvent) => {
        // 同一 executionId 会先后报 start / success 等 phase，同 id 覆盖、新 id 追加。
        const list = stream.value.toolEvents;
        const idx = list.findIndex((item) => item.executionId === event.executionId);
        if (idx >= 0) {
          list[idx] = event;
        } else {
          list.push(event);
        }
      },
      onError: (msg: string) => {
        stream.value.error = msg;
      },
    };
  }

  /**
   * 流式失败的统一收口（respond / retry / retryStep 共用）。
   *
   * 中断（abort）走重置 + 回拉 transcript；其余错误按终态 / 不存在 / 权限分类，
   * 均作为软错误（UI 引导口吻、不弹红），并据分类刷新会话或清空本地会话。
   */
  async function handleStreamFailure(cause: unknown, controller: AbortController): Promise<void> {
    if (controller.signal.aborted) {
      resetStream();
      await loadTranscript();
      await refreshPendingToolCalls();
      return;
    }
    const classified = classifyError(cause);
    stream.value.error = classified.message;
    error.value = classified.message;
    errorSoft.value = classified.terminal || classified.notFound || classified.accessDenied;
    if (classified.terminal) {
      await refreshConversation();
    } else if (classified.notFound) {
      conversation.value =null;
    }
  }

  /**
   * 发送一条用户消息：懒创建 → 乐观流式 → done 后回拉 transcript 覆盖乐观态。串行化（sending 守卫）。
   *
   * `mentions` 为本回合解析出的「@提及」引用（缺省空数组，向后兼容）；它会被渲染成
   * 「【用户提及】」块，附加在项目级动态上下文之前，一并经 dynamicContext 下发。
   */
  async function sendMessage(
    ctx: AssistantContext,
    text: string,
    mentions: MentionRef[] = [],
  ): Promise<void> {
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
    stream.value = activeStream(message);
    const controller = new AbortController();
    abortController = controller;
    const mentionsBlock = buildMentionsBlock(mentions);
    const projectContext = await resolveDynamicContext(ctx.projectId);
const dynamicContext = [mentionsBlock, projectContext].filter((part) => part.length > 0).join("\n\n");
    const generationParams = useGraphAssistantGenerationStore().generationParamsForRequest;
    const toolTransportPreference = useGraphAssistantToolTransportStore().preferenceForRequest;
    try {
      await streamTempRespond({
        conversationId: convo.id,
        message,
        ...(dynamicContext ? { dynamicContext } : {}),
        ...(generationParams ? { generationParams } : {}),
        ...(toolTransportPreference ? { toolTransportPreference } : {}),
        signal: controller.signal,
        callbacks: buildStreamCallbacks(),
      });
      await loadTranscript();
      await refreshPendingToolCalls();
      resetStream();
    } catch (cause) {
      await handleStreamFailure(cause, controller);
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

  /**
   * 重试整个楼层（开新消息页）：在已提交楼层上开一个新输出页版本，重跑整轮。
   *
   * 流式链路与 sendMessage 一致（复用 buildStreamCallbacks / handleStreamFailure）；本回合重新
   * 求值当前画布的动态上下文。完成后回拉 transcript 并重置流式态。串行化（sending 守卫）。
   */
  async function retryFloor(floorId: string): Promise<void> {
    const convo = conversation.value;
    if (!convo || sending.value || resolving.value) {
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
    // 开新消息页：标记重试目标楼层，供流式卡片就地渲染（不新建楼层、不追加末尾）。
    retryingFloorId.value = floorId;
    stream.value = activeStream("");
    const controller = new AbortController();
    abortController = controller;
    const dynamicContext = await resolveDynamicContext(convo.projectId);
    const generationParams = useGraphAssistantGenerationStore().generationParamsForRequest;
    try {
      await streamTempRetry({
    conversationId: convo.id,
        floorId,
        ...(dynamicContext ? { dynamicContext } : {}),
        ...(generationParams ? { generationParams } : {}),
        signal: controller.signal,
        callbacks: buildStreamCallbacks(),
});
      await loadTranscript();
      await refreshPendingToolCalls();
      resetStream();
    } catch (cause) {
      await handleStreamFailure(cause, controller);
    } finally {
      sending.value = false;
      retryingFloorId.value = null;
      abortController = null;
    }
  }

  /**
   * 从指定步重试（开新消息页）：丢弃该步及其之后的工具往返，保留之前成功往返，从该步重生成。
   *
   *发起前先用 client-helpers `canRetryFromStep` 对本地 step 序列做 UX 预判：起点为写类工具或
   * 非工具步时不发起（后端仍会做权威硬校验）。`fromStepIndex` 为后端按 generation_step_no 解释的
   * 1-based 步号；本地预判以 FloorStep.index 匹配定位（视图序列与生成步号的映射待 UI 接入时收敛）。
   * 起点之前的不可回滚副作用先用本地 best-effort 填充，流结束后用后端权威值覆盖。串行化（sending 守卫）。
   */
  async function retryStep(floorId: string, fromStepIndex: number): Promise<void> {
    const convo = conversation.value;
    if (!convo || sending.value || resolving.value) {
     return;
    }
    if (convo.status !== "active") {
      error.value = NOT_ACTIVE_MESSAGE;
      errorSoft.value = true;
      return;
    }
    const floorView = floors.value.find((item) => item.id === floorId);
    const startStep = floorView?.steps.find((step) => step.index === fromStepIndex);
    if (!startStep || startStep.kind !== "tool" || !canRetryFromStep(startStep)) {
      // 客户端 UX 预判：起点带写副作用（或非工具步）时不发起，以引导口吻提示（后端仍会做权威硬校验）。
 error.value = RETRY_STEP_BLOCKED_MESSAGE;
      errorSoft.value = true;
      return;
    }
    // 坐标系收敛：前端统一用视图 step 序列 index（fromStepIndex），后端要 1-based generation_step_no。
    //把起点工具步的 generationStepNo 作为传给后端的真正重试起点；旧数据缺该值时无法定位，拦截。
    const generationStepNo = startStep.generationStepNo;
   if (generationStepNo == null) {
      error.value = RETRY_STEP_UNLOCATABLE_MESSAGE;
      errorSoft.value = true;
      return;
    }
    // 起点之前的不可回滚副作用（本地 best-effort；权威值以后端返回为准）。
    lastRetryStepSideEffects.value = floorView
      ? collectIrreversibleSideEffectsBefore(floorView.steps, fromStepIndex).map((item) => ({
          executionId: item.executionId,
          toolName: item.toolName,
      sideEffectLevel: item.sideEffectLevel,
          startedAt: item.startedAt,
          generationStepNo: null,
        }))
      : [];
    error.value = null;
    errorSoft.value = false;
      sending.value = true;
   // 开新消息页：标记重试目标楼层，供流式卡片就地渲染。
    retryingFloorId.value = floorId;
    stream.value = activeStream("");
    const controller = new AbortController();
    abortController = controller;
    const dynamicContext = await resolveDynamicContext(convo.projectId);
    const generationParams = useGraphAssistantGenerationStore().generationParamsForRequest;
 try {
      const result = await streamTempRetryStep({
        conversationId: convo.id,
        floorId,
        fromStepIndex: generationStepNo,
        ...(dynamicContext ? { dynamicContext } : {}),
        ...(generationParams ? { generationParams } : {}),
     signal: controller.signal,
        callbacks: buildStreamCallbacks(),
      });
      // 后端返回的权威副作用清单覆盖本地 best-effort 值。
      lastRetryStepSideEffects.value = result.irreversibleSideEffects;
      await loadTranscript();
      await refreshPendingToolCalls();
      resetStream();
    } catch (cause) {
      await handleStreamFailure(cause, controller);
       } finally {
      sending.value = false;
      retryingFloorId.value = null;
      abortController = null;
    }
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
    transcript.value = null;
    error.value = null;
    errorSoft.value = false;
    sending.value = false;
    pendingToolCalls.value = [];
    resolving.value = false;
    lastRetryStepSideEffects.value = [];
    retryingFloorId.value = null;
    resetStream();
  }

  return {
    // state
    conversation,
    messages,
    floors,
    stream,
    sending,
    loading,
    error,
    errorSoft,
    pendingToolCalls,
    resolving,
    lastRetryStepSideEffects,
    retryingFloorId,
    // derived
    isActive,
    expiresAt,
    hasPending,
    // actions
    ensureConversation,
    sendMessage,
    retryFloor,
    retryStep,
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

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
  type CreateSessionInput,
  type FloorIrreversibleSideEffect,
  type PageRecord,
  type SessionActiveRunSummary,
  type SessionRecord,
  type SessionTimeline,
  type TimelineFloor,
} from "../lib/chat";

/** 最近一次分步重跑结果摘要（只读展示，可清除）。 */
export interface RetryStepSummary {
  floorId: string;
  /** 实际被丢弃的起始步号（1-based）。 */
  discardedFromStepIndex: number;
  /** 起点之前已产生、不会回滚的写类副作用（脱敏摘要）。 */
  irreversibleSideEffects: FloorIrreversibleSideEffect[];
}

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

/**
 * 时间线分页窗口大小。
 *
 * 后端 `timeline` 按 floor_no 升序（最旧在前）、offset 从最旧计，且 SDK 丢弃了分页 meta（total/has_more）。
 * 因此本期采用“首窗 + 向更新方向加载更多”的前向 offset 分页，并用“满窗启发式”推断是否还有更多。
 */
export const TIMELINE_PAGE_SIZE = 50;

/** 归一分支标识：main / 空串视为主分支（内部以 null 表示，主分支查询不带 branch_id）。 */
function normalizeBranchId(branchId: string | null): string | null {
  return branchId && branchId !== "main" ? branchId : null;
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
  // 分页游标：下一窗的服务端 offset（= 已从服务端拉取的楼层数）。
  const timelineOffset = ref(0);
  // 满窗启发式：上一窗返回楼层数 === TIMELINE_PAGE_SIZE 则可能还有更多。
  const timelineHasMore = ref(false);
  const loadingMoreTimeline = ref(false);
  const sending = ref(false);
  const regenerating = ref(false);
  const creating = ref(false);
  // SC1-6 楼层重跑：原地 / 分步重跑进行中（并入 busy）与最近一次分步重跑结果摘要。
  const retrying = ref(false);
  const lastRetryStep = ref<RetryStepSummary | null>(null);
  // SC1-7 编辑并重生：编辑进行中（并入 busy）与当前查看/操作分支（null=main，单一事实源）。
  const editing = ref(false);
  const currentBranchId = ref<string | null>(null);
  // 编辑助手回复内容：人工修订保存进行中（写操作，并入 busy 以防重入）。
  const savingRevision = ref(false);
  const error = ref<string | null>(null);
  const stream = ref<ChatStreamState>(emptyStream());
  let abortController: AbortController | null = null;
  // SC1-5 运行态感知：服务端 active-run 概要（null=空闲）与探测中标记。
  const activeRun = ref<SessionActiveRunSummary | null>(null);
  const loadingActiveRun = ref(false);
  // 防竞态：每次 refreshActiveRun 递增，仅最新一次结果落地；reset 亦递增以作废在途请求。
  let activeRunToken = 0;
  // SC1-8 翻页 / swipes：按 floorId 缓存的全量页（懒加载）、拉取去重集、切换中的页 id。
  const floorPages = ref<Record<string, PageRecord[]>>({});
  const loadingPagesFloorIds = ref<Set<string>>(new Set());
  const activatingPageId = ref<string | null>(null);

  const floors = computed<TimelineFloor[]>(() => timeline.value?.floors ?? []);
  // 服务端此刻是否有进行中的 run。
  const serverBusy = computed(() => activeRun.value?.busy ?? false);
  // 对外统一忙碌语义：本地发送/重生/重跑 或 服务端在跑。
  const busy = computed(
    () =>
      sending.value ||
      regenerating.value ||
      retrying.value ||
      editing.value ||
      savingRevision.value ||
      serverBusy.value,
  );
  // “别处在跑”：服务端 busy 但本地既未发送也未重生也未重跑也未编辑（避免自己在跑时误报提示）。
  const remoteBusy = computed(
    () =>
      serverBusy.value &&
      !sending.value &&
      !regenerating.value &&
      !retrying.value &&
      !editing.value &&
      !savingRevision.value,
  );
  // 是否处于编辑派生的 fork 分支（非 main / 非空）。
  const onFork = computed(() => currentBranchId.value != null && currentBranchId.value !== "main");
  // 服务端 run 的公开阶段 / 类型（阶段口径同 ChatStreamPhase，可复用 chat.phase.*）。
  const activeRunPhase = computed(() => activeRun.value?.publicPhase ?? null);
  const activeRunType = computed(() => activeRun.value?.activeRunType ?? null);
  const latestFloor = computed<TimelineFloor | null>(() =>
    floors.value.length > 0 ? floors.value[floors.value.length - 1]! : null,
  );

  function resetStream(): void {
    stream.value = emptyStream();
  }

  /** 构造 timeline 查询参数：仅在处于 fork 分支时带 branchId（main 省略，保持 SC1-4 行为与断言）。 */
  function timelineQuery(offset: number): { offset: number; limit: number; branchId?: string } {
    const query: { offset: number; limit: number; branchId?: string } = {
      offset,
      limit: TIMELINE_PAGE_SIZE,
    };
    if (currentBranchId.value) {
      query.branchId = currentBranchId.value;
    }
    return query;
  }

  /**
   * 加载时间线首窗（offset=0，limit=TIMELINE_PAGE_SIZE），全量替换并重置分页游标。
   * SC1-7：分支感知——`branchId === undefined` 维持当前分支；显式 string|null 切换（main/空归一为 null）。
   */
  async function loadTimeline(sessionId: string, branchId?: string | null): Promise<void> {
    if (branchId !== undefined) {
      currentBranchId.value = normalizeBranchId(branchId);
    }
    loadingTimeline.value = true;
    error.value = null;
    try {
      const result = await chatApi.getTimeline(sessionId, timelineQuery(0));
      timeline.value = result;
      const count = result.floors.length;
      timelineOffset.value = count;
      timelineHasMore.value = count === TIMELINE_PAGE_SIZE;
    } catch (cause) {
      timeline.value = null;
      timelineOffset.value = 0;
      timelineHasMore.value = false;
      error.value = describeError(cause);
    } finally {
      loadingTimeline.value = false;
    }
  }

  /**
   * 加载下一窗楼层（向“更新”方向，因后端 oldest-first + offset 从最旧计）。
   * 新 floors 按 id 去重后追加，保持 floorNo 升序；不自动滚动到底（由 MessageList 控制）。
   */
  async function loadMoreTimeline(sessionId: string): Promise<void> {
    if (!timelineHasMore.value || loadingMoreTimeline.value || loadingTimeline.value) {
      return;
    }
    loadingMoreTimeline.value = true;
    error.value = null;
    try {
      const result = await chatApi.getTimeline(sessionId, timelineQuery(timelineOffset.value));
      const incoming = result.floors;
      const current = timeline.value;
      if (current) {
        const seen = new Set(current.floors.map((f) => f.id));
        const merged = current.floors.slice();
        for (const f of incoming) {
          if (!seen.has(f.id)) {
            seen.add(f.id);
            merged.push(f);
          }
        }
        merged.sort((a, b) => a.floorNo - b.floorNo);
        timeline.value = { ...current, floors: merged };
      } else {
        timeline.value = result;
      }
      // offset 按服务端实际返回数推进（而非去重后数），避免重复拉取同一窗。
      timelineOffset.value += incoming.length;
      timelineHasMore.value = incoming.length === TIMELINE_PAGE_SIZE;
    } catch (cause) {
      error.value = describeError(cause);
    } finally {
      loadingMoreTimeline.value = false;
    }
  }

  /**
   * 轻量对账（SC1-5）：读取服务端 active-run（busy / publicPhase / activeRunType / latestFloorId）。
   * best-effort：失败降级为 activeRun=null（回退本地 busy），不写主 error、不阻断发送。
   * requestToken 防竞态：快速切会话时旧响应被丢弃；reset 递增 token 亦作废在途请求。
   */
  async function refreshActiveRun(sessionId: string): Promise<void> {
    const token = ++activeRunToken;
    loadingActiveRun.value = true;
    try {
      const record = await chatApi.getActiveRun(sessionId);
      if (token !== activeRunToken) {
        return;
      }
      activeRun.value = record.activeRun;
    } catch {
      if (token !== activeRunToken) {
        return;
      }
      activeRun.value = null;
    } finally {
      if (token === activeRunToken) {
        loadingActiveRun.value = false;
      }
    }
  }

  /**
   * 建会话（仅创建，调用方负责刷新 context 会话列表并选中）。
   *
   * SC2-4：`input` 可选携带资产绑定（角色卡 / 预设 / 世界书 / 正则档 + promptMode / syncPolicy）；
   * 省略 / 留空时等价于原「建空会话」。
   */
  async function createSession(
    projectId: string,
    input?: CreateSessionInput,
  ): Promise<SessionRecord | null> {
    creating.value = true;
    error.value = null;
    try {
      return await chatApi.createSession(projectId, input);
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
        // SC1-7：fork 视图下发送留在同一分支（respondStream 支持 branchId）；main 时不传。
        branchId: currentBranchId.value ?? undefined,
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
      // 正常结束后对账：确保 UI 不残留 busy（服务端此刻应已回到空闲）。
      await refreshActiveRun(sessionId);
    } catch (cause) {
      if (controller.signal.aborted) {
        // 用户主动中断：重拉时间线并核对服务端是否确已停止。
        resetStream();
        await loadTimeline(sessionId);
        await refreshActiveRun(sessionId);
      } else {
        // 真实错误：保留流式草稿与错误，同时对账（服务端可能仍在 / 已落库）。
        stream.value.error = describeError(cause);
        await refreshActiveRun(sessionId);
        await loadTimeline(sessionId);
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
      await refreshActiveRun(sessionId);
    } catch (cause) {
      error.value = describeError(cause);
    } finally {
      regenerating.value = false;
    }
  }

  /**
   * 原地重跑指定 committed 楼层（floors.retry）。
   * busy（含 serverBusy）时早退；成功后 loadTimeline + refreshActiveRun 一次轻量对账。
   */
  async function retryFloor(sessionId: string, floorId: string): Promise<void> {
    if (busy.value) {
      return;
    }
    retrying.value = true;
    error.value = null;
    try {
      await chatApi.retryFloor(floorId);
      await loadTimeline(sessionId);
      await refreshActiveRun(sessionId);
    } catch (cause) {
      error.value = describeError(cause);
    } finally {
      retrying.value = false;
    }
  }

  /**
   * 从指定步（1-based）重跑某 committed 楼层（floors.retryStep）。
   * 起始步之前的写类副作用不回滚，以 lastRetryStep.irreversibleSideEffects 只读展示。
   * busy 时早退；非法步号（非整数 / <1）前端拦截并写 error、不发请求。
   */
  async function retryFloorStep(
    sessionId: string,
    floorId: string,
    fromStepIndex: number,
  ): Promise<void> {
    if (busy.value) {
      return;
    }
    if (!Number.isInteger(fromStepIndex) || fromStepIndex < 1) {
      error.value = `Invalid step index: ${String(fromStepIndex)}`;
      return;
    }
    retrying.value = true;
    error.value = null;
    lastRetryStep.value = null;
    try {
      const result = await chatApi.retryFloorStep(floorId, fromStepIndex);
      lastRetryStep.value = {
        floorId,
        discardedFromStepIndex: result.discardedFromStepIndex,
        irreversibleSideEffects: result.irreversibleSideEffects,
      };
      await loadTimeline(sessionId);
      await refreshActiveRun(sessionId);
    } catch (cause) {
      error.value = describeError(cause);
    } finally {
      retrying.value = false;
    }
  }

  function clearLastRetryStep(): void {
    lastRetryStep.value = null;
  }

  /**
   * 懒加载某楼层的全量页（含各槽位所有版本），按 floorId 缓存以构建 swipe。
   * best-effort：已缓存（非 force）直接返回；并发去重（loadingPagesFloorIds）；失败保留旧缓存。
   */
  async function loadFloorPages(floorId: string, force = false): Promise<void> {
    if (!force && floorPages.value[floorId]) {
      return;
    }
    if (loadingPagesFloorIds.value.has(floorId)) {
      return;
    }
    const next = new Set(loadingPagesFloorIds.value);
    next.add(floorId);
    loadingPagesFloorIds.value = next;
    try {
      const pages = await chatApi.listFloorPages(floorId);
      floorPages.value = { ...floorPages.value, [floorId]: pages };
    } catch (cause) {
      // best-effort：保留旧缓存，仅呈现错误（不阻断阅读）。
      error.value = describeError(cause);
    } finally {
      const done = new Set(loadingPagesFloorIds.value);
      done.delete(floorId);
      loadingPagesFloorIds.value = done;
    }
  }

  /**
   * 激活（swipe 到）指定页：同槽位其他版本自动置为非活跃（pages.activate）。
   * busy（含 serverBusy）/ stream.active / 已有切换在途时早退；
   * 成功后 loadTimeline（新活跃正文）+ loadFloorPages(force)（刷新 isActive）+ refreshActiveRun 对账。
   */
  async function activatePage(sessionId: string, floorId: string, pageId: string): Promise<void> {
    if (busy.value || stream.value.active) {
      return;
    }
    if (activatingPageId.value) {
      return;
    }
    activatingPageId.value = pageId;
    error.value = null;
    try {
      await chatApi.activatePage(pageId);
      await loadTimeline(sessionId);
      await loadFloorPages(floorId, true);
      await refreshActiveRun(sessionId);
    } catch (cause) {
      error.value = describeError(cause);
    } finally {
      activatingPageId.value = null;
    }
  }

  /**
   * 编辑某条用户消息并重生（messages.editAndRegenerate）。
   * 服务端新开分支且不改 main；成功后视图跟随返回的 branchId（加载该 fork 时间线）并对账。
   * busy（含 serverBusy）时早退；空内容早退。
   */
  async function editAndRegenerate(
    sessionId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    if (busy.value) {
      return;
    }
    const text = content.trim();
    if (!text) {
      return;
    }
    editing.value = true;
    error.value = null;
    try {
      const result = await chatApi.editAndRegenerate(messageId, text);
      // 视图切到 fork：优先用返回的新 branchId，缺省则维持当前分支。
      await loadTimeline(sessionId, result.branchId ?? currentBranchId.value);
      await refreshActiveRun(sessionId);
    } catch (cause) {
      error.value = describeError(cause);
    } finally {
      editing.value = false;
    }
  }

  /**
   * 编辑助手（LLM）回复内容：以人工修订（manual-revision）就地改写已提交内容，不触发重生 / 不分叉。
   * 先取修订时间线得 latestRevisionNo 作乐观锁基线，再提交；成功后 loadTimeline 对账（token 会重算）。
   * busy（含 serverBusy）时早退；空内容早退；乐观锁冲突（409）走 catch 呈现错误，由用户刷新后重试。
   */
  async function editAssistantMessage(
    sessionId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    if (busy.value) {
      return;
    }
    const text = content.trim();
    if (!text) {
      return;
    }
    savingRevision.value = true;
    error.value = null;
    try {
      const revisions = await chatApi.getMessageRevisions(messageId);
      await chatApi.createMessageRevision(messageId, text, revisions.latestRevisionNo);
      await loadTimeline(sessionId);
    } catch (cause) {
      error.value = describeError(cause);
    } finally {
      savingRevision.value = false;
    }
  }

  function clearError(): void {
    error.value = null;
  }

  function reset(): void {
    timeline.value = null;
    timelineOffset.value = 0;
    timelineHasMore.value = false;
    loadingMoreTimeline.value = false;
    activeRun.value = null;
    loadingActiveRun.value = false;
    activeRunToken++; // 作废在途 refreshActiveRun
    retrying.value = false;
    lastRetryStep.value = null;
    editing.value = false;
    currentBranchId.value = null;
    savingRevision.value = false;
    floorPages.value = {};
    loadingPagesFloorIds.value = new Set();
    activatingPageId.value = null;
    error.value = null;
    resetStream();
  }

  return {
    // state
    timeline,
    loadingTimeline,
    timelineOffset,
    timelineHasMore,
    loadingMoreTimeline,
    sending,
    regenerating,
    creating,
    retrying,
    lastRetryStep,
    editing,
    currentBranchId,
    savingRevision,
    error,
    stream,
    activeRun,
    loadingActiveRun,
    floorPages,
    loadingPagesFloorIds,
    activatingPageId,
    // derived
    floors,
    serverBusy,
    busy,
    remoteBusy,
    onFork,
    activeRunPhase,
    activeRunType,
    latestFloor,
    // actions
    loadTimeline,
    loadMoreTimeline,
    refreshActiveRun,
    createSession,
    sendMessage,
    abort,
    regenerateLatest,
    retryFloor,
    retryFloorStep,
    clearLastRetryStep,
    editAndRegenerate,
    editAssistantMessage,
    loadFloorPages,
    activatePage,
    resetStream,
    clearError,
    reset,
  };
});

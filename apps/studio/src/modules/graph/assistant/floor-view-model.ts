/**
 * 图助手对话「楼层视图模型」装配（楼层样式即时改造 · 阶段一）。
 *
 * 把落库 transcript（floors[].pages[].messages[]）转成按楼层分组的视图模型：
 * 一个 floor 一张卡片，过滤隐藏消息与 system 引导词，计算派生指标。
 *
 * 纯函数、无 i18n / DOM 依赖，便于单测。注意：模型名、耗时、速度均为「当前值 / 估算」，
 * 真实历史值需后端在 transcript 暴露（见 reasoning 全链路设计）。本模块只用现有字段。
 */
import { buildFloorStepsFromTranscriptFloor, type FloorStep } from "@tavern/client-helpers";

import type {
    TemporaryConversationTranscript,
  TemporaryConversationTranscriptFloor,
} from "../../../lib/temp-conversation";

/**楼层派生指标（底部指标条数据源）。 */
export interface AssistantFloorMetrics {
  /** 完成时间（floor.updatedAt）。 */
  finishedAt: number;
  /** 耗时（updatedAt − createdAt），近似，含排队与提交时间。 */
  durationMs: number;
  /** 速度（tokenOut / 秒），近似；耗时为 0 时为 null。 */
  tokensPerSecond: number | null;
  /** 总 token（tokenIn + tokenOut），估算。 */
  totalTokens: number;
  tokenIn: number;
  tokenOut: number;
  /** 缓存 token：当前 transcript 不返回，恒为 null（占位）。 */
  cachedTokens: number | null;
}

/** 楼层内单条可见消息（仅渲染所需字段）。 */
export interface AssistantFloorMessageView {
  id: string;
  role: string;
  content: string;
}

/** 单个楼层的视图模型。 */
export interface AssistantFloorView {
  id: string;
  floorNo: number;
  state: string;
  messages: AssistantFloorMessageView[];
  metrics: AssistantFloorMetrics;
  /**
   * 思维链文本：从 transcript 的 `reasoningText` 填充（reasoning 全链路）。
   * 模型未返回 reasoning、楼层未提交或 inspect 脱敏时为空，此处置 undefined（抽屉不渲染）。
   */
  reasoning?: string;
  /**
   * 思考耗时（毫秒）：仅流式期间可测（首个 reasoning delta 到首个正文 chunk）。
   * 历史楼层 transcript 不返回该值，置 undefined（抽屉头部不显示时长）。
   */
  reasoningDurationMs?: number;
  /**
   * 楼层内有序 step 序列（视图聚合，不落库）：工具步 + 回答步。
   *
   * 由 `@tavern/client-helpers` 的 `buildFloorStepsFromTranscriptFloor` 从该 floor 的
   * `toolExecutions` 与 active page 助手消息归并而成。工具步是「一次 LLM 往返」里调用工具的步，
   * 回答步是最终回复。历史楼层据此即可展示工具步（不再依赖流式期间的临时事件）。
   */
  steps: FloorStep[];
}

/** 收集某楼层所有 page 的可见消息，跳过隐藏消息与 system 引导词，按 page / seq升序。 */
function collectMessages(floor: TemporaryConversationTranscriptFloor): AssistantFloorMessageView[] {
  const messages: AssistantFloorMessageView[] = [];
  const pages = [...floor.pages].sort((a, b) => a.pageNo - b.pageNo);
  for (const page of pages) {
    const sorted = [...page.messages].sort((a, b) => a.seq - b.seq);
    for (const message of sorted) {
      // 隐藏消息不展示；system 仅为引导词（见设计 4.2），按 role 过滤即可。
      if (message.isHidden || message.role === "system") {
        continue;
      }
      messages.push({ id: message.id, role: message.role, content: message.content });
    }
  }
  return messages;
}

/** 计算楼层派生指标。 */
function buildMetrics(floor: TemporaryConversationTranscriptFloor): AssistantFloorMetrics {
  const durationMs = Math.max(0, floor.updatedAt - floor.createdAt);
  const tokenIn = floor.tokenIn;
  const tokenOut = floor.tokenOut;
  return {
    finishedAt: floor.updatedAt,
    durationMs,
    tokensPerSecond: durationMs > 0 ? tokenOut / (durationMs / 1000) : null,
    totalTokens: tokenIn + tokenOut,
    tokenIn,
    tokenOut,
    cachedTokens: null,
  };
}

/**
 * 把 transcript 转成楼层视图模型数组。
 *
 * - 按 floorNo 升序遍历；
 * - 过滤隐藏消息与 system 引导词；
 * - 过滤后无可见消息的楼层不产出（避免只含引导词的空卡片）。
 */
export function buildFloorViews(transcript: TemporaryConversationTranscript): AssistantFloorView[] {
  const floors = [...transcript.floors].sort((a, b) => a.floorNo - b.floorNo);
  const views: AssistantFloorView[] = [];
  for (const floor of floors) {
    const messages = collectMessages(floor);
    if (messages.length === 0) {
      continue;
    }
    views.push({
      id: floor.id,
      floorNo: floor.floorNo,
      state: floor.state,
      messages,
      metrics: buildMetrics(floor),
     // 工具步 + 回答步归并（视图聚合，不落库）；归并逻辑收敛在 client-helpers。
      steps: buildFloorStepsFromTranscriptFloor(floor),
      // reasoningText 为空 / null 时不填，思维链抽屉整块不渲染。
      ...(floor.reasoningText ? { reasoning: floor.reasoningText } : {}),
    });
  }
  return views;
}

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { AssistantStreamState } from "../../../stores/graph-assistant";
import AssistantFloorCard from "./AssistantFloorCard.vue";
import ReplyInspectorModal from "./ReplyInspectorModal.vue";
import type { AssistantFloorMessageView, AssistantFloorView } from "./floor-view-model";

const props = defineProps<{
  floors: AssistantFloorView[];
  stream: AssistantStreamState;
  loading?: boolean;
  /** 当前选中的模型名（当前值，传给楼层卡片头部）。 */
  modelName: string;
  /** 全局忙碌（任意生成态进行中）：禁用所有楼层的重试 / 删除 / 重试此步。 */
  busy?: boolean;
  /**
   * 当前正在重试的目标楼层 id（floor / step 级重试）；非重试（respond 新楼层）为 null。
   *
   * 「开新消息页」语义：重试在同一楼层就地产出新输出页版本。命中时，进行中卡片就地
   * 覆盖该楼层（而非在列表末尾追加一张新卡片）。
   */
  retryingFloorId?: string | null;
}>();

const emit = defineEmits<{
  (event: "retry", floorId: string): void;
  (event: "delete", floorId: string): void;
  /** step 级重试：透传楼层 id 与视图 step 序列下标。 */
  (event: "retry-step", payload: { floorId: string; stepIndex: number }): void;
}>();

const { t } = useI18n();

const scroller = ref<HTMLElement | null>(null);

/** 当前打开的回复查看器目标（楼层 + 消息）；null 表示未打开。 */
const inspecting = ref<{ floor: AssistantFloorView; message: AssistantFloorMessageView } | null>(null);

function openInspector(floor: AssistantFloorView, message: AssistantFloorMessageView): void {
  inspecting.value = { floor, message };
}

function closeInspector(): void {
  inspecting.value = null;
}

/**
 * 就地重试的进行中楼层视图：命中「正在重试的已存在楼层」时，用原楼层的用户消息
 * 叠加本回合流式助手正文，构造一张 generating 态视图，覆盖在该楼层原位置。
*
 * 未命中（respond 新楼层，或重试目标不在当前列表）时为 null，退回末尾追加逻辑。
 */
const retryingFloorView = computed<AssistantFloorView | null>(() => {
  if (!props.stream.active || !props.retryingFloorId) {
    return null;
  }
  const base = props.floors.find((item) => item.id === props.retryingFloorId);
  if (!base) {
    return null;
  }
  const messages: AssistantFloorMessageView[] = [
    ...base.messages.filter((message) => message.role === "user"),
    { id: "__stream_assistant__", role: "assistant", content: props.stream.text },
  ];
  return {
    ...base,
    state: "generating",
    messages,
    // 流式期间工具步走 stream.toolEvents（卡片内单独处理），此处 steps 置空。
    steps: [],
    // 流式期间累加的思维链覆盖历史值（模型未返回时清空，抽屉整块不渲染）。
    ...(props.stream.reasoningText
      ? { reasoning: props.stream.reasoningText }
      : { reasoning:undefined }),
    ...(props.stream.reasoningDurationMs !== null
      ? { reasoningDurationMs: props.stream.reasoningDurationMs }
      : { reasoningDurationMs: undefined }),
  };
});

/** 进行中楼层：把流式临时态（乐观用户输入 + 累加助手正文）包成一张「进行中」卡片。 */
const streamingFloor = computed<AssistantFloorView | null>(() => {
  if (!props.stream.active) {
    return null;
  }
  const messages: AssistantFloorMessageView[] = [
    { id: "__stream_user__", role: "user", content: props.stream.pendingUserText },
    { id: "__stream_assistant__", role: "assistant", content: props.stream.text },
  ];
  return {
   id: "__streaming__",
    floorNo: 0,
    state: "generating",
    messages,
    // 流式期间工具步走 stream.toolEvents（卡片内单独处理），此处 steps 置空。
    steps: [],
    metrics: {
      finishedAt: 0,
      durationMs: 0,
       tokensPerSecond: null,
      totalTokens: 0,
      tokenIn: 0,
      tokenOut: 0,
      cachedTokens: null,
    },
    // 流式期间累加的思维链（模型未返回时为空，抽屉整块不渲染）。
    ...(props.stream.reasoningText ? { reasoning: props.stream.reasoningText } : {}),
    // 思考耗时：首个正文到达后定格，传给抽屉头部显示。
    ...(props.stream.reasoningDurationMs !== null ? { reasoningDurationMs: props.stream.reasoningDurationMs } : {}),
  };
});

function scrollToBottom(): void {
  const el = scroller.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
}

watch(
  () => [props.floors.length, props.stream.text, props.stream.active] as const,
  () => {
    void nextTick(scrollToBottom);
  },
);
</script>

<template>
  <div ref="scroller" class="min-h-0 flex-1 overflow-auto">
    <!-- 加载骨架 -->
    <div v-if="loading && floors.length === 0" class="space-y-3 p-3">
      <div class="h-12 w-full animate-pulse rounded bg-float" />
      <div class="h-20 w-full animate-pulse rounded bg-float" />
    </div>

    <!-- 空态引导 -->
    <div
      v-else-if="floors.length === 0 && !stream.active"
      class="flex h-full items-center justify-center p-6"
    >
      <p class="max-w-xs text-center text-xs leading-relaxed text-text-muted">
        {{ t("graphAssistant.emptyHint") }}
      </p>
    </div>

    <div v-else class="px-3 py-1">
      <template v-for="floor in floors" :key="floor.id">
        <!-- 就地重试：命中重试目标楼层时，用进行中卡片覆盖原位置（不新建楼层、不追加末尾） -->
        <AssistantFloorCard
          v-if="retryingFloorView && floor.id === retryingFloorView.id"
          :floor="retryingFloorView"
          :model-name="modelName"
          :streaming="true"
          :stream-error="stream.error"
          :tool-events="stream.toolEvents"
          :step-narrations="stream.stepNarrations"
        />
        <AssistantFloorCard
          v-else
          :floor="floor"
          :model-name="modelName"
          :busy="busy"
          @retry="emit('retry', $event)"
          @delete="emit('delete', $event)"
          @retry-step="emit('retry-step', $event)"
          @inspect="openInspector"
     />
      </template>

      <!-- 进行中楼层卡片：仅 respond 新楼层时追加末尾。
           重试（floor / step）永远针对已存在楼层就地覆盖，绝不新建楼层，因此只要处于重试态
           （retryingFloorId 非空）就一律不追加这张「新楼层」卡片——即便就地视图因边界情况未命中，
           也不能在末尾冒出一张会被误读为「新开一层楼」的进行中卡片。 -->
      <AssistantFloorCard
        v-if="streamingFloor && !retryingFloorId"
        :floor="streamingFloor"
        :model-name="modelName"
        :streaming="true"
        :stream-error="stream.error"
        :tool-events="stream.toolEvents"
        :step-narrations="stream.stepNarrations"
      />
    </div>

    <!-- 回复查看器：把一条回复拆成正文 / 思考 / 内容片段 / 工具调用 / 元信息（经 Teleport 覆盖到 body） -->
    <ReplyInspectorModal
      v-if="inspecting"
      :floor="inspecting.floor"
      :message="inspecting.message"
      @close="closeInspector"
 />
  </div>
</template>

<script setup lang="ts">
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Brain,
  ChevronRight,
  Clock,
  Database,
  Eye,
  Gauge,
  Loader,
  RotateCcw,
  Sigma,
  Timer,
  Trash2,
} from "lucide-vue-next";
import { computed, ref, type Component } from "vue";
import { useI18n } from "vue-i18n";

import { groupFloorStepsIntoSegments } from "@tavern/client-helpers";

import type { TempStreamStepNarration, TempStreamToolEvent } from "../../../lib/temp-conversation";
import AssistantMarkdown from "./AssistantMarkdown.vue";
import ToolStepGroup from "./ToolStepGroup.vue";
import type { AssistantFloorMessageView, AssistantFloorView } from "./floor-view-model";
import { buildToolCallView, buildToolCallViewFromStep, type ToolCallView } from "./tool-call-view";

const props = defineProps<{
  floor: AssistantFloorView;
  /** 当前选中的模型名（当前值，非该楼层历史真值）。 */
  modelName: string;
  /** 进行中楼层：禁用操作、底部显示「生成中」、不展示落库指标。 */
  streaming?: boolean;
  /** 全局忙碌（本对话任意生成态进行中）：禁用所有楼层的重试 / 删除 / 重试此步。 */
  busy?: boolean;
  /** 流式错误文案（仅进行中楼层）。 */
  streamError?: string | null;
  /** 本回合工具事件（仅进行中楼层有；历史楼层无明细）。 */
  toolEvents?: TempStreamToolEvent[];
  /** 本回合中间叙述（仅进行中楼层有；按 stepIndex 升序在工具组前显示）。 */
  stepNarrations?: TempStreamStepNarration[];
}>();

const emit = defineEmits<{
  (event: "retry", floorId: string): void;
  (event: "delete", floorId: string): void;
  (event: "inspect", floor: AssistantFloorView, message: AssistantFloorMessageView): void;
  /** step 级重试（骨架）：本期只出事件出口，不接执行逻辑。 */
  (event: "retry-step", payload: { floorId: string; stepIndex: number }): void;
}>();

const { t, te } = useI18n();

/** 思考过程抽屉：历史楼层默认收起；流式期间默认展开，便于看实时思考。 */
const reasoningOpen = ref(Boolean(props.streaming));

/** draft / generating / 进行中楼层，或本对话任意生成态进行中时，禁用重试与删除。 */
const actionsDisabled = computed(
  () =>
    Boolean(props.streaming) ||
    Boolean(props.busy) ||
    props.floor.state === "draft" ||
    props.floor.state === "generating",
);

const modelLabel = computed(() => props.modelName || t("graphAssistant.floor.modelUnknown"));

/**
 * 思考耗时展示串：
 * - 耗时已定格（流式首个正文到达后）显示「X.Xs」；
 * - 流式思考进行中（耗时未定格但已有思考文本）显示「思考中」；
 * - 历史楼层无耗时数据时为空（抽屉头不显示时长）。
 */
const reasoningDurationLabel = computed(() => {
  const ms = props.floor.reasoningDurationMs;
  if(ms != null && ms > 0) {
  return `${(ms / 1000).toFixed(1)}s`;
  }
  if (props.streaming && props.floor.reasoning) {
    return t("graphAssistant.floor.reasoningOngoing");
  }
return "";
});

function roleLabel(role: string): string {
  const key = `graphAssistant.role.${role}`;
  return te(key) ? t(key) : role;
}

function isUser(role: string): boolean {
  return role === "user";
}

/** 楼层内用户消息（单独渲染在助手块之前）。 */
const userMessages = computed(() => props.floor.messages.filter((m) => isUser(m.role)));

/**
 * 该楼层的代表性助手消息：取最后一条 assistant / narrator 消息。
 * 用于 inspect 目标与 meta 的 role 展示（历史与流式两路一致）。
 */
const assistantMessage = computed<AssistantFloorMessageView | null>(() => {
  const list = props.floor.messages.filter((m) => !isUser(m.role));
  return list.length > 0 ? (list[list.length - 1] ?? null) : null;
});

/** meta 行的 role：优先取代表性助手消息的 role，缺省回退 assistant。 */
const assistantRole = computed(() => assistantMessage.value?.role ?? "assistant");

/** 工具分组内单步：视图 + 全局 step 序号。 */
interface CardToolItem {
  view: ToolCallView;
  stepIndex: number;
}

/**
 * 渲染段（扁平形态，便于模板按 kind 分支取字段）：
 * - 工具段携带 toolItems；
 * - 回答段携带 messageId / role / content。
 */
interface CardSegment {
  kind: "tools" | "answer" | "narration";
  key: string;
  toolItems?: CardToolItem[];
  messageId?: string;
  role?: string;
  content?: string;
}

/**
 * 楼层内有序渲染段：工具位置完全由 step 序列决定，支持「仅工具 / 工具在前 /
 * 工具在中间 / 工具在后」四种情况。
 * - 流式期间：用本回合 SSE 工具事件（props.toolEvents）+ 流式正文，工具在前。
 * - 历史楼层：按 floor.steps（已按真实时序归并）分组，逐段顺序渲染。
 */
const segments = computed<CardSegment[]>(() => {
  if (props.streaming) {
    const segs: CardSegment[] = [];
    // 中间叙述段：按 stepIndex 升序排在工具组之前，与提交后回拉 transcript 的视觉顺序一致。
    const narrations = [...(props.stepNarrations ?? [])].sort((a, b) => a.stepIndex - b.stepIndex);
    for (const narration of narrations) {
      segs.push({
        kind: "narration",
        key: `__stream_narration_${narration.stepIndex}__`,
        content: narration.text,
      });
    }
    const events = props.toolEvents ?? [];
    if (events.length > 0) {
      segs.push({
        kind: "tools",
        key: "__stream_tools__",
        toolItems: events.map((event, index) => ({ view: buildToolCallView(event), stepIndex: index })),
      });
    }
    const answer = assistantMessage.value;
    segs.push({
      kind: "answer",
      key: "__stream_answer__",
      messageId: answer?.id ?? "__stream_assistant__",
      role: answer?.role ?? "assistant",
      content: answer?.content ?? "",
    });
    return segs;
  }

  return groupFloorStepsIntoSegments(props.floor.steps).map((segment): CardSegment => {
    if (segment.kind === "tools") {
      return {
        kind: "tools",
        key: segment.key,
        toolItems: segment.steps.map((step) => ({
          view: buildToolCallViewFromStep(step),
          stepIndex: step.index,
        })),
      };
    }
    if (segment.kind === "narration") {
      // 中间叙述段：与回答段同款 markdown 渲染，仅是叙述是中间动作预告。
      return {
        kind: "narration",
        key: segment.key,
        content: segment.step.content,
      };
    }
    return {
      kind: "answer",
      key: segment.key,
      messageId: segment.step.id,
      role: segment.step.role,
      content: segment.step.content,
    };
  });
});

/** 是否渲染助手块：流式中始终渲染；历史楼层有段才渲染。 */
const hasAssistantBlock = computed(() => Boolean(props.streaming) || segments.value.length > 0);

/** 进行中楼层、且尚无回答正文、且无错误时，显示「生成中」脉冲。 */
const isThinking = computed(() => {
  if (!props.streaming || props.streamError) {
    return false;
  }
  const answer = segments.value.find((segment) => segment.kind === "answer");
  return !answer || !answer.content;
});

function formatTime(ts: number): string {
  if (!ts) {
    return "—";
  }
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "—";
  }
}

function formatDuration(ms: number): string {
  if (ms <= 0) {
    return "—";
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 底部指标条：标签 + 预先算好的展示值（避免在模板里做格式化）。 */
const metricItems = computed(() => {
  const m = props.floor.metrics;
  const items: { key: string; label: string; value: string; icon: Component }[] = [
    { key: "finishedAt", label: t("graphAssistant.floor.metrics.finishedAt"), value: formatTime(m.finishedAt), icon: Clock },
    { key: "duration", label: t("graphAssistant.floor.metrics.duration"), value: formatDuration(m.durationMs), icon: Timer },
    {
      key: "speed",
      label: t("graphAssistant.floor.metrics.speed"),
      value: m.tokensPerSecond === null ? "—" : `${m.tokensPerSecond.toFixed(1)} tok/s`,
  icon:Gauge,
    },
    { key: "totalTokens", label: t("graphAssistant.floor.metrics.totalTokens"), value: String(m.totalTokens), icon: Sigma },
    { key: "tokenIn", label: t("graphAssistant.floor.metrics.tokenIn"), value: String(m.tokenIn), icon: ArrowDownToLine },
    {
      key: "cached",
      label: t("graphAssistant.floor.metrics.cached"),
      value: m.cachedTokens === null ? "—" : String(m.cachedTokens),
      icon: Database,
    },
    { key: "tokenOut", label: t("graphAssistant.floor.metrics.tokenOut"), value: String(m.tokenOut), icon: ArrowUpFromLine },
  ];
  return items;
});
</script>

<template>
  <article class="floor">
    <!-- 用户消息：渲染在助手块之前 -->
    <div v-for="message in userMessages" :key="message.id" class="floor__row msg msg--user">
      <div class="msg__meta">
        <span class="msg__role">{{ roleLabel(message.role) }}</span>
      </div>
      <div v-if="message.content" class="msg__content">{{ message.content }}</div>
    </div>

    <!-- 助手块：整楼层一块，内部按 step 段顺序渲染（工具段 / 回答段按真实时序交叉） -->
    <div v-if="hasAssistantBlock" class="floor__row msg msg--assistant">
      <div class="msg__head">
        <span class="msg__model" :title="modelLabel">{{ modelLabel }}</span>
        <div class="msg__actions">
          <button
            type="button"
            class="msg__act"
            :disabled="Boolean(streaming) || !assistantMessage?.content"
            :title="t('graphAssistant.inspector.open')"
            @click="assistantMessage && emit('inspect', floor, assistantMessage)"
          >
            <Eye :size="13" :stroke-width="1.5" />
          </button>
          <button
            type="button"
            class="msg__act"
            :disabled="actionsDisabled"
            :title="t('graphAssistant.floor.retry')"
            @click="emit('retry', floor.id)"
          >
            <RotateCcw :size="13" :stroke-width="1.5" />
          </button>
          <button
            type="button"
            class="msg__act"
            :disabled="actionsDisabled"
            :title="t('graphAssistant.floor.delete')"
            @click="emit('delete', floor.id)"
          >
            <Trash2 :size="13" :stroke-width="1.5" />
          </button>
        </div>
      </div>

      <div class="msg__meta">
        <span class="msg__role">{{ roleLabel(assistantRole) }}</span>
        <span v-if="isThinking" class="msg__phase">
          <span class="msg__pulse" aria-hidden="true" />
          {{ t("graphAssistant.thinking") }}
        </span>
      </div>

      <!-- 思考过程抽屉：在所有 step 段之前，默认折叠（流式时默认展开），斜体灰字、带思考耗时 -->
      <div v-if="floor.reasoning" class="floor__reasoningDrawer">
        <button type="button" class="floor__reasoningToggle" @click="reasoningOpen = !reasoningOpen">
          <ChevronRight class="floor__chevron" :class="reasoningOpen ? 'floor__chevron--open' : ''" :size="12" :stroke-width="1.5" />
          <Brain :size="12" :stroke-width="1.5" />
          <span class="floor__reasoningTitle">{{ t("graphAssistant.floor.reasoning") }}</span>
          <span v-if="reasoningDurationLabel" class="floor__reasoningDuration">{{ reasoningDurationLabel }}</span>
        </button>
        <div v-if="reasoningOpen" class="floor__reasoning">{{ floor.reasoning }}</div>
      </div>

      <!-- step 段：严格按 floor.steps 时序逐段渲染，工具位置由数据决定，不写死前后 -->
      <template v-for="segment in segments" :key="segment.key">
        <ToolStepGroup
          v-if="segment.kind === 'tools'"
          :items="segment.toolItems ?? []"
          :default-open="Boolean(streaming)"
          :floor-id="floor.id"
          :disabled="actionsDisabled"
          @retry-step="emit('retry-step', $event)"
        />
        <AssistantMarkdown
          v-else-if="segment.content"
          class="msg__md"
          :class="segment.kind === 'narration' ? 'msg__md--narration' : ''"
            :content="segment.content"
          :streaming="streaming"
        />
      </template>

      <div v-if="streaming && streamError" class="msg__error">{{ streamError }}</div>
    </div>

    <!-- 底部指标条：整轮一条；进行中楼层显示「生成中」，落库楼层显示估算指标 -->
    <footer class="floor__metrics">
      <span v-if="streaming" class="floor__metricGenerating">
        <Loader :size="11" :stroke-width="1.5" class="floor__spin" />
        {{ t("graphAssistant.floor.generating") }}
      </span>
      <template v-else>
        <span v-for="item in metricItems" :key="item.key" class="floor__metric" :title="item.label">
          <component :is="item.icon" :size="11" :stroke-width="1.5" class="floor__metricIcon" />
          <span class="floor__metricValue">{{ item.value }}</span>
        </span>
      </template>
    </footer>
  </article>
</template>

<style scoped>
.floor {
  /* 楼层本身不画边框；分隔线下沉到消息级（.floor__row）。 */
}

/* 每条消息一条上边框作分隔；相邻消息之间（user↔assistant、user↔user 等）与跨楼层均生效 */
.floor__row {
  border-top: 1px solid var(--color-line-subtle);
  padding: 10px 0;
}

/* 整个对话第一条消息上方不画线 */
.floor:first-child .floor__row:first-child {
  border-top: none;
}

.msg__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.msg__model {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.02em;
  color: var(--color-text-secondary);
}

.msg__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}

/* 默认隐藏；悬浮该助手消息块（或其内获得焦点，保证键盘可达）时才显示 */
.msg--assistant:hover .msg__actions,
.msg--assistant:focus-within .msg__actions {
  opacity: 1;
  pointer-events: auto;
}

.msg__act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--color-text-muted);
  transition: background-color 150ms, color 150ms;
}

.msg__act:hover:not(:disabled) {
  background: var(--color-float);
  color: var(--color-text-primary);
}

.msg__act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.msg__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.msg__role {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.msg--user .msg__role {
  color: var(--color-signal-accent);
}

.msg--assistant .msg__role {
  color: var(--color-text-secondary);
}

.msg__content {
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.msg--user .msg__content {
  color: var(--color-text-secondary);
}

.msg__phase {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
}

.msg__pulse {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: var(--color-signal-accent);
  animation: msg-pulse 1.4s ease-in-out infinite;
}

@keyframes msg-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

.msg__error {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-signal-error);
}

.floor__reasoningDrawer {
  margin-bottom: 6px;
}

.floor__reasoningToggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--color-text-muted);
  transition: color 150ms;
}

.floor__reasoningToggle:hover {
  color: var(--color-text-secondary);
}

.floor__chevron {
  transition: transform 150ms;
}

.floor__chevron--open {
  transform: rotate(90deg);
}

.floor__reasoningTitle {
  font-weight: 500;
}

.floor__reasoningDuration {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
}

/* 中间叙述段：比最终回答略淡，左边条标记，与最终结论区分 */
.msg__md--narration {
  border-left: 2px solid var(--color-line-subtle);
  padding-left: 10px;
  color: var(--color-text-secondary);
}

/* 思考正文：斜体灰字 + 左边条，与正式回复区分 */
.floor__reasoning {
  margin-top: 4px;
  padding: 6px 0 6px 10px;
  border-left: 2px solid var(--color-line-subtle);
  font-size: 12px;
  line-height: 1.6;
  font-style: italic;
  color: var(--color-text-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* 指标条是该轮的附属信息，不画分隔线，仅用 muted 小字呈现 */
.floor__metrics {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin: 6px 0 2px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
}

.floor__metric {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.floor__metricIcon {
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.floor__metricValue {
  color: var(--color-text-secondary);
}

.floor__metricGenerating {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.floor__spin {
  animation: floor-spin 1s linear infinite;
}

@keyframes floor-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

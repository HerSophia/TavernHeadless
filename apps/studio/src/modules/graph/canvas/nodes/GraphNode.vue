<script setup lang="ts">
import { isNodeGraphAnnotationNodeType, type NodeGraphPortDefinition } from "@tavern/core/node-graph";
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { AlertTriangle, CheckCircle2, Database, Eye, EyeOff, Hand, KeyRound, Loader2, XCircle } from "lucide-vue-next";
import { computed, inject, ref, type Component } from "vue";
import { useI18n } from "vue-i18n";

import { GRAPH_EDITABLE_KEY } from "../editable-context";
import NodeInlineConfigControls from "../../inline-config/NodeInlineConfigControls.vue";
import {
  NODE_HEADER_HEIGHT,
  NODE_PORT_ROW_HEIGHT,
  type GraphFlowNodeData,
  type GraphNodeConfigSummaryItem,
  type GraphTavernNodeData,
} from "../map-document";
import { phaseStyle, portStyle, runStatusStyle, sideEffectStyle } from "../port-styles";

const props = defineProps<NodeProps<GraphFlowNodeData>>();
const emit = defineEmits<{
  (event: "update-node-config", payload: { nodeId: string; path: string; value: unknown; emptyValue?: "delete" | "keep" | "null" }): void;
  (event: "open-node-inspector", nodeId: string): void;
}>();

const { t, te } = useI18n();

/** 编辑态：端口可连线（读取画布注入的 editable ref，缺省只读）。 */
const editable = inject(GRAPH_EDITABLE_KEY, ref(false));

const d = computed(() => props.data as GraphTavernNodeData);
const phase = computed(() => phaseStyle(d.value.phase));
const sideEffect = computed(() => sideEffectStyle(d.value.sideEffects));
const status = computed(() => (d.value.runStatus ? runStatusStyle(d.value.runStatus) : null));
const hasPermissions = computed(() => d.value.permissionsRequired.length > 0);
const isAnnotationNode = computed(() => isNodeGraphAnnotationNodeType(d.value.node.type));
const annotationText = computed(() => {
  const config = d.value.node.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return "";
  }
  const value = (config as { content?: unknown }).content;
  return typeof value === "string" ? value.trim() : "";
});
/** 配置摘要 pill 的标签本地化（优先 labelKey，缺省回退英文技术短码）。 */
function summaryLabel(item: GraphNodeConfigSummaryItem): string {
  return item.labelKey && te(item.labelKey) ? t(item.labelKey) : item.label;
}

/**
 * 配置摘要 pill 的取值本地化：仅描述性取值（missing / input / N chars等）走 valueKey；
 * 枚举值、表达式等技术标识无 valueKey，保留原样等宽展示。
 */
function summaryValue(item: GraphNodeConfigSummaryItem): string | undefined {
  if (item.valueKey && te(item.valueKey)) {
    return t(item.valueKey, item.valueParams ?? {});
  }
  return item.value;
}

const configSummaryTitle = computed(() =>
  d.value.configSummary
    .map((item) => {
      const value = summaryValue(item);
      return `${summaryLabel(item)}${value ? `: ${value}` : ""}`;
   })
    .join("\n"),
);

/**
 * 节点标题：优先显示节点自定义 name（导入预设的 slot 名、用户重命名）。
 * 模板渲染等通用节点会被复用为多种用途，显示具体 name 才能在画布上区分；
 * 无 name 时按界面语言回退 i18n 类型标题，再回退 registry 标题 / 英文短码。
 */
const displayTitle = computed(() => {
  const name = d.value.node.name?.trim();
  if (name) {
    return name;
  }
  const key = `graphNode.type.${d.value.node.type.replaceAll(".", "_")}`;
  return te(key) ? t(key) : d.value.title;
});
const phaseLabel = computed(() => {
  const key = `graphNode.phase.${d.value.phase}`;
  return te(key) ? t(key) : phase.value.label;
});
const statusLabel = computed(() => {
  const runStatus = d.value.runStatus;
  if (!runStatus || !status.value) {
    return "";
  }
  const key = `graphNode.status.${runStatus}`;
  return te(key) ? t(key) : status.value.label;
});
const previewStatusLabel = computed(() => {
  const key = `graphNode.previewStatus.${d.value.previewSummary.status}`;
  return te(key) ? t(key) : d.value.previewSummary.status;
});
const previewPolicyLabel = computed(() => {
  const key = `graphNode.previewPolicy.${d.value.previewPolicy}`;
  return te(key) ? t(key) : d.value.previewPolicy;
});

const portsHeight = computed(
  () => `${Math.max(d.value.inputPorts.length, d.value.outputPorts.length) * NODE_PORT_ROW_HEIGHT}px`,
);

const previewIcon = computed<Component>(() => {
  switch (d.value.previewSummary.status) {
    case "running":
      return Loader2;
    case "succeeded":
      return CheckCircle2;
    case "failed":
      return XCircle;
    case "disabled":
      return EyeOff;
    default:
      break;
  }
  switch (d.value.previewPolicy) {
    case "cached_only":
      return Database;
    case "manual":
      return Hand;
    case "disabled":
      return EyeOff;
    default:
      return Eye;
  }
});

function portHandleStyle(
  port: NodeGraphPortDefinition,
  index: number,
  side: "left" | "right",
): Record<string, string> {
  const shape = portStyle(port.type);
  const top = NODE_HEADER_HEIGHT + index * NODE_PORT_ROW_HEIGHT + NODE_PORT_ROW_HEIGHT / 2;
  const translate = side === "left" ? "translate(-50%, -50%)" : "translate(50%, -50%)";
  return {
    width: "9px",
    height: "9px",
    background: shape.color,
    border: "1.5px solid var(--color-app)",
    boxSizing: "border-box",
    top: `${top}px`,
    transform: shape.shape === "diamond" ? `${translate} rotate(45deg)` : translate,
    borderRadius: shape.shape === "circle" ? "9999px" : shape.shape === "square" ? "2px" : "1px",
    zIndex: "2",
  };
}

/**
 * 端口名本地化：端口 name 是连线契约的 key（core 定义，不可改），
 * 这里只在画布展示时优先用 i18n 映射，缺省回退原始技术标识。
 */
function portLabel(name: string): string {
  const key = `graphNode.port.${name}`;
  return te(key) ? t(key) : name;
}

function portTitle(port: NodeGraphPortDefinition): string {
  const label = portLabel(port.name);
  const prefix = label === port.name ? port.name : `${label} (${port.name})`;
  return `${prefix} · ${port.type}${port.multiple ? " []" : ""}${port.required ? " *" : ""}`;
}

function onInlineConfigUpdate(payload: { path: string; value: unknown; emptyValue?: "delete" | "keep" | "null" }): void {
  emit("update-node-config", { nodeId: d.value.node.id, ...payload });
}

function onOpenInspector(): void {
  emit("open-node-inspector", d.value.node.id);
}
</script>

<template>
  <div
    class="gn"
    :class="{ 'gn--disabled': !d.enabled, 'gn--selected': props.selected, 'gn--annotation': isAnnotationNode }"
  >
    <span class="gn__accent" :style="{ background: phase.accent }" aria-hidden="true" />
    <span v-if="status" class="gn__status-bar" :style="{ background: status.color }" aria-hidden="true" />

    <header
  class="gn__header"
      :style="{ background: `color-mix(in srgb, var(--color-panel) 90%, ${phase.accent} 10%)` }"
    >
      <div class="gn__title-row">
        <AlertTriangle
          v-if="d.unknownType"
          class="gn__warn"
          :size="13"
          :stroke-width="1.5"
        />
        <span class="gn__title" :title="displayTitle">{{ displayTitle }}</span>
        <span
          v-if="sideEffect.emphasis > 0"
          class="gn__badge"
          :class="`gn__badge--${sideEffect.emphasis}`"
          :style="{ color: sideEffect.color, borderColor: sideEffect.color }"
        >{{ sideEffect.label }}</span>
      </div>
      <div class="gn__type" :title="`${d.node.type}@${d.node.typeVersion}`">{{ d.node.type }}</div>
      <div v-if="d.configSummary.length > 0 || d.configMissing || hasPermissions" class="gn__summary" :title="configSummaryTitle">
        <span
          v-if="d.configMissing"
          class="gn__summary-pill gn__summary-pill--warning"
        >{{ t("graphNode.summary.missing") }}</span>
        <span
          v-if="hasPermissions"
          class="gn__summary-pill"
          :title="d.permissionsRequired.join('\n')"
        >
          <KeyRound :size="10" :stroke-width="1.5" />
          {{ d.permissionsRequired.length }}
        </span>
        <span
          v-for="item in d.configSummary"
          :key="`${item.label}:${item.value ?? ''}`"
          class="gn__summary-pill"
          :class="{ 'gn__summary-pill--warning': item.tone === 'warning' }"
        >{{ summaryLabel(item) }}<template v-if="summaryValue(item)">: {{ summaryValue(item) }}</template></span>
      </div>
    </header>

    <div v-if="isAnnotationNode && annotationText" class="gn__annotation-body">
      {{ annotationText }}
    </div>

    <div class="gn__ports" :style="{ height: portsHeight }">
      <div class="gn__col gn__col--in">
        <div
          v-for="(port, index) in d.inputPorts"
          :key="`in-${port.name}`"
          class="gn__port-row"
        >
          <Handle
            :id="port.name"
            type="target"
            :position="Position.Left"
            :connectable="editable"
            :style="portHandleStyle(port, index, 'left')"
            :title="portTitle(port)"
          />
          <span class="gn__port-label">{{ portLabel(port.name) }}</span>
        </div>
      </div>

      <div class="gn__col gn__col--out">
        <div
          v-for="(port, index) in d.outputPorts"
          :key="`out-${port.name}`"
          class="gn__port-row gn__port-row--out"
        >
          <span class="gn__port-label gn__port-label--out">{{ portLabel(port.name) }}</span>
          <Handle
            :id="port.name"
            type="source"
            :position="Position.Right"
            :connectable="editable"
            :style="portHandleStyle(port, index, 'right')"
            :title="portTitle(port)"
          />
        </div>
      </div>
    </div>

    <NodeInlineConfigControls
      :controls="d.inlineConfigControls"
      @update="onInlineConfigUpdate"
      @open-inspector="onOpenInspector"
    />

    <footer class="gn__footer">
      <span class="gn__phase" :style="{ color: phase.accent }">{{ phaseLabel }}</span>
      <span class="gn__meta">
        <span v-if="status" class="gn__status-label" :style="{ color: status.color }">{{ statusLabel }}</span>
        <span
          class="gn__preview"
          :class="`gn__preview--${d.previewSummary.status}`"
          :title="`${previewPolicyLabel} · ${previewStatusLabel}`"
        >
          <component :is="previewIcon" class="gn__preview-icon" :size="12" :stroke-width="1.5" />
          <span>{{ previewStatusLabel }}</span>
        </span>
      </span>
    </footer>
  </div>
</template>

<style scoped>
.gn {
  position: relative;
  width: 100%;
  border: 1px solid var(--color-line-active);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-text-primary);
  overflow: hidden;
  font-family: var(--font-sans);
  transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1);
}

.gn:hover {
  border-color: color-mix(in srgb, var(--color-line-active) 60%, var(--color-signal-accent) 40%);
}

.gn--selected,
.gn--selected:hover {
  border-color: var(--color-signal-accent);
  box-shadow: 0 0 0 1px var(--color-signal-accent);
}

.gn--disabled {
  opacity: 0.6;
  border-style: dashed;
}

.gn--annotation {
  background: color-mix(in srgb, var(--color-panel) 88%, var(--color-signal-info) 12%);
  border-style: dashed;
}

.gn__accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  opacity: 0.9;
}

.gn__status-bar {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
}

.gn__header {
  height: 66px;
  padding: 7px 10px 0 13px;
  box-sizing: border-box;
  overflow: hidden;
  border-bottom: 1px solid var(--color-line-subtle);
}

.gn__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.gn__warn {
  color: var(--color-signal-warn);
  flex: none;
}

.gn__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gn__badge {
  flex: none;
  font-family: var(--font-mono);
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
  padding: 2px 4px;
  border: 1px solid;
  border-radius: 3px;
}

.gn__badge--2 {
  font-weight: 600;
}

.gn__type {
  margin-top: 3px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gn__summary {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 5px;
  min-width: 0;
  overflow: hidden;
}

.gn__summary-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  max-width: 100%;
  padding: 1px 4px;
  border: 1px solid var(--color-line-subtle);
  border-radius: 3px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gn__summary-pill--warning {
  border-color: rgb(207 146 119 / 0.65);
  color: var(--color-signal-warn);
}

.gn__annotation-body {
  max-height: 58px;
  margin: 0 10px 6px 13px;
  padding: 6px 7px;
  overflow: hidden;
  white-space: pre-wrap;
  border: 1px solid var(--color-line-subtle);
  border-radius: 4px;
  background: var(--color-app);
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 1.35;
}

.gn__ports {
  display: flex;
  position: static;
}

.gn__col {
  flex: 1 1 0;
  min-width: 0;
}

.gn__port-row {
  height: 22px;
  display: flex;
  align-items: center;
}

.gn__port-row--out {
  justify-content: flex-end;
}

.gn__port-label {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-left: 12px;
}

.gn__port-label--out {
  padding-left: 0;
  padding-right: 12px;
  text-align: right;
}

.gn__footer {
  height: 22px;
  display: flex;
  align-items: center;
   justify-content: space-between;
  padding: 0 10px 0 13px;
  border-top: 1px solid var(--color-line-subtle);
  background: color-mix(in srgb, var(--color-panel) 94%, var(--color-app) 6%);
}

.gn__phase {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
}

.gn__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
}

.gn__status-label {
  font-family: var(--font-mono);
  font-size: 9px;
}

.gn__preview {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-text-muted);
}

.gn__preview--running {
  color: var(--color-signal-accent);
}

.gn__preview--succeeded {
  color: var(--color-signal-success);
}

.gn__preview--failed {
  color: var(--color-signal-error);
}

.gn__preview-icon {
  display: block;
}

.gn__preview--running .gn__preview-icon {
  animation: gn-spin 900ms linear infinite;
}

@keyframes gn-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>

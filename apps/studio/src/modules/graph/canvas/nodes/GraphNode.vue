<script setup lang="ts">
import type { NodeGraphPortDefinition } from "@tavern/core/node-graph";
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { AlertTriangle, Database, Eye, EyeOff, Hand } from "lucide-vue-next";
import { computed, inject, ref, type Component } from "vue";
import { useI18n } from "vue-i18n";

import { GRAPH_EDITABLE_KEY } from "../editable-context";
import {
  NODE_HEADER_HEIGHT,
  NODE_PORT_ROW_HEIGHT,
  type GraphFlowNodeData,
  type GraphTavernNodeData,
} from "../map-document";
import { phaseStyle, portStyle, runStatusStyle, sideEffectStyle } from "../port-styles";

const props = defineProps<NodeProps<GraphFlowNodeData>>();

const { t, te } = useI18n();

/** 编辑态：端口可连线（读取画布注入的 editable ref，缺省只读）。 */
const editable = inject(GRAPH_EDITABLE_KEY, ref(false));

const d = computed(() => props.data as GraphTavernNodeData);
const phase = computed(() => phaseStyle(d.value.phase));
const sideEffect = computed(() => sideEffectStyle(d.value.sideEffects));
const status = computed(() => (d.value.runStatus ? runStatusStyle(d.value.runStatus) : null));

/** 节点文案随界面语言：命中 i18n 键则用之，否则回退 registry 标题 / 英文短码。 */
const displayTitle = computed(() => {
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

const portsHeight = computed(
  () => `${Math.max(d.value.inputPorts.length, d.value.outputPorts.length) * NODE_PORT_ROW_HEIGHT}px`,
);

const previewIcon = computed<Component>(() => {
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

function portTitle(port: NodeGraphPortDefinition): string {
  return `${port.name} · ${port.type}${port.multiple ? " []" : ""}${port.required ? " *" : ""}`;
}
</script>

<template>
  <div
    class="gn"
    :class="{ 'gn--disabled': !d.enabled, 'gn--selected': props.selected }"
  >
    <span class="gn__accent" :style="{ background: phase.accent }" aria-hidden="true" />
    <span v-if="status" class="gn__status-bar" :style="{ background: status.color }" aria-hidden="true" />

    <header class="gn__header">
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
    </header>

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
          <span class="gn__port-label">{{ port.name }}</span>
        </div>
      </div>

      <div class="gn__col gn__col--out">
        <div
          v-for="(port, index) in d.outputPorts"
          :key="`out-${port.name}`"
          class="gn__port-row gn__port-row--out"
        >
          <span class="gn__port-label gn__port-label--out">{{ port.name }}</span>
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

    <footer class="gn__footer">
      <span class="gn__phase" :style="{ color: phase.accent }">{{ phaseLabel }}</span>
      <span class="gn__meta">
        <span v-if="status" class="gn__status-label" :style="{ color: status.color }">{{ statusLabel }}</span>
        <component :is="previewIcon" class="gn__preview-icon" :size="12" :stroke-width="1.5" />
      </span>
    </footer>
  </div>
</template>

<style scoped>
.gn {
  position: relative;
  width: 100%;
  border: 1px solid var(--color-line-subtle);
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-text-primary);
  overflow: hidden;
  font-family: var(--font-sans);
  transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1);
}

.gn--selected {
  border-color: var(--color-line-active);
  box-shadow: 0 0 0 1px var(--color-signal-accent);
}

.gn--disabled {
  opacity: 0.6;
  border-style: dashed;
}

.gn__accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
}

.gn__status-bar {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
}

.gn__header {
  height: 48px;
  padding: 7px 10px 0 13px;
  box-sizing: border-box;
  overflow: hidden;
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

.gn__preview-icon {
  display: block;
}
</style>

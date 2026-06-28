<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { Boxes, CornerDownRight, Maximize2 } from "lucide-vue-next";
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";

import {
  GRAPH_EDITABLE_KEY,
  GRAPH_GROUP_COLLAPSE_KEY,
  GRAPH_GROUP_ENTER_KEY,
  GRAPH_GROUP_TOGGLE_KEY,
} from "../editable-context";
import {
  NODE_HEADER_HEIGHT,
  NODE_PORT_ROW_HEIGHT,
  type CollapsedGroupHandle,
  type GraphCollapsedGroupNodeData,
  type GraphFlowNodeData,
} from "../map-document";
import { portStyle } from "../port-styles";

const props = defineProps<NodeProps<GraphFlowNodeData>>();

const { t } = useI18n();
const editable = inject(GRAPH_EDITABLE_KEY, ref(false));
const toggle = inject(GRAPH_GROUP_TOGGLE_KEY, undefined);
const collapse = inject(GRAPH_GROUP_COLLAPSE_KEY, undefined);
const enter = inject(GRAPH_GROUP_ENTER_KEY, undefined);

const d = computed(() => props.data as GraphCollapsedGroupNodeData);
const switchOn = computed(() => d.value.switchState === "on");
const switchMixed = computed(() => d.value.switchState === "mixed");
const showControls = computed(() => Boolean(editable?.value));

const portsHeight = computed(
  () => `${Math.max(d.value.inputs.length, d.value.outputs.length, 1) * NODE_PORT_ROW_HEIGHT}px`,
);

function handleStyle(handle: CollapsedGroupHandle, index: number, side: "left" | "right"): Record<string, string> {
  const shape = portStyle(handle.type);
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
    // 关闭的输出通道：端口点虚化（低对比），与虚化连线一致。
    opacity: handle.disabled ? "0.4" : "1",
  };
}

function onToggle(): void {
  toggle?.(d.value.group.id, d.value.switchState !== "on");
}

function onExpand(): void {
  collapse?.(d.value.group.id, false);
}

function onEnter(): void {
  enter?.(d.value.group.id);
}
</script>

<template>
  <div class="cg" :class="{ 'cg--off': d.switchState === 'off', 'cg--selected': props.selected }">
    <span class="cg__accent" aria-hidden="true" />

    <header class="cg__header">
      <div class="cg__title-row">
        <Boxes class="cg__icon" :size="14" :stroke-width="1.5" />
        <span class="cg__title" :title="d.group.name">{{ d.group.name }}</span>
        <button
          v-if="showControls && toggle"
          type="button"
          role="switch"
          class="cg__switch"
          :class="{ 'cg__switch--on': switchOn, 'cg__switch--mixed': switchMixed }"
          :aria-checked="switchOn"
          :title="t('graph.group.switch')"
          @click.stop="onToggle"
          @mousedown.stop
          @dblclick.stop
        >
          <span class="cg__knob" />
        </button>
      </div>
      <div class="cg__sub">
        <span class="cg__kind">{{ t("graph.group.nodeGroup") }} · {{ d.memberCount }}</span>
        <span class="cg__actions">
          <button
            type="button"
            class="cg__action"
            :title="t('graph.group.enter')"
            @click.stop="onEnter"
            @mousedown.stop
            @dblclick.stop
          >
            <CornerDownRight :size="12" :stroke-width="1.5" />
          </button>
          <button
            v-if="showControls && collapse"
            type="button"
            class="cg__action"
            :title="t('graph.group.expand')"
            @click.stop="onExpand"
            @mousedown.stop
            @dblclick.stop
          >
            <Maximize2 :size="12" :stroke-width="1.5" />
          </button>
        </span>
      </div>
    </header>

    <div class="cg__ports" :style="{ height: portsHeight }">
      <div class="cg__col cg__col--in">
        <div v-for="(handle, index) in d.inputs" :key="handle.id" class="cg__port-row">
          <Handle
            :id="handle.id"
            type="target"
            :position="Position.Left"
            :connectable="false"
            :style="handleStyle(handle, index, 'left')"
            :title="handle.label"
          />
          <span class="cg__port-label">{{ handle.label }}</span>
        </div>
      </div>

      <div class="cg__col cg__col--out">
        <div v-for="(handle, index) in d.outputs" :key="handle.id" class="cg__port-row cg__port-row--out">
          <span
            class="cg__port-label cg__port-label--out"
            :class="{ 'cg__port-label--disabled': handle.disabled }"
            :title="handle.disabled ? t('graph.group.channelOff') : handle.label"
          >{{ handle.label }}</span>
          <Handle
            :id="handle.id"
            type="source"
            :position="Position.Right"
            :connectable="false"
            :style="handleStyle(handle, index, 'right')"
            :title="handle.label"
          />
        </div>
      </div>
    </div>

    <footer class="cg__footer">{{ t("graph.group.enterHint") }}</footer>
  </div>
</template>

<style scoped>
.cg {
  position: relative;
  width: 100%;
  border: 1px solid var(--color-line-active);
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-text-primary);
  overflow: hidden;
  font-family: var(--font-sans);
  transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1);
}

.cg--selected {
  border-color: var(--color-line-active);
  box-shadow: 0 0 0 1px var(--color-signal-accent);
}

.cg--off {
  opacity: 0.62;
  border-style: dashed;
}

.cg__accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--color-signal-accent, #6366f1);
}

.cg__header {
  padding: 7px 10px 6px 13px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--color-line-subtle);
}

.cg__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cg__icon {
  flex: none;
  color: var(--color-text-secondary);
}

.cg__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cg__sub {
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.cg__kind {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.cg__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.cg__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: 1px solid var(--color-line-subtle);
  border-radius: 4px;
  color: var(--color-text-secondary);
  background: var(--color-float);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.cg__action:hover {
  border-color: var(--color-line-active);
  color: var(--color-text-primary);
}

/* 开关：复用组容器开关的三态外观。 */
.cg__switch {
  flex: none;
  position: relative;
  width: 20px;
  height: 12px;
  padding: 0;
  border: 1px solid var(--color-line-active);
  border-radius: 999px;
  background: var(--color-float);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.cg__switch--on {
  background: var(--color-signal-accent, #6366f1);
  border-color: var(--color-signal-accent, #6366f1);
}

.cg__switch--mixed {
  background: var(--color-signal-warn, #d9a441);
  border-color: var(--color-signal-warn, #d9a441);
}

.cg__knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-secondary);
  transition: transform 0.15s, background 0.15s;
}

.cg__switch--on .cg__knob {
  transform: translateX(8px);
  background: #fff;
}

.cg__switch--mixed .cg__knob {
  transform: translateX(4px);
  background: #fff;
}

.cg__ports {
  display: flex;
  position: static;
}

.cg__col {
  flex: 1 1 0;
  min-width: 0;
}

.cg__port-row {
  height: 22px;
  display: flex;
  align-items: center;
}

.cg__port-row--out {
  justify-content: flex-end;
}

.cg__port-label {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-left: 12px;
}

.cg__port-label--out {
  padding-left: 0;
  padding-right: 12px;
  text-align: right;
}

/* 关闭的输出通道：标签灰显 + 删除线，与虚化连线一致表达「该通道已关」。 */
.cg__port-label--disabled {
  color: var(--color-text-muted);
  text-decoration: line-through;
  opacity: 0.7;
}

.cg__footer {
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  border-top: 1px solid var(--color-line-subtle);
  font-size: 9px;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}
</style>

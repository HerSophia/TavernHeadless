<script setup lang="ts">
import type { NodeProps } from "@vue-flow/core";
import { Minimize2 } from "lucide-vue-next";
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";

import { GRAPH_EDITABLE_KEY, GRAPH_GROUP_COLLAPSE_KEY, GRAPH_GROUP_TOGGLE_KEY } from "../editable-context";
import type { GraphFlowNodeData, GraphGroupNodeData } from "../map-document";

const props = defineProps<NodeProps<GraphFlowNodeData>>();

const { t, te }= useI18n();
const editable = inject(GRAPH_EDITABLE_KEY, undefined);
const toggle = inject(GRAPH_GROUP_TOGGLE_KEY, undefined);
const collapse = inject(GRAPH_GROUP_COLLAPSE_KEY, undefined);

const g = computed(() => props.data as GraphGroupNodeData);
/** 组类型本地化（visual / subgraph），缺省回退原始标识。 */
const kindLabel = computed(() => {
  const key = `graph.group.kindLabel.${g.value.group.kind}`;
  return te(key) ? t(key) : g.value.group.kind;
});
const switchOn = computed(() => g.value.switchState === "on");
const switchMixed = computed(() => g.value.switchState === "mixed");
const showSwitch = computed(() => Boolean(editable?.value && toggle));
const showCollapse = computed(() => Boolean(editable?.value && collapse && g.value.group.kind === "subgraph"));

function onToggle(): void {
  // 非「全开」→ 开启全部；「全开」→ 关闭全部。
  toggle?.(g.value.group.id, g.value.switchState !== "on");
}

function onCollapse(): void {
  collapse?.(g.value.group.id, true);
}
</script>

<template>
  <div class="gg" :class="{ 'gg--off': g.switchState === 'off' }">
    <span class="gg__label">
      <button
        v-if="showSwitch"
        type="button"
        role="switch"
        class="gg__switch"
        :class="{ 'gg__switch--on': switchOn, 'gg__switch--mixed': switchMixed }"
        :aria-checked="switchOn"
        :title="t('graph.group.switch')"
        @click.stop="onToggle"
        @mousedown.stop
        @dblclick.stop
      >
        <span class="gg__knob" />
      </button>
      <span class="gg__name">{{ g.group.name }}</span>
      <span class="gg__kind">{{ kindLabel }} · {{ g.memberCount }}</span>
      <button
        v-if="showCollapse"
        type="button"
        class="gg__collapse"
        :title="t('graph.group.collapse')"
        @click.stop="onCollapse"
        @mousedown.stop
        @dblclick.stop
      >
        <Minimize2 :size="11" :stroke-width="1.5" />
      </button>
    </span>
  </div>
</template>

<style scoped>
.gg {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 1px dashed var(--color-line-active);
  border-radius: 8px;
  background: rgb(var(--c-line) / 0.02);
  /* 只读容器：永不拦截画布交互，纯视觉分组。 */
  pointer-events: none;
}

/* 整组关闭：容器更暗、边框虚化，呼应成员禁用。 */
.gg--off {
  border-color: var(--color-line-subtle);
  background: rgb(var(--c-line) / 0.01);
  opacity: 0.7;
}

.gg__label {
  position: absolute;
  top: -10px;
  left: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 1px 6px;
  background: var(--color-app);
  border: 1px solid var(--color-line-subtle);
  border-radius: 4px;
}

/* 开关本体：仅此元素恢复指针事件，可点击。 */
.gg__switch {
  pointer-events: auto;
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

.gg__switch--on {
  background: var(--color-signal-accent, #6366f1);
  border-color: var(--color-signal-accent, #6366f1);
}

.gg__switch--mixed {
  background: var(--color-signal-warn, #d9a441);
  border-color: var(--color-signal-warn, #d9a441);
}

.gg__knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-secondary);
  transition: transform 0.15s, background 0.15s;
}

.gg__switch--on .gg__knob {
  transform: translateX(8px);
  background: #fff;
}

.gg__switch--mixed .gg__knob {
  transform: translateX(4px);
  background: #fff;
}

.gg__name {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.gg__kind {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

/* 折叠按钮：仅此元素恢复指针事件，可点击。 */
.gg__collapse {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px;
  border: 1px solid var(--color-line-subtle);
  border-radius: 3px;
  color: var(--color-text-secondary);
  background: var(--color-float);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.gg__collapse:hover {
  border-color: var(--color-line-active);
  color: var(--color-text-primary);
}
</style>

<script setup lang="ts">
import type { NodeProps } from "@vue-flow/core";
import { computed } from "vue";

import type { GraphFlowNodeData, GraphGroupNodeData } from "../map-document";

const props = defineProps<NodeProps<GraphFlowNodeData>>();

const g = computed(() => props.data as GraphGroupNodeData);
</script>

<template>
  <div class="gg">
    <span class="gg__label">
      <span class="gg__name">{{ g.group.name }}</span>
      <span class="gg__kind">{{ g.group.kind }} · {{ g.memberCount }}</span>
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

.gg__label {
  position: absolute;
  top: -10px;
  left: 10px;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 1px 6px;
  background: var(--color-app);
  border: 1px solid var(--color-line-subtle);
  border-radius: 4px;
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
</style>

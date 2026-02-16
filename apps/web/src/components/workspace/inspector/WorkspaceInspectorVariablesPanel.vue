<script setup lang="ts">
import { SlidersHorizontal } from "lucide-vue-next";

import WorkspaceInspectorDataPair from "./WorkspaceInspectorDataPair.vue";
import WorkspaceInspectorSection from "./WorkspaceInspectorSection.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  t: Translator;
}>();
</script>

<template>
  <WorkspaceInspectorSection :title="props.t('inspector.variables')">
    <template #header-end>
      <SlidersHorizontal class="h-3 w-3 text-zinc-600" />
    </template>
    <div class="space-y-2 rounded border border-white/5 bg-[#121215] p-2">
      <WorkspaceInspectorDataPair
        label="location"
        value='"Museum"'
        value-class="font-mono text-xs text-signal-warn"
      />
      <WorkspaceInspectorDataPair
        label="danger_lvl"
        value="85"
        value-class="font-mono text-xs text-signal-error"
      />
      <WorkspaceInspectorDataPair
        label="inventory"
        value="[Array(3)]"
      />
    </div>
  </WorkspaceInspectorSection>
</template>

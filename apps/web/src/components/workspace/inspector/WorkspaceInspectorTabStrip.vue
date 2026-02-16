<script setup lang="ts">
import {
  workspaceInspectorTabLabelKeyMap,
  workspaceInspectorTabs,
  type WorkspaceInspectorTab
} from "../../../composables/workspace/shell";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  activeTab: WorkspaceInspectorTab;
  t: Translator;
}>();

const emit = defineEmits<{
  setActiveTab: [tab: WorkspaceInspectorTab];
}>();

function setActiveTab(tab: WorkspaceInspectorTab): void {
  emit("setActiveTab", tab);
}
</script>

<template>
  <div class="border-b-subtle flex">
    <button
      v-for="tab in workspaceInspectorTabs"
      :key="tab"
      class="inspector-tab"
      :class="props.activeTab === tab ? 'active' : ''"
      type="button"
      @click="setActiveTab(tab)"
    >
      {{ props.t(workspaceInspectorTabLabelKeyMap[tab]) }}
    </button>
  </div>
</template>

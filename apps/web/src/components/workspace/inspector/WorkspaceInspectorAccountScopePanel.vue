<script setup lang="ts">
import WorkspaceInspectorDataPair from "./WorkspaceInspectorDataPair.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  currentAccount: string;
  t: Translator;
}>();
</script>

<template>
  <div class="space-y-2">
    <WorkspaceInspectorDataPair
      :label="props.t('inspector.accountScope')"
      label-class="data-label"
      :value="props.t('inspector.isolated')"
      value-class="font-mono text-[10px] text-signal-info"
    />
    <WorkspaceInspectorDataPair
      :label="props.currentAccount"
      label-class="text-xs text-zinc-300"
      value="account_id: acc_01"
      value-class="font-mono text-[10px] text-zinc-500"
    />
  </div>
</template>

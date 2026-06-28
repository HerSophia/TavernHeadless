<script setup lang="ts">
import { Activity } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
    <Activity :size="28" :stroke-width="1.5" class="text-text-muted" />
    <div class="space-y-1">
      <p class="text-sm font-medium text-text-secondary">{{ t("workbench.emptyTitle") }}</p>
      <p class="max-w-sm text-xs leading-relaxed text-text-muted">{{ t("workbench.emptyHint") }}</p>
    </div>
  </div>
</template>

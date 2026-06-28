<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { useBackendConnectionStore } from "../../stores/backend-connection";

const { t } = useI18n();
const store = useBackendConnectionStore();

const current = computed(() => store.current);
</script>

<template>
  <div
    class="flex items-center gap-1.5 font-mono text-xs text-text-muted"
    :title="current?.baseUrl ?? t('connection.none')"
  >
    <span
      class="size-1.5 rounded-full"
      :class="current ? 'bg-signal-accent' : 'bg-text-muted'"
      aria-hidden="true"
    />
    <span class="max-w-32 truncate text-text-secondary">
      {{ current?.name ?? t("connection.none") }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { formatWorkspaceEventTime } from "../../../composables/workspace/shell";
import type { WorkspaceEvent } from "../../../stores/workspace-ui";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  events: WorkspaceEvent[];
  t: Translator;
}>();
</script>

<template>
  <div class="border-t-subtle flex h-28 flex-col bg-[#09090b] p-3">
    <div class="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">{{ props.t("events.title") }}</div>
    <div class="flex-1 overflow-y-auto pr-1">
      <div
        v-if="props.events.length === 0"
        class="text-[11px] text-zinc-600"
      >
        {{ props.t("events.empty") }}
      </div>
      <div v-else>
        <div
          v-for="eventItem in props.events"
          :key="eventItem.at"
          class="event-row"
          :class="eventItem.tone"
        >
          <span class="shrink-0 font-mono text-[10px] text-zinc-600">{{ formatWorkspaceEventTime(eventItem.at) }}</span>
          <span>{{ props.t(eventItem.key, eventItem.vars) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

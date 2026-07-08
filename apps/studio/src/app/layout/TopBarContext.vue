<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";

import { useContextStore } from "../../stores/context";

const { t } = useI18n();
const ctx = useContextStore();

// 当前选中会话不在已加载列表中（被过滤/分页排除）时，仍允许下拉显示当前选择。
const currentSessionMissing = computed(() => {
  const id = ctx.currentSessionId;
  return !!id && !ctx.sessions.some((session) => session.id === id);
});

onMounted(() => {
  if (ctx.projects.length === 0) {
    void ctx.loadProjects();
  }
});

function onProjectChange(event: Event): void {
  void ctx.selectProject((event.target as HTMLSelectElement).value);
}

function onSessionChange(event: Event): void {
  ctx.selectSession((event.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="flex items-center gap-3 font-mono text-xs text-text-muted">
    <label class="flex items-center gap-1.5">
      <span>{{ t("topbar.project") }}</span>
      <select
        class="max-w-40 rounded-md border border-line-subtle bg-float px-2 py-1 text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
        :value="ctx.currentProjectId ?? ''"
        :disabled="ctx.loadingProjects"
        @change="onProjectChange"
      >
        <option v-if="ctx.projects.length === 0" value="">—</option>
        <option v-for="project in ctx.projects" :key="project.id" :value="project.id">
          {{ project.name }}
        </option>
      </select>
    </label>

    <label class="flex items-center gap-1.5">
      <span>{{ t("topbar.session") }}</span>
      <select
        class="max-w-40 rounded-md border border-line-subtle bg-float px-2 py-1 text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
        :value="ctx.currentSessionId ?? ''"
        :disabled="ctx.sessions.length === 0 && !currentSessionMissing"
        @change="onSessionChange"
      >
        <option v-if="ctx.sessions.length === 0 && !currentSessionMissing" value="">—</option>
        <option v-else-if="!ctx.currentSessionId" value="">—</option>
        <option v-if="currentSessionMissing" :value="ctx.currentSessionId ?? ''">
          {{ ctx.currentSessionId }}
        </option>
        <option v-for="session in ctx.sessions" :key="session.id" :value="session.id">
          {{ session.title ?? session.id }}
        </option>
      </select>
    </label>
  </div>
</template>

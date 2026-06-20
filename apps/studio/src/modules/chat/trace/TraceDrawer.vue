<script setup lang="ts">
import { AlertCircle, Info, ShieldCheck, X } from "lucide-vue-next";
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";

import UiIconButton from "../../../ui/UiIconButton.vue";
import type { CommitDecision } from "./map-trace";
import { useTurnTrace } from "./use-turn-trace";

const props = defineProps<{
  floorId: string | null;
  floorNo: number | null;
  sessionId: string | null;
}>();

const emit = defineEmits<{ (event: "close"): void }>();

const { t, te } = useI18n();
const { loading, error, trace, load } = useTurnTrace();

const decisionColor: Record<CommitDecision, string> = {
  allow: "var(--color-signal-success)",
  warn: "var(--color-signal-warn)",
  block: "var(--color-signal-error)",
  skipped: "var(--color-text-muted)",
  pending: "var(--color-signal-accent)",
  unknown: "var(--color-text-muted)",
};

function phaseLabel(phase: string): string {
  const key = `chat.phase.${phase}`;
  return te(key) ? t(key) : phase;
}

const carrierLabel = computed(() => {
  const kind = trace.value?.carrier.kind ?? "unknown";
  const key = `chat.trace.carrier.${kind}`;
  return te(key) ? t(key) : kind;
});

watch(
  () => [props.floorId, props.sessionId] as const,
  ([floorId, sessionId]) => {
    if (floorId && sessionId) {
      void load({ floorId, floorNo: props.floorNo, sessionId });
    }
  },
  { immediate: true },
);
</script>

<template>
  <aside class="flex h-full w-96 shrink-0 flex-col border-l border-line-subtle bg-panel">
    <header class="flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
      <ShieldCheck :size="14" :stroke-width="1.5" class="text-text-muted" />
      <span class="text-sm font-medium text-text-secondary">{{ t("chat.trace.title") }}</span>
      <span v-if="floorNo !== null" class="font-mono text-xs text-text-muted">#{{ floorNo }}</span>
      <UiIconButton class="ml-auto" :label="t('chat.trace.close')" @click="emit('close')">
        <X :size="14" :stroke-width="1.5" />
      </UiIconButton>
    </header>

    <div class="min-h-0 flex-1 overflow-auto">
      <div v-if="loading && !trace" class="space-y-3 p-3">
        <div class="h-5 w-32 animate-pulse rounded bg-float" />
        <div class="h-20 w-full animate-pulse rounded bg-float" />
      </div>

      <div v-else-if="error" class="flex items-start gap-2 p-3 text-xs text-signal-error">
        <AlertCircle :size="13" :stroke-width="1.5" class="mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </div>

      <div v-else-if="!trace" class="flex h-full items-center justify-center p-6 text-center">
        <p class="text-xs text-text-muted">{{ t("chat.trace.empty") }}</p>
      </div>

      <div v-else class="divide-y divide-line-subtle">
        <!-- 承载路径 -->
        <section class="px-3 py-3">
          <h3 class="trace-h">{{ t("chat.trace.carrierTitle") }}</h3>
          <div class="mt-2 flex items-center gap-2">
            <span class="rounded border border-line-subtle px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
              {{ carrierLabel }}
            </span>
            <span v-if="trace.carrier.source === 'unknown'" class="font-mono text-[10px] text-text-muted">
              {{ t("chat.trace.carrierUnknown") }}
            </span>
            <span v-if="trace.runType" class="ml-auto font-mono text-[10px] text-text-muted">{{ trace.runType }}</span>
          </div>
        </section>

        <!-- floor 阶段进度 -->
        <section class="px-3 py-3">
          <h3 class="trace-h">{{ t("chat.trace.phasesTitle") }}</h3>
          <ol class="mt-2 space-y-1.5">
            <li
              v-for="step in trace.phases"
              :key="step.phase"
              class="flex items-center gap-2"
            >
              <span class="trace-dot" :class="`trace-dot--${step.state}`" aria-hidden="true" />
              <span
                class="text-xs"
                :class="step.state === 'pending' ? 'text-text-muted' : 'text-text-secondary'"
              >{{ phaseLabel(step.phase) }}</span>
              <span
                v-if="step.state === 'active'"
                class="ml-auto font-mono text-[10px] text-signal-accent"
              >{{ t("chat.trace.active") }}</span>
            </li>
          </ol>
          <p v-if="trace.runStatus" class="mt-2 font-mono text-[10px] text-text-muted">
            status: {{ trace.runStatus }}
          </p>
        </section>

        <!-- CommitGate -->
        <section class="px-3 py-3">
          <h3 class="trace-h">{{ t("chat.trace.commitTitle") }}</h3>
          <div class="mt-2 flex items-center gap-2">
            <span
              class="rounded px-1.5 py-0.5 font-mono text-[11px]"
              :style="{ color: decisionColor[trace.commitGate.decision], borderColor: decisionColor[trace.commitGate.decision] }"
              style="border-width: 1px"
            >{{ te(`chat.trace.decision.${trace.commitGate.decision}`) ? t(`chat.trace.decision.${trace.commitGate.decision}`) : trace.commitGate.decision }}</span>
            <span class="font-mono text-[10px] text-text-muted">{{ trace.commitGate.status }}</span>
          </div>
          <ul v-if="trace.commitGate.issues.length > 0" class="mt-2 space-y-1">
            <li
              v-for="(issue, index) in trace.commitGate.issues"
              :key="index"
              class="flex items-start gap-1.5 text-[11px] leading-snug"
              :style="{ color: issue.severity === 'error' ? 'var(--color-signal-error)' : 'var(--color-signal-warn)' }"
            >
              <AlertCircle :size="11" :stroke-width="1.5" class="mt-0.5 shrink-0" />
              {{ issue.description }}
            </li>
          </ul>
          <p v-if="trace.commitGate.suggestion" class="mt-1.5 text-[11px] leading-snug text-text-muted">
            {{ trace.commitGate.suggestion }}
          </p>
        </section>

        <!-- agentic trace -->
        <section class="px-3 py-3">
          <h3 class="trace-h">{{ t("chat.trace.agenticTitle") }}</h3>

          <div v-if="trace.agentic.tokenUsage" class="mt-2 flex gap-3 font-mono text-[10px] text-text-muted">
            <span>in {{ trace.agentic.tokenUsage.input }}</span>
            <span>out {{ trace.agentic.tokenUsage.output }}</span>
            <span>total {{ trace.agentic.tokenUsage.total }}</span>
          </div>

          <div v-if="trace.agentic.error" class="mt-2 flex items-start gap-1.5 text-[11px] text-signal-error">
            <AlertCircle :size="11" :stroke-width="1.5" class="mt-0.5 shrink-0" />
            <span>{{ trace.agentic.error.code }}: {{ trace.agentic.error.message }}</span>
          </div>

          <template v-if="trace.agentic.summaries.length > 0">
            <h4 class="trace-sub">{{ t("chat.trace.summaries") }}</h4>
            <ul class="mt-1 space-y-1">
              <li v-for="(summary, index) in trace.agentic.summaries" :key="index" class="text-[11px] leading-snug text-text-secondary">
                {{ summary }}
              </li>
            </ul>
          </template>

          <template v-if="trace.agentic.governance.length > 0">
            <h4 class="trace-sub">{{ t("chat.trace.governance") }}</h4>
            <ul class="mt-1 space-y-1">
              <li
                v-for="(entry, index) in trace.agentic.governance"
                :key="index"
                class="flex items-center gap-2 font-mono text-[10px] text-text-muted"
              >
                <span class="truncate text-text-secondary">{{ entry.sourceKind }}</span>
                <span v-if="entry.pinned" class="text-signal-accent">pin</span>
                <span class="ml-auto">{{ entry.retainedTokenCount }}<span v-if="entry.prunedTokenCount > 0" class="text-signal-warn"> -{{ entry.prunedTokenCount }}</span> tok</span>
              </li>
            </ul>
          </template>

          <div
            v-if="trace.restricted || trace.agentic.limitations.length > 0"
            class="mt-3 flex items-start gap-1.5 rounded border border-line-subtle px-2 py-1.5 text-[10px] leading-snug text-text-muted"
          >
            <Info :size="11" :stroke-width="1.5" class="mt-0.5 shrink-0" />
            <span>
              {{ t("chat.trace.restricted") }}
              <template v-if="trace.agentic.limitations.length > 0"> · {{ trace.agentic.limitations.join("; ") }}</template>
            </span>
          </div>
        </section>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.trace-h {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--color-text-secondary);
}

.trace-sub {
  margin-top: 10px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.trace-dot {
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  flex: none;
}

.trace-dot--done {
  background: var(--color-signal-success);
}

.trace-dot--active {
  background: var(--color-signal-accent);
  animation: trace-pulse 1.4s ease-in-out infinite;
}

.trace-dot--pending {
  background: var(--color-text-muted);
  opacity: 0.4;
}

@keyframes trace-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
</style>

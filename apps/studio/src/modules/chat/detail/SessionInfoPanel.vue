<script setup lang="ts">
/**
 * 会话信息面板（SC1-3）：只读展示当前选中会话的关键绑定与配置摘要。
 *
 * 数据源：`chatApi.getSessionDetail`（必需）+ `getSessionEffectiveConfig` / `getSessionScope`（增强，失败降级）。
 * 视图整形交给纯函数 `mapSessionConfigView`；本组件只负责按需拉取、分组渲染与降级提示。
 * 与 trace 抽屉解耦：独立本地状态、独立抽屉，纯只读，不含任何写操作控件。
 */
import { AlertCircle, Info, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { chatApi } from "../../../lib/chat";
import UiIconButton from "../../../ui/UiIconButton.vue";
import { mapSessionConfigView, type SessionConfigView } from "./map-session-config";

const props = defineProps<{ sessionId: string | null }>();
const emit = defineEmits<{ close: [] }>();

const { t, te } = useI18n();

const loading = ref(false);
const error = ref<string | null>(null);
const view = ref<SessionConfigView | null>(null);

// 简单请求令牌：快速切会话时丢弃过期响应，避免旧数据覆盖新数据。
let requestToken = 0;

async function load(id: string): Promise<void> {
  const token = (requestToken += 1);
  loading.value = true;
  error.value = null;
  try {
    const detail = await chatApi.getSessionDetail(id);
    // 增强信息并行拉取；任一失败仅降级对应分组，不拖垮主体。
    const [effective, scope] = await Promise.all([
      chatApi.getSessionEffectiveConfig(id).catch(() => null),
      chatApi.getSessionScope(id).catch(() => null),
    ]);
    if (token !== requestToken) {
      return;
    }
    view.value = mapSessionConfigView(detail, effective, scope);
  } catch (cause) {
    if (token !== requestToken) {
      return;
    }
    error.value = cause instanceof Error ? cause.message : String(cause);
    view.value = null;
  } finally {
    if (token === requestToken) {
      loading.value = false;
    }
  }
}

watch(
  () => props.sessionId,
  (id) => {
    if (id) {
      void load(id);
    } else {
      requestToken += 1;
      view.value = null;
      error.value = null;
      loading.value = false;
    }
  },
  { immediate: true },
);

/** 字符串占位：缺失 → i18n “未绑定 / 使用默认”。 */
function text(value: string | null): string {
  return value ?? t("chat.sessions.info.unset");
}

/** 布尔占位：null → 占位；true/false → 是/否。 */
function bool(value: boolean | null): string {
  if (value == null) {
    return t("chat.sessions.info.unset");
  }
  return value ? t("chat.sessions.info.yes") : t("chat.sessions.info.no");
}

function policyLabel(policy: string): string {
  const key = `chat.sessions.info.sync.${policy}`;
  return te(key) ? t(key) : policy;
}

function formatTime(ts: number): string {
  if (!ts) {
    return t("chat.sessions.info.unset");
  }
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

const paramsSummaryText = computed(() => {
  const summary = view.value?.model.paramsSummary;
  if (!summary) {
    return t("chat.sessions.info.unset");
  }
  const count = t("chat.sessions.info.paramsCount", { count: summary.count });
  return summary.keys.length > 0 ? `${count} · ${summary.keys.join(", ")}` : count;
});

const capabilities = computed(() => {
  const caps = view.value?.effective?.capabilities;
  if (!caps) {
    return [] as { key: string; on: boolean }[];
  }
  return [
    { key: "functionCall", on: caps.supportsFunctionCall },
    { key: "toolChoice", on: caps.supportsToolChoice },
    { key: "streamingToolCall", on: caps.supportsStreamingToolCall },
  ];
});
</script>

<template>
  <aside class="flex h-full w-96 shrink-0 flex-col border-l border-line-subtle bg-panel">
    <header class="flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
      <Info :size="14" :stroke-width="1.5" class="text-text-muted" />
      <span class="text-sm font-medium text-text-secondary">{{ t("chat.sessions.info.title") }}</span>
      <UiIconButton class="ml-auto" :label="t('chat.sessions.info.close')" @click="emit('close')">
        <X :size="14" :stroke-width="1.5" />
      </UiIconButton>
    </header>

    <div class="min-h-0 flex-1 overflow-auto">
      <!-- 加载骨架 -->
      <div v-if="loading && !view" class="space-y-3 p-3">
        <div class="h-4 w-24 animate-pulse rounded bg-float" />
        <div class="h-16 w-full animate-pulse rounded bg-float" />
        <div class="h-16 w-full animate-pulse rounded bg-float" />
      </div>

      <!-- detail 失败：主体不可用 -->
      <div v-else-if="error" class="flex items-start gap-2 p-3 text-xs text-signal-error">
        <AlertCircle :size="13" :stroke-width="1.5" class="mt-0.5 shrink-0" />
        <span class="min-w-0 break-words">{{ error }}</span>
      </div>

      <!-- 无选中会话 -->
      <div v-else-if="!view" class="flex h-full items-center justify-center p-6 text-center">
        <p class="text-xs text-text-muted">{{ t("chat.sessions.info.empty") }}</p>
      </div>

      <div v-else class="divide-y divide-line-subtle">
        <!-- 基础 -->
        <section class="px-3 py-3">
          <h3 class="info-h">{{ t("chat.sessions.info.group.basic") }}</h3>
          <div class="mt-2 space-y-1">
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.status") }}</span>
              <span class="info-value">{{ text(view.basic.status) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.promptMode") }}</span>
              <span class="info-value">{{ text(view.basic.promptMode) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.toolPreset") }}</span>
              <span class="info-value font-mono">{{ text(view.basic.toolPresetKey) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.deepBinding") }}</span>
              <span class="info-value">{{ bool(view.basic.deepBinding) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.createdAt") }}</span>
              <span class="info-value">{{ formatTime(view.basic.createdAt) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.updatedAt") }}</span>
              <span class="info-value">{{ formatTime(view.basic.updatedAt) }}</span>
            </div>
          </div>
        </section>

        <!-- 模型 -->
        <section class="px-3 py-3">
          <h3 class="info-h">{{ t("chat.sessions.info.group.model") }}</h3>
          <div class="mt-2 space-y-1">
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.provider") }}</span>
              <span class="info-value">{{ text(view.model.provider) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.model") }}</span>
              <span class="info-value">{{ text(view.model.name) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.params") }}</span>
              <span class="info-value font-mono">{{ paramsSummaryText }}</span>
            </div>
          </div>
        </section>

        <!-- 提示词资产 -->
        <section class="px-3 py-3">
          <h3 class="info-h">{{ t("chat.sessions.info.group.assets") }}</h3>
          <div class="mt-2 space-y-1">
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.preset") }}</span>
              <span class="info-value font-mono">{{ text(view.assets.presetId) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.presetVersion") }}</span>
              <span class="info-value font-mono">{{ text(view.assets.presetVersionId) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.worldbook") }}</span>
              <span class="info-value font-mono">{{ text(view.assets.worldbookProfileId) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.worldbookVersion") }}</span>
              <span class="info-value font-mono">{{ text(view.assets.worldbookVersionId) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.regex") }}</span>
              <span class="info-value font-mono">{{ text(view.assets.regexProfileId) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.regexVersion") }}</span>
              <span class="info-value font-mono">{{ text(view.assets.regexProfileVersionId) }}</span>
            </div>
          </div>
        </section>

        <!-- 角色与用户 -->
        <section class="px-3 py-3">
          <h3 class="info-h">{{ t("chat.sessions.info.group.identity") }}</h3>
          <div class="mt-2 space-y-1">
            <template v-if="view.identity.character">
              <div class="info-row">
                <span class="info-label">{{ t("chat.sessions.info.field.character") }}</span>
                <span class="info-value">{{ text(view.identity.character.name) }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{{ t("chat.sessions.info.field.hasGreeting") }}</span>
                <span class="info-value">{{ bool(view.identity.character.hasGreeting) }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{{ t("chat.sessions.info.field.syncPolicy") }}</span>
                <span class="info-value">{{ policyLabel(view.identity.character.syncPolicy) }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{{ t("chat.sessions.info.field.characterId") }}</span>
                <span class="info-value font-mono">{{ text(view.identity.character.characterId) }}</span>
              </div>
            </template>
            <div v-else class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.character") }}</span>
              <span class="info-value text-text-muted">{{ t("chat.sessions.info.unset") }}</span>
            </div>

            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.user") }}</span>
              <span class="info-value">{{ view.identity.user ? text(view.identity.user.name) : t("chat.sessions.info.unset") }}</span>
            </div>
          </div>
        </section>

        <!-- 有效配置（增强，缺失降级） -->
        <section class="px-3 py-3">
          <h3 class="info-h">{{ t("chat.sessions.info.group.effective") }}</h3>
          <div v-if="view.effective" class="mt-2 space-y-1">
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.llmProfileSource") }}</span>
              <span class="info-value">{{ text(view.effective.llmProfileSource) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.llmProfileId") }}</span>
              <span class="info-value font-mono">{{ text(view.effective.llmProfileId) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.llmProfileOverridden") }}</span>
              <span class="info-value">{{ bool(view.effective.llmProfileOverridden) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.toolTransport") }}</span>
              <span class="info-value font-mono">{{ text(view.effective.toolTransportSelected) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.toolTransportAvailable") }}</span>
              <span class="info-value font-mono">
                {{ view.effective.toolTransportAvailable.length > 0 ? view.effective.toolTransportAvailable.join(", ") : t("chat.sessions.info.unset") }}
              </span>
            </div>
            <div class="info-row items-start">
              <span class="info-label">{{ t("chat.sessions.info.field.capabilities") }}</span>
              <span class="flex min-w-0 flex-1 flex-wrap justify-end gap-1">
                <span
                  v-for="cap in capabilities"
                  :key="cap.key"
                  class="rounded px-1.5 py-0.5 text-[10px] leading-none"
                  :class="cap.on ? 'bg-panel text-text-secondary' : 'bg-panel text-text-muted line-through'"
                >
                  {{ t(`chat.sessions.info.cap.${cap.key}`) }}
                </span>
              </span>
            </div>
          </div>
          <p v-else class="mt-2 text-xs text-text-muted">{{ t("chat.sessions.info.unavailable") }}</p>
        </section>

        <!-- 归属（增强，缺失降级） -->
        <section class="px-3 py-3">
          <h3 class="info-h">{{ t("chat.sessions.info.group.scope") }}</h3>
          <div v-if="view.scope" class="mt-2 space-y-1">
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.workspaceId") }}</span>
              <span class="info-value font-mono">{{ text(view.scope.workspaceId) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ t("chat.sessions.info.field.projectId") }}</span>
              <span class="info-value font-mono">{{ text(view.scope.projectId) }}</span>
            </div>
          </div>
          <p v-else class="mt-2 text-xs text-text-muted">{{ t("chat.sessions.info.unavailable") }}</p>
        </section>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.info-h {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.info-label {
  flex-shrink: 0;
  font-size: 0.6875rem;
  color: var(--color-text-muted);
}

.info-value {
  min-width: 0;
  flex: 1;
  text-align: right;
  font-size: 0.75rem;
  color: var(--color-text-primary);
  word-break: break-word;
}
</style>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import {
  type LlmGenerationParams,
  type LlmInstanceConfig,
  type LlmInstanceScope,
  type LlmInstanceSlot,
  type LlmInstanceUpsertInput,
} from "../../../lib/models/instances";
import type { LlmProfile } from "../../../lib/models/profiles";
import UiButton from "../../../ui/UiButton.vue";
import UiSelect from "../../../ui/UiSelect.vue";

type RoleSlot = Exclude<LlmInstanceSlot, "*">;

const props = defineProps<{
  slotName: RoleSlot;
  sessionId: string | null;
  profiles: LlmProfile[];
  globalConfig: LlmInstanceConfig | null;
  sessionConfig: LlmInstanceConfig | null;
  /** LI11：该槽位当前生效的 Profile 绑定 id（来自 runtime / profile binding，非实例 preset_id）。 */
  currentProfileId: string | null;
}>();
const emit = defineEmits<{
  save: [
    payload: {
      instance: LlmInstanceUpsertInput;
      /** LI11：Profile 绑定意图——仅当用户改动了 Profile 选择时 `changed=true` 才执行 bind/unbind。 */
      profile: { changed: boolean; profileId: string | null };
    },
  ];
  reset: [payload: { slot: RoleSlot; scope: LlmInstanceScope }];
  cancel: [];
}>();

const { t } = useI18n();

const confirmingReset = ref(false);

const form = reactive({
  scope: "global" as LlmInstanceScope,
  // LI11：选 Profile（模型档案）走 profile binding，这里持有当前选择的 Profile id（"" = 无绑定）。
  profileId: "",
  modelIdOverride: "",
  enabled: true,
  temperature: "",
  topP: "",
  maxOutput: "",
  maxContext: "",
  capFunctionCall: false,
  capToolChoice: false,
  capStreamingToolCall: false,
});

function configForScope(scope: LlmInstanceScope): LlmInstanceConfig | null {
  return scope === "global" ? props.globalConfig : props.sessionConfig;
}

function applyConfig(config: LlmInstanceConfig | null): void {
  form.modelIdOverride = config?.modelIdOverride ?? "";
  form.enabled = config?.enabled ?? true;
  form.temperature = config?.params?.temperature != null ? String(config.params.temperature) : "";
  form.topP = config?.params?.top_p != null ? String(config.params.top_p) : "";
  form.maxOutput = config?.params?.max_output_tokens != null ? String(config.params.max_output_tokens) : "";
  form.maxContext = config?.params?.max_context_tokens != null ? String(config.params.max_context_tokens) : "";
  form.capFunctionCall = config?.capabilities?.supportsFunctionCall ?? false;
  form.capToolChoice = config?.capabilities?.supportsToolChoice ?? false;
  form.capStreamingToolCall = config?.capabilities?.supportsStreamingToolCall ?? false;
}

// LI11：Profile 选择独立于实例配置——初始化为当前生效绑定，仅在用户改动后才写 binding。
const initialProfileId = props.currentProfileId ?? "";
form.profileId = initialProfileId;

applyConfig(configForScope("global"));

watch(
  () => form.scope,
  (scope) => {
    confirmingReset.value = false;
    applyConfig(configForScope(scope));
  },
);

const hasExisting = computed(() => Boolean(configForScope(form.scope)));

const fieldClass =
  "w-full rounded-md border border-line-subtle bg-float px-2.5 py-1.5 text-sm text-text-primary transition-colors duration-150 placeholder:text-text-muted hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent";
const numClass = `${fieldClass} font-mono text-xs`;

const scopeOptions = computed(() => [
  { value: "global" as const, label: t("settings.instances.scope_global") },
  { value: "session" as const, label: t("settings.instances.scope_session"), disabled: !props.sessionId },
]);

const profileOptions = computed(() => [
  { value: "", label: t("settings.instances.profileNone") },
  ...props.profiles.map((profile) => ({ value: profile.id, label: `${profile.presetName} · ${profile.modelId}` })),
]);

function parseNum(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function onSave(): void {
  const params: LlmGenerationParams = {};
  const temperature = parseNum(form.temperature);
  if (temperature !== null) {
    params.temperature = temperature;
  }
  const topP = parseNum(form.topP);
  if (topP !== null) {
    params.top_p = topP;
  }
  const maxOut = parseNum(form.maxOutput);
  if (maxOut !== null) {
    params.max_output_tokens = maxOut;
  }
  const maxCtx = parseNum(form.maxContext);
  if (maxCtx !== null) {
    params.max_context_tokens = maxCtx;
  }
  const hasParams = Object.keys(params).length > 0;

  // LI11：实例 upsert 不再写 preset_id（提示词预设覆盖职责将由图节点装配承载）；
  // 选 Profile 改由 profile binding 表达，作为独立意图随 payload 上抛由面板执行。
  emit("save", {
    instance: {
      slot: props.slotName,
      scope: form.scope,
      sessionId: form.scope === "session" ? props.sessionId ?? undefined : undefined,
      modelIdOverride: form.modelIdOverride.trim() || null,
      enabled: form.enabled,
      params: hasParams ? params : null,
      capabilities: {
        supportsFunctionCall: form.capFunctionCall,
        supportsToolChoice: form.capToolChoice,
        supportsStreamingToolCall: form.capStreamingToolCall,
        unsupportedGenerationParams: [],
      },
    },
    profile: { changed: form.profileId !== initialProfileId, profileId: form.profileId || null },
  });
}

function onReset(): void {
  emit("reset", { slot: props.slotName, scope: form.scope });
}
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-sm font-medium text-text-primary">{{ t(`settings.instances.slot_${slotName}`) }}</h3>

    <div class="space-y-3">
      <div class="space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.instances.scope") }}</span>
        <UiSelect v-model="form.scope" :options="scopeOptions" />
        <span v-if="!sessionId" class="block text-xs text-text-muted">{{ t("settings.instances.sessionRequired") }}</span>
      </div>

      <div class="space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.instances.profile") }}</span>
        <UiSelect v-model="form.profileId" :options="profileOptions" />
        <span class="block text-[11px] text-text-muted">{{ t("settings.instances.profileBindingHint") }}</span>
      </div>

      <label class="block space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.instances.modelOverride") }}</span>
        <input v-model="form.modelIdOverride" :class="numClass" placeholder="gpt-4o-mini" />
      </label>

      <label class="flex items-center gap-2 text-xs text-text-secondary">
        <input v-model="form.enabled" type="checkbox" class="accent-signal-accent" />
        <span>{{ t("settings.instances.enabled") }}</span>
      </label>

      <div class="space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.instances.params") }}</span>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">
            <span class="text-[11px] text-text-muted">{{ t("settings.instances.temperature") }}</span>
            <input v-model="form.temperature" :class="numClass" inputmode="decimal" placeholder="—" />
          </label>
          <label class="space-y-1">
            <span class="text-[11px] text-text-muted">{{ t("settings.instances.topP") }}</span>
            <input v-model="form.topP" :class="numClass" inputmode="decimal" placeholder="—" />
          </label>
          <label class="space-y-1">
            <span class="text-[11px] text-text-muted">{{ t("settings.instances.maxOutput") }}</span>
            <input v-model="form.maxOutput" :class="numClass" inputmode="numeric" placeholder="—" />
          </label>
          <label class="space-y-1">
            <span class="text-[11px] text-text-muted">{{ t("settings.instances.maxContext") }}</span>
            <input v-model="form.maxContext" :class="numClass" inputmode="numeric" placeholder="—" />
          </label>
        </div>
      </div>

      <div class="space-y-1.5">
        <span class="text-xs text-text-secondary">{{ t("settings.instances.capabilities") }}</span>
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          <input v-model="form.capFunctionCall" type="checkbox" class="accent-signal-accent" />
          <span>{{ t("settings.instances.capFunctionCall") }}</span>
        </label>
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          <input v-model="form.capToolChoice" type="checkbox" class="accent-signal-accent" />
          <span>{{ t("settings.instances.capToolChoice") }}</span>
        </label>
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          <input v-model="form.capStreamingToolCall" type="checkbox" class="accent-signal-accent" />
          <span>{{ t("settings.instances.capStreamingToolCall") }}</span>
        </label>
      </div>
    </div>

    <div class="flex items-center gap-2 border-t border-line-subtle pt-3">
      <UiButton @click="onSave">{{ t("settings.instances.save") }}</UiButton>
      <UiButton variant="ghost" @click="emit('cancel')">{{ t("settings.instances.cancel") }}</UiButton>

      <template v-if="hasExisting">
        <template v-if="confirmingReset">
          <span class="ml-auto text-xs text-text-muted">{{ t("settings.instances.confirmReset") }}</span>
          <UiButton variant="ghost" @click="onReset">{{ t("settings.instances.confirm") }}</UiButton>
          <UiButton variant="ghost" @click="confirmingReset = false">{{ t("settings.instances.cancel") }}</UiButton>
        </template>
        <button
          v-else
          type="button"
          class="ml-auto inline-flex h-8 items-center rounded-md border border-transparent px-3 text-sm text-text-secondary transition-colors duration-150 hover:bg-float hover:text-signal-error focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          @click="confirmingReset = true"
        >
          {{ t("settings.instances.reset") }}
        </button>
      </template>
    </div>
  </div>
</template>

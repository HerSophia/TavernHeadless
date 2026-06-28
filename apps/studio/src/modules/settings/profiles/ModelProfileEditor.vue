<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";

import { maskCredential } from "../../../lib/backend/connection";
import {
  LLM_PROVIDERS,
  modelProfilesApi,
  type LlmDiscoveredModel,
  type LlmProfile,
  type LlmProvider,
  type ModelProfileCreateInput,
  type ModelProfileUpdateInput,
} from "../../../lib/models/profiles";
import UiButton from "../../../ui/UiButton.vue";
import UiCombobox from "../../../ui/UiCombobox.vue";
import UiSelect from "../../../ui/UiSelect.vue";

const props = defineProps<{ profile?: LlmProfile | null }>();
const emit = defineEmits<{
  create: [input: ModelProfileCreateInput];
  update: [input: ModelProfileUpdateInput];
  cancel: [];
}>();

const { t } = useI18n();

const isExisting = computed(() => Boolean(props.profile?.id));
const hasStoredKey = computed(() => Boolean(props.profile?.apiKeyMasked));

const form = reactive({
  presetName: props.profile?.presetName ?? "",
  provider: (props.profile?.provider ?? "openai") as LlmProvider,
  baseUrl: props.profile?.baseUrl ?? "",
  apiKey: "",
  apiKeyName: props.profile?.apiKeyName ?? "",
  modelId: props.profile?.modelId ?? "",
  status: (props.profile?.status === "disabled" ? "disabled" : "active") as "active" | "disabled",
});

const discovered = ref<LlmDiscoveredModel[]>([]);
const discovering = ref(false);
const discoverError = ref<string | null>(null);
const testing = ref(false);
const testResult = ref<"ok" | "failed" | null>(null);
const testDetail = ref<string | null>(null);

const fieldClass =
  "w-full rounded-md border border-line-subtle bg-float px-2.5 py-1.5 text-sm text-text-primary transition-colors duration-150 placeholder:text-text-muted hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent";

const providerOptions = computed(() => LLM_PROVIDERS.map((provider) => ({ value: provider, label: provider })));

const statusOptions = computed(() => [
  { value: "active" as const, label: t("settings.profiles.statusActive") },
  { value: "disabled" as const, label: t("settings.profiles.statusDisabled") },
]);

const modelOptions = computed(() => discovered.value.map((model) => ({ value: model.id, label: model.label })));

async function onDiscover(): Promise<void> {
  discovering.value = true;
  discoverError.value = null;
  discovered.value = [];
  try {
    // 输入了新 key 则用新 key 发现；否则复用已保存档案的密钥（传 profileId）。
    discovered.value = await modelProfilesApi.discoverModels(
      form.apiKey
        ? { provider: form.provider, apiKey: form.apiKey, baseUrl: form.baseUrl || undefined }
        : { profileId: props.profile?.id, baseUrl: form.baseUrl || undefined },
    );
    if (discovered.value.length === 0) {
      discoverError.value = t("settings.profiles.noModels");
    }
  } catch (cause) {
    discoverError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    discovering.value = false;
  }
}

async function onTest(): Promise<void> {
  testing.value = true;
  testResult.value = null;
  testDetail.value = null;
  try {
    // 输入了新key 则用新 key 测试；否则复用已保存档案的密钥（传 profileId）。
    await modelProfilesApi.testModel(
      form.apiKey
        ? { provider: form.provider, apiKey: form.apiKey, baseUrl: form.baseUrl || undefined, modelId: form.modelId }
        : { profileId: props.profile?.id, modelId: form.modelId, baseUrl: form.baseUrl || undefined },
    );
    testResult.value = "ok";
  } catch (cause) {
    testResult.value = "failed";
    testDetail.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    testing.value = false;
  }
}

function onSave(): void {
  const presetName = form.presetName.trim() || t("settings.profiles.untitled");
  if (isExisting.value && props.profile) {
    const input: ModelProfileUpdateInput = {
      profileId: props.profile.id,
      provider: form.provider,
      presetName,
      modelId: form.modelId.trim(),
      apiKeyName: form.apiKeyName.trim() || null,
      baseUrl: form.baseUrl.trim() || null,
      status: form.status,
    };
    if (form.apiKey) {
      input.apiKey = form.apiKey;
    }
    emit("update", input);
    return;
  }
  emit("create", {
    provider: form.provider,
    presetName,
    modelId: form.modelId.trim(),
    apiKey: form.apiKey,
    apiKeyName: form.apiKeyName.trim() || undefined,
    baseUrl: form.baseUrl.trim() || undefined,
  });
}
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-sm font-medium text-text-primary">
      {{ isExisting ? t("settings.profiles.editTitle") : t("settings.profiles.addTitle") }}
    </h3>

    <div class="space-y-3">
      <label class="block space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.profiles.name") }}</span>
        <input v-model="form.presetName" :class="fieldClass" :placeholder="t('settings.profiles.namePlaceholder')" />
      </label>

      <div class="space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.profiles.provider") }}</span>
        <UiSelect v-model="form.provider" :options="providerOptions" />
      </div>

      <label class="block space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.profiles.baseUrl") }}</span>
        <input v-model="form.baseUrl" :class="[fieldClass, 'font-mono text-xs']" placeholder="https://api.openai.com/v1" />
        <span class="block text-xs text-text-muted">{{ t("settings.profiles.baseUrlHint") }}</span>
      </label>

      <label class="block space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.profiles.apiKey") }}</span>
        <input
          v-model="form.apiKey"
          type="password"
          autocomplete="off"
          :class="[fieldClass, 'font-mono text-xs']"
          :placeholder="hasStoredKey ? t('settings.profiles.apiKeyKeep') : t('settings.profiles.apiKeyNew')"
        />
        <span v-if="hasStoredKey" class="block font-mono text-xs text-text-muted">
          {{ t("settings.profiles.currentKey") }}: {{ maskCredential(props.profile?.apiKeyMasked) }}
        </span>
      </label>

      <label class="block space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.profiles.apiKeyName") }}</span>
        <input v-model="form.apiKeyName" :class="fieldClass" />
      </label>

      <div class="space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.profiles.modelId") }}</span>
        <div class="flex items-start gap-2">
          <UiCombobox
            v-model="form.modelId"
            :options="modelOptions"
            :placeholder="t('settings.profiles.modelIdPlaceholder')"
            class="flex-1"
          />
          <button
            type="button"
            class="inline-flex h-8 shrink-0 items-center rounded-md border border-line-subtle bg-float px-2.5 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent disabled:opacity-40"
            :disabled="discovering || (!form.apiKey && !hasStoredKey)"
            @click="onDiscover"
          >
            {{ discovering ? t("settings.profiles.discovering") : t("settings.profiles.discover") }}
          </button>
        </div>
        <span v-if="discoverError" class="block text-xs text-signal-warn">{{ discoverError }}</span>
      </div>

      <div v-if="isExisting" class="space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.profiles.status") }}</span>
        <UiSelect v-model="form.status" :options="statusOptions" />
      </div>
    </div>

    <div class="flex items-center gap-2 border-t border-line-subtle pt-3">
      <UiButton @click="onSave">{{ t("settings.profiles.save") }}</UiButton>
      <UiButton variant="ghost" @click="emit('cancel')">{{ t("settings.profiles.cancel") }}</UiButton>
      <button
        type="button"
        class="ml-auto inline-flex h-8 items-center rounded-md border border-line-subtle bg-float px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-line-active hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent disabled:opacity-40"
        :disabled="testing || (!form.apiKey && !hasStoredKey) || !form.modelId"
        @click="onTest"
      >
        {{ testing ? t("settings.profiles.testing") : t("settings.profiles.test") }}
      </button>
    </div>

    <p v-if="testResult" class="font-mono text-xs" :class="testResult === 'ok' ? 'text-signal-success' : 'text-signal-error'">
      {{ testResult === "ok" ? t("settings.profiles.testOk") : t("settings.profiles.testFailed") }}
      <span v-if="testDetail" class="text-text-muted">· {{ testDetail }}</span>
    </p>
  </div>
</template>

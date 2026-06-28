<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";

import { maskCredential, type BackendAuthMode, type BackendConnection } from "../../../lib/backend/connection";
import type { BackendConnectionInput } from "../../../stores/backend-connection";
import UiButton from "../../../ui/UiButton.vue";
import { useConnectionTest } from "./use-connection-test";

const props = defineProps<{ connection?: BackendConnection | null }>();
const emit = defineEmits<{ save: [input: BackendConnectionInput]; cancel: [] }>();

const { t } = useI18n();
const test = useConnectionTest();

const authModes: BackendAuthMode[] = ["dev", "api_key", "client_api_key", "jwt"];

const form = reactive({
  name: props.connection?.name ?? "",
  baseUrl: props.connection?.baseUrl ?? "http://localhost:3000",
  authMode: (props.connection?.authMode ?? "dev") as BackendAuthMode,
  credential: "",
  accountHint: props.connection?.accountHint ?? "",
  persistCredential: props.connection?.persistCredential ?? false,
});
const clearCredential = ref(false);

const isExisting = computed(() => Boolean(props.connection?.id));
const hasStoredCredential = computed(() => Boolean(props.connection?.credential));
const needsCredential = computed(() => form.authMode !== "dev");
const storedMask = computed(() => maskCredential(props.connection?.credential));

const fieldClass =
  "w-full rounded-md border border-line-subtle bg-float px-2.5 py-1.5 text-sm text-text-primary transition-colors duration-150 placeholder:text-text-muted hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent";

const resultTone = computed(() => {
  switch (test.status.value) {
    case "ok":
      return "text-signal-success";
    case "auth_failed":
    case "unreachable":
      return "text-signal-error";
    case "error":
      return "text-signal-warn";
    default:
      return "text-text-muted";
  }
});

const resultLabel = computed(() => {
  switch (test.status.value) {
    case "testing":
      return t("settings.backend.testing");
    case "ok":
      return t("settings.backend.result_ok");
    case "auth_failed":
      return t("settings.backend.result_auth_failed");
    case "unreachable":
      return t("settings.backend.result_unreachable");
    case "error":
      return t("settings.backend.result_error");
    default:
      return "";
  }
});

function buildConnectionForTest(): BackendConnection {
  const credential = form.credential || (clearCredential.value ? null : props.connection?.credential ?? null);
  return {
    id: props.connection?.id ?? "__test__",
    name: form.name || "Test",
    baseUrl: form.baseUrl,
    authMode: form.authMode,
    credential,
    accountHint: form.accountHint || null,
    persistCredential: form.persistCredential,
  };
}

async function onTest(): Promise<void> {
  await test.run(buildConnectionForTest());
}

function onSave(): void {
  const input: BackendConnectionInput = {
    id: props.connection?.id,
    name: form.name.trim() || t("settings.backend.untitled"),
    baseUrl: form.baseUrl.trim(),
    authMode: form.authMode,
    accountHint:
      form.authMode === "dev" ? form.accountHint.trim() || null : props.connection?.accountHint ?? null,
    persistCredential: form.authMode === "dev" ? false : form.persistCredential,
  };

  if (form.authMode === "dev") {
    input.credential = null;
  } else if (form.credential) {
    input.credential = form.credential;
  } else if (clearCredential.value) {
    input.credential = null;
  }
  // 否则：不带 credential 键 → store.upsert 合并时保留现有凭证（只写语义）。

  emit("save", input);
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-text-primary">
        {{ isExisting ? t("settings.backend.editTitle") : t("settings.backend.addTitle") }}
      </h3>
    </div>

    <div class="space-y-3">
      <label class="block space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.backend.name") }}</span>
        <input v-model="form.name" :class="fieldClass" :placeholder="t('settings.backend.namePlaceholder')" />
      </label>

      <label class="block space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.backend.baseUrl") }}</span>
        <input v-model="form.baseUrl" :class="[fieldClass, 'font-mono text-xs']" placeholder="http://localhost:3000" />
      </label>

      <label class="block space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.backend.authMode") }}</span>
        <select v-model="form.authMode" :class="fieldClass">
          <option v-for="mode in authModes" :key="mode" :value="mode">
            {{ t(`settings.backend.authMode_${mode}`) }}
          </option>
        </select>
      </label>

      <label v-if="form.authMode === 'dev'" class="block space-y-1">
        <span class="text-xs text-text-secondary">{{ t("settings.backend.accountHint") }}</span>
        <input v-model="form.accountHint" :class="[fieldClass, 'font-mono text-xs']" placeholder="account_id" />
        <span class="block text-xs text-text-muted">{{ t("settings.backend.accountHintHint") }}</span>
      </label>

      <template v-if="needsCredential">
        <label class="block space-y-1">
          <span class="text-xs text-text-secondary">{{ t("settings.backend.credential") }}</span>
          <input
            v-model="form.credential"
            type="password"
            autocomplete="off"
            :class="[fieldClass, 'font-mono text-xs']"
            :placeholder="hasStoredCredential ? t('settings.backend.credentialKeep') : t('settings.backend.credentialNew')"
          />
          <span v-if="hasStoredCredential && !clearCredential" class="block font-mono text-xs text-text-muted">
            {{ t("settings.backend.currentCredential") }}: {{ storedMask }}
          </span>
        </label>

        <label class="flex items-center gap-2 text-xs text-text-secondary">
          <input v-model="form.persistCredential" type="checkbox" class="accent-signal-accent" />
          <span>{{ t("settings.backend.persist") }}</span>
        </label>
        <p class="text-xs text-text-muted">{{ t("settings.backend.persistHint") }}</p>

        <label v-if="hasStoredCredential" class="flex items-center gap-2 text-xs text-text-secondary">
          <input v-model="clearCredential" type="checkbox" class="accent-signal-error" />
          <span>{{ t("settings.backend.clearCredential") }}</span>
        </label>
      </template>

      <p v-else class="text-xs text-text-muted">{{ t("settings.backend.devNote") }}</p>
    </div>

    <div class="flex items-center gap-2 border-t border-line-subtle pt-3">
      <UiButton @click="onSave">{{ t("settings.backend.save") }}</UiButton>
      <UiButton variant="ghost" @click="emit('cancel')">{{ t("settings.backend.cancel") }}</UiButton>
      <button
        type="button"
        class="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-line-subtle bg-float px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-line-active hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent disabled:opacity-40"
        :disabled="test.status.value === 'testing'"
        @click="onTest"
      >
        {{ test.status.value === "testing" ? t("settings.backend.testing") : t("settings.backend.test") }}
      </button>
    </div>

    <p v-if="resultLabel" class="font-mono text-xs" :class="resultTone">
      {{ resultLabel }}
      <span v-if="test.result.value?.detail" class="text-text-muted">· {{ test.result.value.detail }}</span>
    </p>
  </div>
</template>

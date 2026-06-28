<script setup lang="ts">
import { Pencil, Plus, Trash2 } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import {
  type LlmProfile,
  type ModelProfileCreateInput,
  type ModelProfileUpdateInput,
} from "../../../lib/models/profiles";
import { useModelsStore } from "../../../stores/models";
import UiButton from "../../../ui/UiButton.vue";
import UiIconButton from "../../../ui/UiIconButton.vue";
import ModelProfileEditor from "./ModelProfileEditor.vue";

const { t } = useI18n();
const store = useModelsStore();

const editing = ref<LlmProfile | "new" | null>(null);
const confirmingDelete = ref<string | null>(null);
const busy = ref(false);

const editingProfile = computed<LlmProfile | null>(() =>
  editing.value && editing.value !== "new" ? editing.value : null,
);

onMounted(() => {
  if (store.profiles.length === 0) {
    void store.loadProfiles();
  }
});

function onAdd(): void {
  confirmingDelete.value = null;
  editing.value = "new";
}

function onEdit(profile: LlmProfile): void {
  confirmingDelete.value = null;
  editing.value = profile;
}

async function onCreate(input: ModelProfileCreateInput): Promise<void> {
  busy.value = true;
  try {
    await store.createProfile(input);
    editing.value = null;
  } finally {
    busy.value = false;
  }
}

async function onUpdate(input: ModelProfileUpdateInput): Promise<void> {
  busy.value = true;
  try {
    await store.updateProfile(input);
    editing.value = null;
  } finally {
    busy.value = false;
  }
}

async function onDelete(profileId: string): Promise<void> {
  busy.value = true;
  try {
    await store.deleteProfile(profileId);
    confirmingDelete.value = null;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 p-5">
    <header class="flex items-center justify-between">
      <div class="space-y-0.5">
        <h2 class="text-sm font-medium text-text-primary">{{ t("settings.profiles.title") }}</h2>
        <p class="text-xs text-text-muted">{{ t("settings.profiles.subtitle") }}</p>
      </div>
      <UiButton v-if="!editing" @click="onAdd">
        <Plus :size="14" :stroke-width="1.5" />
        {{ t("settings.profiles.add") }}
      </UiButton>
    </header>

    <section v-if="editing" class="rounded-md border border-line-subtle bg-panel p-4">
      <ModelProfileEditor
        :key="editingProfile?.id ?? 'new'"
        :profile="editingProfile"
        @create="onCreate"
        @update="onUpdate"
        @cancel="editing = null"
      />
    </section>

    <section v-else class="divide-y divide-line-subtle overflow-hidden rounded-md border border-line-subtle bg-panel">
      <p v-if="store.profiles.length === 0" class="px-4 py-6 text-center text-xs text-text-muted">
        {{ t("settings.profiles.empty") }}
      </p>

      <div v-for="profile in store.profiles" :key="profile.id" class="flex items-center gap-3 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm text-text-primary">{{ profile.presetName }}</span>
            <span class="shrink-0 rounded border border-line-subtle px-1.5 py-px font-mono text-[10px] uppercase text-text-muted">
              {{ profile.provider }}
            </span>
            <span
              v-if="profile.status === 'disabled'"
              class="shrink-0 font-mono text-[10px] text-signal-warn"
            >
              {{ t("settings.profiles.statusDisabled") }}
            </span>
          </div>
          <div class="mt-0.5 flex items-center gap-2 font-mono text-xs text-text-muted">
            <span class="truncate">{{ profile.modelId }}</span>
            <span v-if="profile.baseUrl" class="truncate">· {{ profile.baseUrl }}</span>
            <span class="shrink-0">· {{ profile.apiKeyMasked }}</span>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <template v-if="confirmingDelete === profile.id">
            <span class="text-xs text-text-muted">{{ t("settings.profiles.confirmDelete") }}</span>
            <UiButton variant="ghost" @click="onDelete(profile.id)">{{ t("settings.profiles.confirm") }}</UiButton>
            <UiButton variant="ghost" @click="confirmingDelete = null">{{ t("settings.profiles.cancel") }}</UiButton>
          </template>
          <template v-else>
            <UiIconButton :label="t('settings.profiles.edit')" @click="onEdit(profile)">
              <Pencil :size="14" :stroke-width="1.5" />
            </UiIconButton>
            <UiIconButton :label="t('settings.profiles.delete')" @click="confirmingDelete = profile.id">
              <Trash2 :size="14" :stroke-width="1.5" />
            </UiIconButton>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

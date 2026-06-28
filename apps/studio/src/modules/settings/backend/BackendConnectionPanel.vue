<script setup lang="ts">
import { Check, Pencil, Plus, Trash2 } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { maskCredential, type BackendConnection } from "../../../lib/backend/connection";
import { useBackendConnectionStore, type BackendConnectionInput } from "../../../stores/backend-connection";
import { useContextStore } from "../../../stores/context";
import UiButton from "../../../ui/UiButton.vue";
import UiIconButton from "../../../ui/UiIconButton.vue";
import BackendConnectionEditor from "./BackendConnectionEditor.vue";

const { t } = useI18n();
const store = useBackendConnectionStore();
const ctx = useContextStore();

const editing = ref<BackendConnection | "new" | null>(null);
const confirmingDelete = ref<string | null>(null);

const editingConnection = computed<BackendConnection | null>(() =>
  editing.value && editing.value !== "new" ? editing.value : null,
);

function refreshContext(): void {
  ctx.reset();
  void ctx.loadProjects();
}

function onAdd(): void {
  confirmingDelete.value = null;
  editing.value = "new";
}

function onEdit(connection: BackendConnection): void {
  confirmingDelete.value = null;
  editing.value = connection;
}

function onCancel(): void {
  editing.value = null;
}

function onSave(input: BackendConnectionInput): void {
  const saved = store.upsert(input);
  if (store.currentId === saved.id) {
    refreshContext();
  }
  editing.value = null;
}

function onSetCurrent(id: string): void {
  if (store.currentId === id) {
    return;
  }
  store.setCurrent(id);
  refreshContext();
}

function onDelete(id: string): void {
  const wasCurrent = store.currentId === id;
  store.remove(id);
  confirmingDelete.value = null;
  if (wasCurrent) {
    refreshContext();
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 p-5">
    <header class="flex items-center justify-between">
      <div class="space-y-0.5">
        <h2 class="text-sm font-medium text-text-primary">{{ t("settings.backend.title") }}</h2>
        <p class="text-xs text-text-muted">{{ t("settings.backend.subtitle") }}</p>
      </div>
      <UiButton v-if="!editing" @click="onAdd">
        <Plus :size="14" :stroke-width="1.5" />
        {{ t("settings.backend.add") }}
      </UiButton>
    </header>

    <!-- Editor (master-detail) -->
    <section v-if="editing" class="rounded-md border border-line-subtle bg-panel p-4">
      <BackendConnectionEditor
        :key="editingConnection?.id ?? 'new'"
        :connection="editingConnection"
        @save="onSave"
        @cancel="onCancel"
      />
    </section>

    <!-- List -->
    <section v-else class="divide-y divide-line-subtle overflow-hidden rounded-md border border-line-subtle bg-panel">
      <p v-if="store.connections.length === 0" class="px-4 py-6 text-center text-xs text-text-muted">
        {{ t("settings.backend.empty") }}
      </p>

      <div
        v-for="connection in store.connections"
        :key="connection.id"
        class="flex items-center gap-3 px-4 py-3"
        :class="connection.id === store.currentId ? 'border-l-2 border-l-signal-accent bg-float/40' : 'border-l-2 border-l-transparent'"
      >
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="connection.id === store.currentId ? 'bg-signal-accent' : 'bg-text-muted'"
          aria-hidden="true"
        />

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm text-text-primary">{{ connection.name }}</span>
            <span class="shrink-0 rounded border border-line-subtle px-1.5 py-px font-mono text-[10px] uppercase text-text-muted">
              {{ t(`settings.backend.authMode_${connection.authMode}`) }}
            </span>
            <span v-if="connection.id === store.currentId" class="shrink-0 font-mono text-[10px] text-signal-accent">
              {{ t("settings.backend.current") }}
            </span>
          </div>
          <div class="mt-0.5 flex items-center gap-2 font-mono text-xs text-text-muted">
            <span class="truncate">{{ connection.baseUrl }}</span>
            <span v-if="connection.credential" class="shrink-0">· {{ maskCredential(connection.credential) }}</span>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <template v-if="confirmingDelete === connection.id">
            <span class="text-xs text-text-muted">{{ t("settings.backend.confirmDelete") }}</span>
            <UiButton variant="ghost" @click="onDelete(connection.id)">{{ t("settings.backend.confirm") }}</UiButton>
            <UiButton variant="ghost" @click="confirmingDelete = null">{{ t("settings.backend.cancel") }}</UiButton>
          </template>
          <template v-else>
            <UiButton v-if="connection.id !== store.currentId" variant="ghost" @click="onSetCurrent(connection.id)">
              <Check :size="14" :stroke-width="1.5" />
              {{ t("settings.backend.setCurrent") }}
            </UiButton>
            <UiIconButton :label="t('settings.backend.edit')" @click="onEdit(connection)">
              <Pencil :size="14" :stroke-width="1.5" />
            </UiIconButton>
            <UiIconButton :label="t('settings.backend.delete')" @click="confirmingDelete = connection.id">
              <Trash2 :size="14" :stroke-width="1.5" />
            </UiIconButton>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

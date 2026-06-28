<script setup lang="ts">
import { Pencil } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import {
  type LlmInstanceScope,
  type LlmInstanceSlot,
  type LlmInstanceUpsertInput,
} from "../../../lib/models/instances";
import { useContextStore } from "../../../stores/context";
import { useModelsStore } from "../../../stores/models";
import UiIconButton from "../../../ui/UiIconButton.vue";
import LlmInstanceEditor from "./LlmInstanceEditor.vue";
import { mapResolvedSlots } from "./map-resolved";

type RoleSlot = Exclude<LlmInstanceSlot, "*">;

const { t } = useI18n();
const store = useModelsStore();
const ctx = useContextStore();

const editingSlot = ref<RoleSlot | null>(null);
const busy = ref(false);

const sessionId = computed(() => ctx.currentSessionId);
// LI11：Profile（模型档案）取自 profile binding（store.runtime），实例侧字段取自 store.resolved。
const rows = computed(() => mapResolvedSlots(store.resolved, store.runtime, store.profiles));
const editingProfileId = computed(
  () => rows.value.find((row) => row.slot === editingSlot.value)?.profileId ?? null,
);

onMounted(async () => {
  if (store.profiles.length === 0) {
    await store.loadProfiles();
  }
  await store.loadInstances(sessionId.value ?? undefined);
});

watch(sessionId, (value) => {
  editingSlot.value = null;
  void store.loadInstances(value ?? undefined);
});

async function onSave(payload: {
  instance: LlmInstanceUpsertInput;
  profile: { changed: boolean; profileId: string | null };
}): Promise<void> {
  busy.value = true;
  try {
    const { instance, profile } = payload;
    // LI11：先按 profile binding 处理 Profile 选择（仅当用户改动），再 upsert 实例配置。
    if (profile.changed) {
      const slot = instance.slot as RoleSlot;
      if (profile.profileId) {
        await store.bindSlotProfile(
          { profileId: profile.profileId, slot, scope: instance.scope, sessionId: instance.sessionId },
          sessionId.value ?? undefined,
        );
      } else {
        await store.unbindSlotProfile(
          { slot, scope: instance.scope, sessionId: instance.sessionId },
          sessionId.value ?? undefined,
        );
      }
    }
    await store.upsertInstance(instance, sessionId.value ?? undefined);
    editingSlot.value = null;
  } finally {
    busy.value = false;
  }
}

async function onReset(payload: { slot: RoleSlot; scope: LlmInstanceScope }): Promise<void> {
  busy.value = true;
  try {
    await store.removeInstance(
      payload.slot,
      payload.scope,
      payload.scope === "session" ? sessionId.value ?? undefined : undefined,
      sessionId.value ?? undefined,
    );
    editingSlot.value = null;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 p-5">
    <header class="space-y-0.5">
      <h2 class="text-sm font-medium text-text-primary">{{ t("settings.instances.title") }}</h2>
      <p class="text-xs text-text-muted">{{ t("settings.instances.subtitle") }}</p>
    </header>

    <section v-if="editingSlot" class="rounded-md border border-line-subtle bg-panel p-4">
      <LlmInstanceEditor
        :key="`${editingSlot}-${sessionId ?? 'none'}`"
        :slot-name="editingSlot"
        :session-id="sessionId"
        :profiles="store.profiles"
        :global-config="store.findInstance(editingSlot, 'global')"
        :session-config="store.findInstance(editingSlot, 'session')"
        :current-profile-id="editingProfileId"
        @save="onSave"
        @reset="onReset"
        @cancel="editingSlot = null"
      />
    </section>

    <section class="divide-y divide-line-subtle overflow-hidden rounded-md border border-line-subtle bg-panel">
      <div class="px-4 py-2 text-[11px] uppercase tracking-wide text-text-muted">
        {{ t("settings.instances.effectiveTitle") }}
      </div>
      <div v-for="row in rows" :key="row.slot" class="flex items-center gap-3 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-sm text-text-primary">{{ t(`settings.instances.slot_${row.slot}`) }}</span>
            <span class="shrink-0 rounded border border-line-subtle px-1.5 py-px font-mono text-[10px] text-text-muted">
              {{ t(`settings.instances.source_${row.source}`) }}
            </span>
            <span v-if="!row.enabled" class="shrink-0 font-mono text-[10px] text-signal-warn">off</span>
          </div>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-xs text-text-muted">
            <span>{{ row.profileName ?? t("settings.instances.source_default") }}</span>
            <span v-if="row.modelId">· {{ row.modelId }}</span>
            <span v-if="row.temperature !== null">· t={{ row.temperature }}</span>
            <span v-if="row.maxOutputTokens !== null">· out={{ row.maxOutputTokens }}</span>
          </div>
        </div>

        <UiIconButton :label="t('settings.instances.edit')" @click="editingSlot = row.slot">
          <Pencil :size="14" :stroke-width="1.5" />
        </UiIconButton>
      </div>
    </section>
  </div>
</template>

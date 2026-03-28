<script setup lang="ts">
import WorkspaceInspectorAccountScopePanel from "./WorkspaceInspectorAccountScopePanel.vue";
import WorkspaceInspectorCharacterBindingPanel from "./WorkspaceInspectorCharacterBindingPanel.vue";
import WorkspaceInspectorSection from "./WorkspaceInspectorSection.vue";
import WorkspaceInspectorUserBindingPanel from "./WorkspaceInspectorUserBindingPanel.vue";
import WorkspaceInspectorVariablesPanel from "./WorkspaceInspectorVariablesPanel.vue";
import WorkspaceInspectorWorldbookBindingPanel from "./WorkspaceInspectorWorldbookBindingPanel.vue";
import type { TimelineMessage } from "../../../stores/workspace";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  bindingFlash: boolean;
  currentAccount: string;
  runtimeCharacterName: string;
  activeSessionId: string | null;
  activeTimeline: TimelineMessage[];
  runtimeUserName: string;
  t: Translator;
}>();

const emit = defineEmits<{
  applyUserAsset: [];
  attachWorldbook: [];
  replaceUser: [];
}>();
</script>

<template>
  <div class="space-y-6">
    <WorkspaceInspectorVariablesPanel
      :active-session-id="props.activeSessionId"
      :active-timeline="props.activeTimeline"
      :current-account="props.currentAccount"
      :t="props.t"
    />

    <WorkspaceInspectorSection :title="props.t('inspector.bindingState')">
      <div class="space-y-2 rounded border border-white/5 bg-[#121215] p-3" :class="props.bindingFlash ? 'flash' : ''">
        <WorkspaceInspectorAccountScopePanel :current-account="props.currentAccount" :t="props.t" />

        <WorkspaceInspectorUserBindingPanel
          :runtime-user-name="props.runtimeUserName"
          :t="props.t"
          @apply-user-asset="emit('applyUserAsset')"
          @replace-user="emit('replaceUser')"
        />

        <WorkspaceInspectorCharacterBindingPanel
          :runtime-character-name="props.runtimeCharacterName"
          :t="props.t"
        />

        <WorkspaceInspectorWorldbookBindingPanel :t="props.t" @attach-worldbook="emit('attachWorldbook')" />
      </div>
    </WorkspaceInspectorSection>
  </div>
</template>

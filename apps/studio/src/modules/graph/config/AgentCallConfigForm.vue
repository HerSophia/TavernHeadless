<script setup lang="ts">
import type { NodeGraphPolicies } from "@tavern/core/node-graph";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import {
  AGENT_CALL_DELIVERY_TARGETS,
  AGENT_CALL_MEDIUM_KINDS,
  AGENT_CALL_PURPOSES,
  AGENT_CALL_RETENTION_POLICIES,
  AGENT_CALL_VISIBILITIES,
  isAgentCallPersistentDeliveryTarget,
  readAgentCallConfigFormState,
  writeAgentCallConfigFormState,
  type AgentCallConfigFormState,
} from "./agent-call-config";

const props = defineProps<{
  config?: unknown;
  policies?: NodeGraphPolicies | null;
}>();

const emit = defineEmits<{
  (event: "update:config", config: Record<string, unknown>): void;
}>();

const { t } = useI18n();

const state = computed(() => readAgentCallConfigFormState(props.config));

const mediumOptions = AGENT_CALL_MEDIUM_KINDS;
const deliveryTargetOptions = AGENT_CALL_DELIVERY_TARGETS;
const purposeOptions = AGENT_CALL_PURPOSES;
const visibilityOptions = AGENT_CALL_VISIBILITIES;
const retentionPolicyOptions = AGENT_CALL_RETENTION_POLICIES;

const showTemporaryConversationFields = computed(() => state.value.mediumKind === "temporary_conversation");
const showBackgroundJobFields = computed(() => state.value.mediumKind === "background_job");
const showPageStagedWriteFields = computed(() => state.value.deliveryTarget === "page_staged_write");
const showDerivedOutputFields = computed(() => state.value.deliveryTarget === "derived_output");
const showProjectInboxFields = computed(() => state.value.deliveryTarget === "project_inbox");
const showSessionStateProposalFields = computed(() => state.value.deliveryTarget === "session_state_proposal");
const showPromptRuntimeInjectionFields = computed(() => state.value.deliveryTarget === "prompt_runtime_injection");
const showBackgroundPolicyWarning = computed(
  () => state.value.mediumKind === "background_job" && props.policies?.allowBackgroundJobs !== true,
);
const showPersistentOutputPolicyWarning = computed(
  () => isAgentCallPersistentDeliveryTarget(state.value.deliveryTarget) && props.policies?.allowPersistentOutputs !== true,
);

function patch(next: Partial<AgentCallConfigFormState>): void {
  emit("update:config", writeAgentCallConfigFormState(props.config, { ...state.value, ...next }));
}

function selectValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}
</script>

<template>
  <div class="space-y-3 rounded-md border border-line-subtle bg-float/50 p-2">
    <div class="grid grid-cols-2 gap-2">
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.medium") }}</span>
        <select
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.mediumKind"
          @change="(event) => patch({ mediumKind: selectValue(event) as AgentCallConfigFormState['mediumKind'] })"
        >
          <option v-for="kind in mediumOptions" :key="kind" :value="kind">
            {{ t(`graph.agentCallConfig.mediumKind.${kind}`) }}
          </option>
        </select>
      </label>

      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.deliveryTarget") }}</span>
        <select
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.deliveryTarget"
          @change="(event) => patch({ deliveryTarget: selectValue(event) as AgentCallConfigFormState['deliveryTarget'] })"
        >
          <option v-for="target in deliveryTargetOptions" :key="target" :value="target">
            {{ t(`graph.agentCallConfig.deliveryTargetValue.${target}`) }}
          </option>
        </select>
      </label>
    </div>

    <div v-if="showTemporaryConversationFields" class="grid grid-cols-1 gap-2">
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.purpose") }}</span>
        <select
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.purpose"
          @change="(event) => patch({ purpose: selectValue(event) as AgentCallConfigFormState['purpose'] })"
        >
          <option value="">{{ t("graph.agentCallConfig.keepDefault") }}</option>
          <option v-for="purpose in purposeOptions" :key="purpose" :value="purpose">
            {{ t(`graph.agentCallConfig.purposeValue.${purpose}`) }}
          </option>
        </select>
      </label>

      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.visibility") }}</span>
          <select
            class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="state.visibility"
            @change="(event) => patch({ visibility: selectValue(event) as AgentCallConfigFormState['visibility'] })"
          >
            <option value="">{{ t("graph.agentCallConfig.keepDefault") }}</option>
            <option v-for="visibility in visibilityOptions" :key="visibility" :value="visibility">
              {{ t(`graph.agentCallConfig.visibilityValue.${visibility}`) }}
            </option>
          </select>
        </label>

        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.retentionPolicy") }}</span>
          <select
            class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="state.retentionPolicy"
            @change="(event) => patch({ retentionPolicy: selectValue(event) as AgentCallConfigFormState['retentionPolicy'] })"
          >
            <option value="">{{ t("graph.agentCallConfig.keepDefault") }}</option>
            <option v-for="policy in retentionPolicyOptions" :key="policy" :value="policy">
              {{ t(`graph.agentCallConfig.retentionPolicyValue.${policy}`) }}
            </option>
          </select>
        </label>
      </div>
    </div>

    <div v-if="showBackgroundJobFields" class="space-y-2">
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.agentBindingId") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.agentBindingId"
          @change="(event) => patch({ agentBindingId: inputValue(event) })"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.triggerReason") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.triggerReason"
          :placeholder="'node_graph.agent_call'"
          @change="(event) => patch({ triggerReason: inputValue(event) })"
        />
      </label>
    </div>

    <div v-if="showPageStagedWriteFields" class="space-y-2">
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.targetPageId") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.targetPageId"
          @change="(event) => patch({ targetPageId: inputValue(event) })"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.sourceOutputPageId") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.sourceOutputPageId"
          @change="(event) => patch({ sourceOutputPageId: inputValue(event) })"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.reason") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.reason"
          @change="(event) => patch({ reason: inputValue(event) })"
        />
      </label>
    </div>

    <div v-if="showDerivedOutputFields" class="grid grid-cols-2 gap-2">
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.projectId") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.derivedOutputProjectId"
          @change="(event) => patch({ derivedOutputProjectId: inputValue(event) })"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.domain") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.derivedOutputDomain"
          @change="(event) => patch({ derivedOutputDomain: inputValue(event) })"
        />
      </label>
    </div>

    <div v-if="showProjectInboxFields" class="space-y-2">
      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.projectId") }}</span>
          <input
            class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="state.projectInboxProjectId"
            @change="(event) => patch({ projectInboxProjectId: inputValue(event) })"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.inboxType") }}</span>
          <input
            class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="state.projectInboxType"
            @change="(event) => patch({ projectInboxType: inputValue(event) })"
          />
        </label>
      </div>
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.titleField") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.projectInboxTitle"
          @change="(event) => patch({ projectInboxTitle: inputValue(event) })"
        />
      </label>
    </div>

    <div v-if="showSessionStateProposalFields" class="space-y-2">
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.sessionId") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.sessionStateProposalSessionId"
          @change="(event) => patch({ sessionStateProposalSessionId: inputValue(event) })"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.summary") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.sessionStateProposalSummary"
          @change="(event) => patch({ sessionStateProposalSummary: inputValue(event) })"
        />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.namespace") }}</span>
          <input
            class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="state.sessionStateProposalNamespace"
            @change="(event) => patch({ sessionStateProposalNamespace: inputValue(event) })"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.slot") }}</span>
          <input
            class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="state.sessionStateProposalSlot"
            @change="(event) => patch({ sessionStateProposalSlot: inputValue(event) })"
          />
        </label>
      </div>
    </div>

    <div v-if="showPromptRuntimeInjectionFields" class="space-y-2">
      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.targetSessionId") }}</span>
          <input
            class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="state.promptRuntimeInjectionTargetSessionId"
            @change="(event) => patch({ promptRuntimeInjectionTargetSessionId: inputValue(event) })"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.targetBranchId") }}</span>
          <input
            class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="state.promptRuntimeInjectionTargetBranchId"
            @change="(event) => patch({ promptRuntimeInjectionTargetBranchId: inputValue(event) })"
          />
        </label>
      </div>
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.titleField") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.promptRuntimeInjectionTitle"
          @change="(event) => patch({ promptRuntimeInjectionTitle: inputValue(event) })"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.placement") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.promptRuntimeInjectionPlacement"
          @change="(event) => patch({ promptRuntimeInjectionPlacement: inputValue(event) })"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.agentCallConfig.content") }}</span>
        <textarea
          rows="4"
          class="w-full resize-y rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs leading-relaxed text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="state.promptRuntimeInjectionContent"
          @change="(event) => patch({ promptRuntimeInjectionContent: inputValue(event) })"
        />
      </label>
    </div>

    <div class="space-y-1 text-[10px] leading-relaxed">
      <p v-if="showBackgroundPolicyWarning" class="text-signal-warn">
        {{ t("graph.agentCallConfig.backgroundPolicyHint") }}
      </p>
      <p v-if="showPersistentOutputPolicyWarning" class="text-signal-warn">
        {{ t("graph.agentCallConfig.persistentOutputPolicyHint") }}
      </p>
      <p class="text-text-muted">{{ t("graph.agentCallConfig.unknownFieldsHint") }}</p>
    </div>
  </div>
</template>

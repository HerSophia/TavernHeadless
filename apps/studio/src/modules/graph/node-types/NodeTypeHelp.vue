<script setup lang="ts">
import type { NodeGraphNodeTypeKnowledgeDetail } from "@tavern/core/node-graph";
import { BookOpen } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

import UiButton from "../../../ui/UiButton.vue";
import NodeTypeDetail from "./NodeTypeDetail.vue";

const props = defineProps<{
  detail?: NodeGraphNodeTypeKnowledgeDetail | null;
  unknownType?: string | null;
}>();

const emit = defineEmits<{
  (event: "open-detail"): void;
}>();

const { t } = useI18n();
</script>

<template>
  <section class="rounded-md border border-line-subtle bg-float/50 px-2.5 py-2">
    <div class="mb-2 flex items-center gap-2">
      <BookOpen :size="13" :stroke-width="1.5" class="text-text-muted" />
      <span class="text-[11px] font-medium text-text-secondary">{{ t("graph.nodeType.nodeHelp") }}</span>
      <UiButton
        v-if="props.detail"
        variant="ghost"
        class="ml-auto !h-6 !px-1.5 text-[10px]"
        @click="emit('open-detail')"
      >
        {{ t("graph.nodeType.openDetail") }}
      </UiButton>
    </div>
    <NodeTypeDetail :detail="props.detail" :unknown-type="props.unknownType" compact />
  </section>
</template>

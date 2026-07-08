<script setup lang="ts">
/**
 * 会话二次确认对话框（SC1-2 → SC2-1）。
 *
 * 现为通用 `UiConfirmDialog` 的薄封装：对外 props / events 完全保持不变
 * （open / title / message / confirmLabel / cancelLabel / busy + confirm / cancel），
 * 以免 `SessionListPanel.vue` 回归。破坏性删除固定 danger 基调。
 */
import UiConfirmDialog from "../../../ui/UiConfirmDialog.vue";

defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <UiConfirmDialog
    :open="open"
    :title="title"
    :message="message"
    :confirm-label="confirmLabel"
    :cancel-label="cancelLabel"
    :busy="busy"
    tone="danger"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
  />
</template>

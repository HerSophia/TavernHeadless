<script setup lang="ts">
/**
 * 下拉菜单里的单个可点表项：图标槽 + 主文案（可选副文案）。
 * 统一 hover / disabled / focus 表现，供工具菜单、导入菜单等复用。
 */
withDefaults(
  defineProps<{
    label: string;
    hint?: string;
    disabled?: boolean;
    /** 危险操作（如删除）用信号错误色标记。 */
    danger?: boolean;
  }>(),
  { hint: undefined, disabled: false, danger: false },
);
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
   class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150 focus:outline-none focus-visible:bg-float disabled:cursor-not-allowed disabled:opacity-40"
    :class="danger
      ? 'text-signal-error hover:bg-signal-error/10'
      : 'text-text-secondary hover:bg-float hover:text-text-primary'"
  >
    <span class="flex size-4 shrink-0 items-center justify-center">
      <slot name="icon" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate">{{ label }}</span>
      <span v-if="hint" class="mt-0.5 block truncate text-[10px] text-text-muted">{{ hint }}</span>
    </span>
  </button>
</template>

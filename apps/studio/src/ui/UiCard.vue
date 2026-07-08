<script setup lang="ts">
/**
 * 通用卡片表面（SC2-1）。
 *
 * 只提供「表面 + 槽位 + 选中 / 悬停态」，不含资产语义。
 * Slots：#media（左侧固定尺寸媒体区）、默认（内容）、#actions（右侧悬停操作）。
 * `clickable` 时整卡可点击（键盘可达），`selected` 高亮。文案与内容由消费方注入。
 */
const props = withDefaults(
  defineProps<{
    selected?: boolean;
    clickable?: boolean;
    disabled?: boolean;
  }>(),
  { selected: false, clickable: false, disabled: false },
);

const emit = defineEmits<{ click: [] }>();

function trigger(): void {
  if (props.clickable && !props.disabled) {
    emit("click");
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.clickable || props.disabled) {
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    emit("click");
  }
}
</script>

<template>
  <div
    class="group relative flex gap-3 rounded-md border bg-panel p-3 transition-colors duration-150"
    :class="[
      selected ? 'border-line-active bg-float/40' : 'border-line-subtle',
      clickable && !disabled ? 'cursor-pointer hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent' : '',
      disabled ? 'cursor-not-allowed opacity-50' : '',
    ]"
    :role="clickable ? 'button' : undefined"
    :tabindex="clickable && !disabled ? 0 : undefined"
    :aria-disabled="disabled || undefined"
    @click="trigger"
    @keydown="onKeydown"
  >
    <div v-if="$slots.media" class="shrink-0">
      <slot name="media" />
    </div>

    <div class="min-w-0 flex-1">
      <slot />
    </div>

    <div
      v-if="$slots.actions"
      class="shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100"
      @click.stop
    >
      <slot name="actions" />
    </div>
  </div>
</template>

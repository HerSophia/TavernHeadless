<script setup lang="ts">
/**
 * 通用文本输入（SC2-1）。
 *
 * 统一输入外观（对齐 UiCombobox 的 input），供搜索框与后续编辑器表单复用。
 * 支持前 / 后置插槽（图标或按钮）、错误态红边、回车提交。不承载业务文案，
 * placeholder / ariaLabel 由消费方传入。
 */
import { computed, useSlots } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    disabled?: boolean;
    type?: "text" | "search";
    size?: "sm" | "md";
    invalid?: boolean;
    ariaLabel?: string;
  }>(),
  { type: "text", size: "md", disabled: false, invalid: false, placeholder: undefined, ariaLabel: undefined },
);

const emit = defineEmits<{ "update:modelValue": [value: string]; enter: [] }>();

const slots = useSlots();
const hasPrefix = computed(() => Boolean(slots.prefix));
const hasSuffix = computed(() => Boolean(slots.suffix));

/** 用显式 pl-/pr- 计算左右内边距，避免与前后置插槽的 pl-8 / pr-8 冲突。 */
const paddingClass = computed(() => {
  const left = hasPrefix.value ? "pl-8" : props.size === "sm" ? "pl-2" : "pl-2.5";
  const right = hasSuffix.value ? "pr-8" : props.size === "sm" ? "pr-2" : "pr-2.5";
  const vertical = props.size === "sm" ? "py-1" : "py-1.5";
  const text = props.size === "sm" ? "text-xs" : "text-sm";
  return `${left} ${right} ${vertical} ${text}`;
});

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="relative">
    <span
      v-if="$slots.prefix"
      class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-text-muted"
    >
      <slot name="prefix" />
    </span>

    <input
      :value="modelValue"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-invalid="invalid || undefined"
      spellcheck="false"
      class="w-full rounded-md border bg-float text-text-primary transition-colors duration-150 placeholder:text-text-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent disabled:cursor-not-allowed disabled:opacity-50"
      :class="[
        paddingClass,
        invalid ? 'border-signal-error' : 'border-line-subtle hover:border-line-active',
      ]"
      @input="onInput"
      @keydown.enter="emit('enter')"
    />

    <span v-if="$slots.suffix" class="absolute inset-y-0 right-0 flex items-center pr-1.5">
      <slot name="suffix" />
    </span>
  </div>
</template>

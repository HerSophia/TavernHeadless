<script setup lang="ts">
/**
 * 搜索输入（SC2-1）。
 *
 * 基于 UiTextInput 组合：前置放大镜、有内容时显示清除按钮、可选防抖发射。
 * 受控-非受控边界：内部保留 displayValue 即时更新，外部 modelValue 变化时同步，
 * 避免防抖窗口内抖动。文案由消费方注入。
 */
import { Search, X } from "lucide-vue-next";
import { onBeforeUnmount, ref, watch } from "vue";

import { createDebounced } from "./debounce";
import UiTextInput from "./UiTextInput.vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    disabled?: boolean;
    /** 防抖毫秒；0（默认）为不防抖，即时发射。 */
    debounceMs?: number;
    ariaLabel?: string;
  }>(),
  { debounceMs: 0, disabled: false, placeholder: undefined, ariaLabel: undefined },
);

const emit = defineEmits<{ "update:modelValue": [value: string]; clear: [] }>();

/** 内部即时显示值：输入立即反映，向外发射按防抖节流。 */
const displayValue = ref(props.modelValue);

watch(
  () => props.modelValue,
  (value) => {
    if (value !== displayValue.value) {
      displayValue.value = value;
    }
  },
);

const debounced = createDebounced((value: string) => emit("update:modelValue", value), props.debounceMs);

function onUpdate(value: string): void {
  displayValue.value = value;
  debounced.call(value);
}

function onClear(): void {
  debounced.cancel();
  displayValue.value = "";
  emit("update:modelValue", "");
  emit("clear");
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      debounced.cancel();
    }
  },
);

onBeforeUnmount(() => {
  debounced.cancel();
});
</script>

<template>
  <UiTextInput
    :model-value="displayValue"
    type="search"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-label="ariaLabel"
    @update:model-value="onUpdate"
  >
    <template #prefix>
      <Search :size="14" :stroke-width="1.5" />
    </template>
    <template #suffix>
      <button
        v-if="displayValue"
        type="button"
        :aria-label="ariaLabel"
        :disabled="disabled"
        class="flex size-6 items-center justify-center rounded text-text-muted transition-colors duration-150 hover:text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent disabled:cursor-not-allowed disabled:opacity-50"
        @click="onClear"
      >
        <X :size="13" :stroke-width="1.5" />
      </button>
    </template>
  </UiTextInput>
</template>

<script setup lang="ts">
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport
} from "radix-vue";
import { Check, ChevronDown } from "lucide-vue-next";

type UiSelectOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    modelValue: string;
    options: readonly UiSelectOption[];
    placeholder?: string;
  }>(),
  {
    disabled: false,
    placeholder: ""
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

function handleValueChange(value: string): void {
  emit("update:modelValue", value);
}
</script>

<template>
  <SelectRoot
    :disabled="props.disabled"
    :model-value="props.modelValue"
    @update:model-value="handleValueChange"
  >
    <SelectTrigger class="ui-select-trigger">
      <SelectValue :placeholder="props.placeholder" />
      <SelectIcon class="ui-select-icon">
        <ChevronDown class="h-3.5 w-3.5" />
      </SelectIcon>
    </SelectTrigger>

    <SelectPortal>
      <SelectContent class="ui-select-content" position="popper" :side-offset="6" align="start">
        <SelectViewport class="ui-select-viewport">
          <SelectItem
            v-for="option in props.options"
            :key="option.value"
            class="ui-select-item"
            :disabled="option.disabled"
            :value="option.value"
          >
            <SelectItemText>{{ option.label }}</SelectItemText>
            <SelectItemIndicator class="ui-select-indicator">
              <Check class="h-3.5 w-3.5" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style>
.ui-select-trigger {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.35rem;
  background: rgba(255, 255, 255, 0.04);
  color: rgb(228 228 231);
  font-size: 12px;
  line-height: 1.2;
  padding: 0.3rem 0.45rem;
  text-align: left;
  transition: border-color 120ms ease, background-color 120ms ease;
}

.ui-select-trigger[data-placeholder] {
  color: rgb(161 161 170);
}

.ui-select-trigger > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-select-trigger[data-disabled] {
  opacity: 0.55;
  cursor: not-allowed;
}

.ui-select-trigger:focus-visible {
  outline: none;
  border-color: rgba(45, 212, 191, 0.48);
  background: rgba(45, 212, 191, 0.06);
}

.ui-select-icon {
  color: rgb(113 113 122);
}

.ui-select-content {
  z-index: 140;
  min-width: var(--radix-select-trigger-width);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.4rem;
  background: rgba(12, 12, 14, 0.98);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.ui-select-viewport {
  max-height: 14rem;
  padding: 0.2rem;
}

.ui-select-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
  border-radius: 0.3rem;
  color: rgb(212 212 216);
  font-size: 12px;
  line-height: 1.2;
  padding: 0.35rem 0.45rem;
  user-select: none;
}

.ui-select-item[data-highlighted] {
  outline: none;
  background: rgba(45, 212, 191, 0.12);
  color: rgb(240 253 250);
}

.ui-select-item[data-state="checked"] {
  color: rgb(167 243 208);
}

.ui-select-item[data-disabled] {
  opacity: 0.45;
  pointer-events: none;
}

.ui-select-indicator {
  display: inline-flex;
  color: rgba(45, 212, 191, 0.92);
}
</style>

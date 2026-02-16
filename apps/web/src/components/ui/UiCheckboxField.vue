<script setup lang="ts">
import { Check } from "lucide-vue-next";
import { CheckboxIndicator, CheckboxRoot } from "radix-vue";

const props = withDefaults(
  defineProps<{
    checked: boolean;
    disabled?: boolean;
  }>(),
  {
    disabled: false
  }
);

const emit = defineEmits<{
  "update:checked": [value: boolean];
}>();

function handleCheckedChange(next: boolean | "indeterminate"): void {
  emit("update:checked", next === true);
}
</script>

<template>
  <label class="ui-checkbox-field">
    <CheckboxRoot
      class="ui-checkbox-root"
      :checked="props.checked"
      :disabled="props.disabled"
      @update:checked="handleCheckedChange"
    >
      <CheckboxIndicator class="ui-checkbox-indicator">
        <Check class="h-3 w-3" />
      </CheckboxIndicator>
    </CheckboxRoot>
    <span class="ui-checkbox-label">
      <slot />
    </span>
  </label>
</template>

<style scoped>
.ui-checkbox-field {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.ui-checkbox-root {
  width: 0.85rem;
  height: 0.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 0.2rem;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(45, 212, 191, 0.9);
  transition: border-color 120ms ease, background-color 120ms ease;
}

.ui-checkbox-root[data-state="checked"] {
  border-color: rgba(45, 212, 191, 0.58);
  background: rgba(45, 212, 191, 0.14);
}

.ui-checkbox-root[data-disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}

.ui-checkbox-root:focus-visible {
  outline: none;
  border-color: rgba(45, 212, 191, 0.72);
}

.ui-checkbox-indicator {
  display: inline-flex;
}

.ui-checkbox-label {
  font-size: 0.75rem;
  color: rgb(161 161 170);
}
</style>

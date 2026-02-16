<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  inputClass?: string;
  modelValue?: number | string;
  value?: number | string;
}>(), {
  inputClass: "",
  modelValue: undefined,
  value: ""
});

const emit = defineEmits<{
  input: [event: Event];
  "update:modelValue": [value: string];
}>();

const inputValue = computed(() => props.modelValue ?? props.value ?? "");

function handleInput(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  emit("update:modelValue", target.value);
  emit("input", event);
}
</script>

<template>
  <input
    :class="['dialog-input', props.inputClass]"
    :value="inputValue"
    @input="handleInput"
  >
</template>

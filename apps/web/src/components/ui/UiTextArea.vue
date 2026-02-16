<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  modelValue?: string;
  textareaClass?: string;
  value?: string;
}>(), {
  modelValue: undefined,
  textareaClass: "",
  value: ""
});

const emit = defineEmits<{
  input: [event: Event];
  "update:modelValue": [value: string];
}>();

const textareaValue = computed(() => props.modelValue ?? props.value ?? "");

function handleInput(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }

  emit("update:modelValue", target.value);
  emit("input", event);
}
</script>

<template>
  <textarea
    :class="['dialog-textarea', props.textareaClass]"
    :value="textareaValue"
    @input="handleInput"
  />
</template>

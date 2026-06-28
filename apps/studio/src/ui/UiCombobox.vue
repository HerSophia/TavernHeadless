<script setup lang="ts">
/**
 * 可输入下拉框（combobox）：替代原生 <input list> + <datalist>。
 *
 * 既可自由输入任意值，又能从建议列表中选取；建议按当前输入过滤。
 * 用于模型 ID 这类「可手填、也可从发现结果中选」的场景。
 */
import { ChevronDown } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

type ComboOption = { value: string; label: string };

const props = defineProps<{
  modelValue: string;
  options: ComboOption[];
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const root = ref<HTMLElement | null>(null);
const open = ref(false);

/** 按当前输入过滤建议（不区分大小写）；输入为空时显示全部。 */
const filtered = computed(() => {
  const query = props.modelValue.trim().toLowerCase();
  if (!query) {
    return props.options;
  }
  return props.options.filter(
    (option) => option.value.toLowerCase().includes(query) || option.label.toLowerCase().includes(query),
  );
});

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
  open.value = true;
}

function choose(option: ComboOption): void {
  emit("update:modelValue", option.value);
  open.value = false;
}

function onFocus(): void {
  if (props.options.length > 0) {
    open.value = true;
  }
}

function onPointerDown(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) {
    open.value = false;
  }
}

onMounted(() => window.addEventListener("pointerdown", onPointerDown));
onBeforeUnmount(() => window.removeEventListener("pointerdown", onPointerDown));
</script>

<template>
  <div ref="root" class="relative">
    <div class="relative">
      <input
        :value="modelValue"
        :disabled="disabled"
        :placeholder="placeholder"
        spellcheck="false"
        class="w-full rounded-md border border-line-subtle bg-float px-2.5 py-1.5 pr-8 font-mono text-xs text-text-primary transition-colors duration-150 placeholder:text-text-muted hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent disabled:cursor-not-allowed disabled:opacity-50"
        @input="onInput"
        @focus="onFocus"
      />
      <button
        v-if="options.length > 0"
        type="button"
        tabindex="-1"
        class="absolute inset-y-0 right-0 flex items-center px-2 text-text-muted transition-colors duration-150 hover:text-text-secondary"
        @click="open = !open"
      >
        <ChevronDown
          :size="14"
          :stroke-width="1.5"
          class="transition-transform duration-150"
          :class="open ? 'rotate-180' : ''"
        />
      </button>
    </div>

    <div
      v-if="open && filtered.length > 0"
      class="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line-subtle bg-float py-1 shadow-[0_4px_16px_-8px_rgba(0,0,0,0.5)]"
    >
      <button
        v-for="option in filtered"
        :key="option.value"
        type="button"
        class="flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-panel"
        @click="choose(option)"
      >
        <span class="font-mono text-xs text-text-primary">{{ option.value }}</span>
        <span v-if="option.label !== option.value" class="text-[11px] text-text-muted">{{ option.label }}</span>
      </button>
    </div>
  </div>
</template>

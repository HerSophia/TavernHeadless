<script setup lang="ts" generic="T extends string">
/**
 * 自定义下拉选择，替代原生 <select>。
 *
 * 支持键盘操作（上下移动、Enter 选中、Esc 关闭）、点击外部关闭，
 * 配色与间距对齐设计令牌；菜单为克制浮层，不用大阴影。
 */
import { Check, ChevronDown } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

type SelectOption = { value: T; label: string; disabled?: boolean };

const props = defineProps<{
  modelValue: T;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const open = ref(false);
// 键盘高亮项索引（仅菜单展开时有意义）
const activeIndex = ref(-1);
// 菜单是否向上翻转（下方空间不足时，避免在对话框底部被 overflow-hidden 裁剪 / 被 footer 覆盖）
const dropUp = ref(false);
// 菜单最大高（与模板 max-h-60 对齐 = 15rem = 240px），用于翻转方向测算。
const MENU_MAX_HEIGHT = 240;

/** 根据触发器在视口中的位置决定菜单向上还是向下展开。 */
function updateDropDirection(): void {
  const el = trigger.value;
  if (!el || typeof window === "undefined") {
    dropUp.value = false;
    return;
  }
  const rect = el.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  // 下方装不下菜单且上方更宽裕时向上翻转。
  dropUp.value = spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow;
}

const selected = computed(() => props.options.find((option) => option.value === props.modelValue) ?? null);

function openMenu(): void {
  if (props.disabled) {
    return;
  }
  open.value = true;
  activeIndex.value = props.options.findIndex((option) => option.value === props.modelValue);
  void nextTick(updateDropDirection);
}

function closeMenu(): void {
  open.value = false;
  activeIndex.value = -1;
}

function toggle(): void {
  if (open.value) {
    closeMenu();
  } else {
    openMenu();
  }
}

function select(option: SelectOption): void {
  if (option.disabled) {
    return;
  }
  emit("update:modelValue", option.value);
  closeMenu();
}

/** 在可选项间移动高亮，跳过 disabled 项。 */
function moveActive(delta: number): void {
  const count = props.options.length;
  if (count === 0) {
    return;
  }
  let index = activeIndex.value;
  for (let step = 0; step < count; step += 1) {
    index = (index + delta + count) % count;
    if (!props.options[index]?.disabled) {
      break;
    }
  }
  activeIndex.value = index;
}

function onKeydown(event: KeyboardEvent): void {
  if (props.disabled) {
    return;
  }
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (open.value) {
        moveActive(1);
      } else {
        openMenu();
      }
      break;
    case "ArrowUp":
      event.preventDefault();
      if (open.value) {
        moveActive(-1);
      } else {
        openMenu();
      }
      break;
    case "Enter":
    case " ":
      if (open.value) {
        event.preventDefault();
        const option = props.options[activeIndex.value];
        if (option) {
          select(option);
        }
      }
      break;
    case "Escape":
      if (open.value) {
        event.preventDefault();
        closeMenu();
      }
      break;
    default:
      break;
  }
}

function onPointerDown(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) {
    closeMenu();
  }
}

onMounted(() => window.addEventListener("pointerdown", onPointerDown));
onBeforeUnmount(() => window.removeEventListener("pointerdown", onPointerDown));
</script>

<template>
  <div ref="root" class="relative">
    <button
      ref="trigger"
      type="button"
      :disabled="disabled"
      class="flex w-full items-center justify-between gap-2 rounded-md border bg-float px-2.5 py-1.5 text-left text-sm text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent disabled:cursor-not-allowed disabled:opacity-50"
      :class="open ? 'border-line-active' : 'border-line-subtle'"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="truncate" :class="selected ? '' : 'text-text-muted'">
        {{ selected ? selected.label : (placeholder ?? "") }}
      </span>
      <ChevronDown
        :size="14"
        :stroke-width="1.5"
        class="shrink-0 text-text-muted transition-transform duration-150"
        :class="open ? 'rotate-180' : ''"
      />
    </button>

    <div
      v-if="open"
      class="absolute z-30 max-h-60 w-full overflow-auto rounded-md border border-line-subtle bg-float py-1 shadow-[0_4px_16px_-8px_rgba(0,0,0,0.5)]"
      :class="dropUp ? 'bottom-full mb-1' : 'top-full mt-1'"
    >
      <button
        v-for="(option, index) in options"
        :key="String(option.value)"
        type="button"
        :disabled="option.disabled"
        class="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
        :class="[
          option.value === modelValue ? 'text-text-primary' : 'text-text-secondary',
          index === activeIndex ? 'bg-panel' : 'hover:bg-panel',
        ]"
        @click="select(option)"
        @mouseenter="activeIndex = index"
      >
        <span class="truncate">{{ option.label }}</span>
        <Check
          v-if="option.value === modelValue"
          :size="13"
          :stroke-width="1.5"
          class="shrink-0 text-signal-accent"
        />
      </button>
    </div>
  </div>
</template>

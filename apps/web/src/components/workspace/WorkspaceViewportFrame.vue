<script setup lang="ts">
import type { StyleValue } from "vue";

defineProps<{
  paneLayoutStyles: StyleValue;
}>();
</script>

<template>
  <div class="workspace-enter flex h-screen w-screen flex-col overflow-hidden bg-[#050505] text-sm text-zinc-200 selection:bg-signal-accent selection:text-black">
    <header class="border-b-subtle z-20 flex h-12 items-center justify-between bg-[#09090b] px-1.5 sm:px-4">
      <slot name="header" />
    </header>

    <div class="relative flex flex-1 overflow-hidden lg:gap-0" :style="paneLayoutStyles">
      <slot name="backdrop" />
      <slot name="sidebar" />
      <slot name="left-resizer" />
      <slot name="center" />
      <slot name="right-resizer" />
      <slot name="inspector" />
      <slot name="overlays" />
    </div>

    <footer
      v-if="$slots.footer"
      class="border-t-subtle z-20 flex h-8 items-center bg-[#09090b] px-4 text-xs text-zinc-400"
    >
      <slot name="footer" />
    </footer>
  </div>
</template>

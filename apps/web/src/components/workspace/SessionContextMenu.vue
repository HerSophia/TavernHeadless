<script setup lang="ts">
import {
  useSessionContextMenu,
  type SessionContextMenuEmits,
  type SessionContextMenuLogicProps
} from "../../composables/workspace/menus";
import UiContextMenuItem from "../ui/UiContextMenuItem.vue";
import UiContextMenuSeparator from "../ui/UiContextMenuSeparator.vue";
import UiContextMenuShell from "../ui/UiContextMenuShell.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

type SessionContextMenuProps = SessionContextMenuLogicProps & {
  t: Translator;
  visible: boolean;
  x: number;
  y: number;
};

const props = defineProps<SessionContextMenuProps>();
const emit = defineEmits<SessionContextMenuEmits>();

const { menuEntries, triggerAction } = useSessionContextMenu(props, emit);
</script>

<template>
  <UiContextMenuShell :visible="props.visible" :x="props.x" :y="props.y">
    <template v-for="item in menuEntries" :key="item.kind === 'item' ? item.action : item.id">
      <UiContextMenuItem
        v-if="item.kind === 'item'"
        :danger="item.danger"
        :disabled="item.disabled"
        @click="triggerAction(item.action)"
      >
        {{ props.t(item.key) }}
      </UiContextMenuItem>
      <UiContextMenuSeparator v-else />
    </template>
  </UiContextMenuShell>
</template>

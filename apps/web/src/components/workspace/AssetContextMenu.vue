<script setup lang="ts">
import {
  useAssetContextMenu,
  type AssetContextMenuEmits,
  type AssetContextMenuLogicProps
} from "../../composables/workspace/menus";
import UiContextMenuItem from "../ui/UiContextMenuItem.vue";
import UiContextMenuShell from "../ui/UiContextMenuShell.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

type AssetContextMenuProps = AssetContextMenuLogicProps & {
  t: Translator;
  visible: boolean;
  x: number;
  y: number;
};

const props = defineProps<AssetContextMenuProps>();
const emit = defineEmits<AssetContextMenuEmits>();

const { menuEntries, triggerAction } = useAssetContextMenu(props, emit);
</script>

<template>
  <UiContextMenuShell
    data-attribute="data-asset-context-menu"
    :visible="props.visible"
    :x="props.x"
    :y="props.y"
  >
    <UiContextMenuItem
      v-for="item in menuEntries"
      :key="item.action"
      :danger="item.danger"
      @click="triggerAction(item.action)"
    >
      {{ props.t(item.key) }}
    </UiContextMenuItem>
  </UiContextMenuShell>
</template>

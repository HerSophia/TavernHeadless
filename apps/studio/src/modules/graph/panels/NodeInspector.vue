<script setup lang="ts">
import {
  groupSwitchState,
  NODE_GRAPH_PHASES,
  type NodeGraphPhase,
  type NodeGraphPortType,
} from "@tavern/core/node-graph";
import { Boxes, Eye, Play, Plus, Trash2, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import UiButton from "../../../ui/UiButton.vue";
import { useContextStore } from "../../../stores/context";
import { useGraphEditorStore } from "../../../stores/graph-editor";
import { previewPolicyOf, useNodePreview } from "../preview/use-node-preview";
import { deriveGroupBoundaryHandles } from "../subgraph/group-channels";
import {
  PORT_TYPE_OPTIONS,
  addPort,
  readInterface,
  removePort,
  renamePort,
  retypePort,
  writeInterface,
  type PortDirection,
} from "../subgraph/interface-edit";

const { t, te } = useI18n();
const store = useGraphEditorStore();
const ctx = useContextStore();
const { previewing, error: previewError, result: previewResult, runPreview, reset: resetPreview } =
  useNodePreview();

const node = computed(() => store.selectedNode);
const entry = computed(() => store.selectedNodeEntry);
const edge = computed(() => store.selectedEdge);
const group = computed(() => store.selectedGroup);

// —— 节点组（折叠组）：成员、组开关、输出通道列表（快速开关）——
const groupMembers = computed(() => {
  const current = group.value;
  const doc = store.document;
  if (!current || !doc) {
    return [];
  }
  return current.nodeIds
    .map((nodeId) => doc.nodes.find((candidate) => candidate.id === nodeId))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
});
const groupSwitch = computed(() => groupSwitchState(groupMembers.value));
const groupChannels = computed(() => {
  const current = group.value;
  const doc = store.document;
  if (!current || !doc) {
    return [];
  }
  return deriveGroupBoundaryHandles(doc, current).outputs;
});

function onToggleGroupAll(): void {
  if (group.value) {
    store.setGroupEnabled(group.value.id, groupSwitch.value !== "on");
  }
}

function onToggleChannel(channelId: string, enabled: boolean): void {
  if (group.value) {
    store.setGroupChannelEnabled(group.value.id, channelId, enabled);
  }
}

const phaseOptions = computed<NodeGraphPhase[]>(() =>
  entry.value ? entry.value.supportedPhases : [...NODE_GRAPH_PHASES],
);

const policy = computed(() => previewPolicyOf(node.value, entry.value));
const previewSupported = computed(() => !store.isSample && Boolean(store.graphId) && policy.value !== "disabled");

// —— 节点组（group.node）接口 CRUD（仿 Blender Inputs/Outputs 面板）——
const isGroupNode = computed(() => node.value?.type === "group.node");
const groupInterface = computed(() => readInterface(node.value?.config));
const portTypeOptions = PORT_TYPE_OPTIONS;
const portDirections: PortDirection[] = ["inputs", "outputs"];

function commitInterface(next: ReturnType<typeof readInterface>): void {
  if (node.value) {
    store.updateNodeConfig(node.value.id, writeInterface(node.value.config, next));
  }
}

function onAddPort(dir: PortDirection): void {
  commitInterface(addPort(groupInterface.value, dir));
}

function onRemovePort(dir: PortDirection, index: number): void {
  commitInterface(removePort(groupInterface.value, dir, index));
}

function onRenamePort(dir: PortDirection, index: number, event: Event): void {
  commitInterface(renamePort(groupInterface.value, dir, index, (event.target as HTMLInputElement).value));
}

function onRetypePort(dir: PortDirection, index: number, event: Event): void {
  commitInterface(retypePort(groupInterface.value, dir, index, (event.target as HTMLSelectElement).value as NodeGraphPortType));
}

const configText = ref("");
const contentText = ref("");
const configError = ref<string | null>(null);

/** 节点 config 是否含字符串 `content`（提示词正文）字段。 */
const hasContentField = computed(
  () => typeof (node.value?.config as { content?: unknown } | undefined)?.content === "string",
);

/** 从 config 读出字符串 content，非对象或缺省时回退空串。 */
function readContent(config: unknown): string {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as { content?: unknown }).content;
    return typeof value === "string" ? value : "";
  }
  return "";
}
const userInput = ref("");
const confirmDeleteNode = ref(false);
const confirmDeleteEdge = ref(false);

function phaseLabel(phase: string): string {
  const key = `graphNode.phase.${phase}`;
  return te(key) ? t(key) : phase;
}

function nodeTitle(): string {
  if (!node.value) {
    return "";
  }
  const key = `graphNode.type.${node.value.type.replaceAll(".", "_")}`;
  return te(key) ? t(key) : entry.value?.title ?? node.value.name ?? node.value.type;
}

watch(
  () => store.selectedNodeId,
  () => {
    configError.value = null;
    confirmDeleteNode.value = false;
    resetPreview();
    const current = node.value;
    configText.value = current?.config === undefined ? "" : JSON.stringify(current.config, null, 2);
    contentText.value = readContent(current?.config);
  },
  { immediate: true },
);

watch(
  () => store.selectedEdgeId,
  () => {
    confirmDeleteEdge.value = false;
  },
);

function applyConfig(): void {
  if (!node.value) {
    return;
  }
  const text = configText.value.trim();
  if (text.length === 0) {
    store.updateNodeConfig(node.value.id, undefined);
    configError.value = null;
    return;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    store.updateNodeConfig(node.value.id, parsed);
    configError.value = null;
  } catch {
    configError.value = t("graph.inspector.configInvalid");
  }
}

/** 内容编辑器：把多行正文写回 config.content，并同步刷新原始 JSON 文本。 */
function applyContent(): void {
  if (!node.value) {
    return;
  }
  const base = node.value.config;
  const config =
    base && typeof base === "object" && !Array.isArray(base)
      ? { ...(base as Record<string, unknown>) }
      : {};
  const text = contentText.value;
  if (text.length === 0) {
    delete config.content;
  } else {
    config.content = text;
  }
  const next = Object.keys(config).length > 0 ? config : undefined;
  store.updateNodeConfig(node.value.id, next);
  configText.value = next === undefined ? "" : JSON.stringify(next, null, 2);
  configError.value = null;
}

function onNameInput(event: Event): void {
  if (node.value) {
    store.updateNode(node.value.id, { name: (event.target as HTMLInputElement).value || undefined });
  }
}

function onPhaseChange(event: Event): void {
  if (node.value) {
    store.updateNode(node.value.id, { phase: (event.target as HTMLSelectElement).value as NodeGraphPhase });
  }
}

function onEnabledChange(event: Event): void {
  if (node.value) {
    store.updateNode(node.value.id, { enabled: (event.target as HTMLInputElement).checked });
  }
}

function deleteSelectedNode(): void {
  if (!node.value) {
    return;
  }
  if (!confirmDeleteNode.value) {
    confirmDeleteNode.value = true;
    return;
  }
  store.removeNode(node.value.id);
  confirmDeleteNode.value = false;
}

function deleteSelectedEdge(): void {
  if (!edge.value) {
    return;
  }
  if (!confirmDeleteEdge.value) {
    confirmDeleteEdge.value = true;
    return;
  }
  store.removeEdge(edge.value.id);
  confirmDeleteEdge.value = false;
}

function doPreview(): void {
  const current = node.value;
  const projectId = ctx.currentProjectId;
  if (!current || !projectId || !store.graphId) {
    return;
  }
  void runPreview({
    projectId,
    graphId: store.graphId,
    versionId: store.serverCurrentVersionId,
    node: current,
    userInput: userInput.value || undefined,
  });
}

const previewValueText = computed(() => {
  const result = previewResult.value;
  if (!result) {
    return "";
  }
  if (result.preview?.value !== undefined) {
    return typeof result.preview.value === "string"
      ? result.preview.value
      : JSON.stringify(result.preview.value, null, 2);
  }
  if (result.value !== undefined) {
    return typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2);
  }
  return "";
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line-subtle px-3 text-xs">
      <span class="font-medium text-text-secondary">{{ t("graph.inspector.title") }}</span>
      <button
        v-if="node || edge || group"
        type="button"
        class="ml-auto inline-flex size-6 items-center justify-center rounded text-text-muted transition-colors duration-150 hover:bg-float hover:text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
        :aria-label="t('graph.inspector.deselect')"
        :title="t('graph.inspector.deselect')"
        @click="store.clearSelection()"
      >
        <X :size="13" :stroke-width="1.5" />
      </button>
    </header>

    <!-- Node inspector -->
    <div v-if="node" class="min-h-0 flex-1 overflow-auto">
      <div class="border-b border-line-subtle px-3 py-2.5">
        <div class="text-sm font-medium text-text-primary">{{ nodeTitle() }}</div>
        <div class="mt-0.5 font-mono text-[10px] text-text-muted">
          {{ node.type }}@{{ node.typeVersion }} · {{ node.id }}
        </div>
      </div>

      <div class="space-y-3 px-3 py-3">
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.inspector.name") }}</span>
          <input
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="node.name ?? ''"
            :placeholder="nodeTitle()"
            @change="onNameInput"
          />
        </label>

        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.inspector.phase") }}</span>
          <select
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="node.phase"
            @change="onPhaseChange"
          >
            <option v-for="phase in phaseOptions" :key="phase" :value="phase">
              {{ phaseLabel(phase) }}
            </option>
          </select>
        </label>

        <label class="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            class="size-3.5 accent-signal-accent"
            :checked="node.enabled !== false"
            @change="onEnabledChange"
          />
          {{ t("graph.inspector.enabled") }}
        </label>

        <div v-if="hasContentField">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.inspector.content") }}</span>
          <textarea
            v-model="contentText"
            rows="6"
            spellcheck="false"
            class="w-full resize-y whitespace-pre-wrap rounded-md border border-line-subtle bg-float px-2 py-1 text-xs leading-relaxed text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            @blur="applyContent"
          />
          <p class="mt-1 text-[10px] text-text-muted">{{ t("graph.inspector.contentHint") }}</p>
        </div>

        <div>
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.inspector.config") }}</span>
          <textarea
            v-model="configText"
            rows="6"
            spellcheck="false"
            class="w-full resize-y rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-[11px] leading-relaxed text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :placeholder="'{ }'"
            @blur="applyConfig"
          />
          <div class="mt-1 flex items-center gap-2">
            <UiButton variant="ghost" class="!h-7 !px-2 text-xs" @click="applyConfig">
              {{ t("graph.inspector.applyConfig") }}
            </UiButton>
            <span v-if="configError" class="text-[11px] text-signal-error">{{ configError }}</span>
          </div>
        </div>
      </div>

      <!-- Node group interface（仿 Blender Inputs/Outputs CRUD）-->
      <div v-if="isGroupNode" class="space-y-3 border-t border-line-subtle px-3 py-3">
        <div class="text-[11px] font-medium text-text-secondary">{{ t("graph.interface.title") }}</div>
        <div v-for="dir in portDirections" :key="dir" class="space-y-1.5">
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-text-muted">
              {{ dir === "inputs" ? t("graph.interface.inputs") : t("graph.interface.outputs") }}
            </span>
            <button
              type="button"
              class="ml-auto inline-flex size-5 items-center justify-center rounded border border-line-subtle text-text-muted transition-colors duration-150 hover:border-line-active hover:text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              :aria-label="t('graph.interface.add')"
              :title="t('graph.interface.add')"
              @click="onAddPort(dir)"
            >
              <Plus :size="12" :stroke-width="1.5" />
            </button>
          </div>
          <p v-if="groupInterface[dir].length === 0" class="text-[10px] text-text-muted">
            {{ t("graph.interface.empty") }}
          </p>
          <div
            v-for="(port, index) in groupInterface[dir]"
            :key="`${dir}-${index}`"
            class="flex items-center gap-1.5"
          >
            <input
              class="min-w-0 flex-1 rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              :value="port.name"
              @change="(event) => onRenamePort(dir, index, event)"
            />
            <select
              class="shrink-0 rounded-md border border-line-subtle bg-float px-1.5 py-1 font-mono text-[10px] text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              :value="port.type"
              @change="(event) => onRetypePort(dir, index, event)"
            >
              <option v-for="ty in portTypeOptions" :key="ty" :value="ty">{{ ty }}</option>
            </select>
            <button
              type="button"
              class="inline-flex size-6 shrink-0 items-center justify-center rounded text-text-muted transition-colors duration-150 hover:bg-float hover:text-signal-error focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              :aria-label="t('graph.interface.remove')"
              :title="t('graph.interface.remove')"
              @click="onRemovePort(dir, index)"
            >
              <X :size="12" :stroke-width="1.5" />
            </button>
          </div>
        </div>
      </div>

      <!-- Preview -->
      <div class="border-t border-line-subtle px-3 py-3">
        <div class="mb-2 flex items-center gap-2">
          <Eye :size="13" :stroke-width="1.5" class="text-text-muted" />
          <span class="text-[11px] text-text-muted">{{ t("graph.inspector.preview") }}</span>
          <span class="ml-auto rounded border border-line-subtle px-1 font-mono text-[10px] text-text-secondary">
            {{ policy }}
          </span>
        </div>

        <p v-if="store.isSample || !store.graphId" class="text-[11px] leading-relaxed text-text-muted">
          {{ t("graph.inspector.previewUnavailable") }}
        </p>
        <template v-else-if="policy === 'disabled'">
          <p class="text-[11px] leading-relaxed text-text-muted">{{ t("graph.inspector.previewDisabled") }}</p>
        </template>
        <template v-else>
          <input
            v-model="userInput"
            class="mb-2 w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :placeholder="t('graph.inspector.previewInput')"
          />
          <UiButton class="!h-7 !px-2 text-xs" :disabled="previewing" @click="doPreview">
            <Play :size="12" :stroke-width="1.5" />
            {{ previewing ? t("graph.inspector.previewing") : t("graph.inspector.runPreview") }}
          </UiButton>
          <p v-if="store.dirty" class="mt-2 text-[11px] leading-relaxed text-signal-warn">
            {{ t("graph.inspector.previewStale") }}
          </p>

          <p v-if="previewError" class="mt-2 text-[11px] leading-relaxed text-signal-error">{{ previewError }}</p>

          <div v-if="previewResult" class="mt-2 space-y-1.5">
            <div class="flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-muted">
              <span v-if="previewResult.preview?.kind" class="rounded border border-line-subtle px-1">{{ previewResult.preview.kind }}</span>
              <span v-if="previewResult.preview?.source" class="rounded border border-line-subtle px-1">{{ previewResult.preview.source }}</span>
              <span v-if="previewResult.preview?.tokenEstimate !== undefined">~{{ previewResult.preview.tokenEstimate }} tok</span>
              <span v-if="previewResult.preview?.stale" class="text-signal-warn">stale</span>
            </div>
            <p v-if="previewResult.preview?.summary" class="text-[11px] leading-relaxed text-text-secondary">
              {{ previewResult.preview.summary }}
            </p>
            <pre
              v-if="previewValueText"
              class="max-h-48 overflow-auto rounded-md border border-line-subtle bg-app px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text-secondary"
            >{{ previewValueText }}</pre>
          </div>
        </template>
      </div>

      <!-- Delete -->
      <div class="border-t border-line-subtle px-3 py-3">
        <UiButton
          variant="ghost"
          class="!h-7 !px-2 text-xs"
          :class="confirmDeleteNode ? 'text-signal-error' : 'text-text-secondary'"
          @click="deleteSelectedNode"
        >
          <Trash2 :size="12" :stroke-width="1.5" />
          {{ confirmDeleteNode ? t("graph.inspector.confirmDelete") : t("graph.inspector.deleteNode") }}
        </UiButton>
      </div>
    </div>

    <!-- Edge inspector -->
    <div v-else-if="edge" class="min-h-0 flex-1 overflow-auto">
      <div class="border-b border-line-subtle px-3 py-2.5">
        <div class="text-sm font-medium text-text-primary">{{ t("graph.inspector.edge") }}</div>
        <div class="mt-0.5 font-mono text-[10px] text-text-muted">{{ edge.id }}</div>
      </div>
      <div class="space-y-2 px-3 py-3 font-mono text-[11px] text-text-secondary">
        <div class="flex items-center gap-1">
          <span class="text-text-muted">kind</span>
          <span class="ml-auto rounded border border-line-subtle px-1">{{ edge.kind ?? "data" }}</span>
        </div>
        <div><span class="text-text-muted">from</span> {{ edge.from.nodeId }}:{{ edge.from.port }}</div>
        <div><span class="text-text-muted">to</span> {{ edge.to.nodeId }}:{{ edge.to.port }}</div>
      </div>
      <div class="border-t border-line-subtle px-3 py-3">
        <UiButton
          variant="ghost"
          class="!h-7 !px-2 text-xs"
          :class="confirmDeleteEdge ? 'text-signal-error' : 'text-text-secondary'"
          @click="deleteSelectedEdge"
        >
          <Trash2 :size="12" :stroke-width="1.5" />
          {{ confirmDeleteEdge ? t("graph.inspector.confirmDelete") : t("graph.inspector.deleteEdge") }}
        </UiButton>
      </div>
    </div>
     <!-- Group inspector（折叠节点组：输出通道快速开关）-->
    <div v-else-if="group" class="min-h-0 flex-1 overflow-auto">
      <div class="flex items-center gap-2 border-b border-line-subtle px-3 py-2.5">
        <Boxes :size="15" :stroke-width="1.5" class="text-text-secondary" />
        <div class="min-w-0">
          <div class="truncate text-sm font-medium text-text-primary">{{ group.name }}</div>
          <div class="mt-0.5 font-mono text-[10px] text-text-muted">
            {{ t("graph.group.nodeGroup") }} · {{ groupMembers.length }}
          </div>
        </div>
      </div>

      <div class="space-y-3 px-3 py-3">
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            class="size-3.5 accent-signal-accent"
            :checked="groupSwitch === 'on'"
            :indeterminate="groupSwitch === 'mixed'"
            @change="onToggleGroupAll"
          />
          {{ t("graph.group.switch") }}
        </label>
      </div>

      <div class="space-y-2 border-t border-line-subtle px-3 py-3">
        <div class="text-[11px] font-medium text-text-secondary">{{ t("graph.group.channels") }}</div>
        <p v-if="groupChannels.length === 0" class="text-[10px] text-text-muted">
          {{ t("graph.group.channelsEmpty") }}
        </p>
        <label
          v-for="channel in groupChannels"
          :key="channel.id"
          class="flex items-center gap-2"
        >
          <input
            type="checkbox"
            class="size-3.5 shrink-0 accent-signal-accent"
            :checked="!channel.explicitlyDisabled"
            :title="channel.explicitlyDisabled ? t('graph.group.channelOff') : t('graph.group.channelOn')"
            @change="onToggleChannel(channel.id, channel.explicitlyDisabled)"
          />
          <span
            class="min-w-0 flex-1 truncate text-xs"
            :class="channel.disabled ? 'text-text-muted line-through' : 'text-text-secondary'"
            :title="channel.label"
          >{{ channel.label }}</span>
          <span
            v-if="channel.producerDisabled"
            class="shrink-0 rounded border border-line-subtle px-1 font-mono text-[9px] text-text-muted"
            :title="t('graph.group.channelProducerDisabled')"
          >{{ t("graph.group.channelProducerDisabledShort") }}</span>
           </label>
      </div>
    </div>


    <!-- Empty -->
    <div v-else class="flex flex-1 items-center justify-center p-6 text-center">
      <p class="text-xs leading-relaxed text-text-muted">{{ t("graph.inspector.empty") }}</p>
    </div>
  </div>
</template>

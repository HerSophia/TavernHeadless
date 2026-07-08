<script setup lang="ts">
import {
  groupSwitchState,
  isNodeGraphAnnotationNodeType,
  NODE_GRAPH_PHASES,
  type NodeGraphDiagnostic,
  type NodeGraphPhase,
  type NodeGraphPortType,
} from "@tavern/core/node-graph";
import { Boxes, Eye, Play, Plus, Trash2, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import UiButton from "../../../ui/UiButton.vue";
import { useContextStore } from "../../../stores/context";
import { useGraphEditorStore } from "../../../stores/graph-editor";
import AgentCallConfigForm from "../config/AgentCallConfigForm.vue";
import ConditionConfigForm from "../config/ConditionConfigForm.vue";
import GateConfigForm from "../config/GateConfigForm.vue";
import NodeTypeHelp from "../node-types/NodeTypeHelp.vue";
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
import {
  applyPresetRefToConfig,
  applySubgraphRefToConfig,
  readNarratorAgentSource,
  readNarratorPresetRefInputs,
  readNarratorSubgraphRefInputs,
  switchNarratorAgentSource,
  type NarratorAgentSource,
} from "./narrator-source-edit";

const emit = defineEmits<{
  (event: "open-node-type", type: string): void;
}>();

const { t, te } = useI18n();
const store = useGraphEditorStore();
const ctx = useContextStore();
const {
  previewing,
  error: previewError,
  result: previewResult,
  runPreview,
  reset: resetPreview,
} = useNodePreview();

const node = computed(() => store.selectedNode);
const entry = computed(() => store.selectedNodeEntry);
const nodeKnowledge = computed(() => store.selectedNodeKnowledge);
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
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    );
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
const previewSupported = computed(
  () =>
    !store.isSample && Boolean(store.graphId) && policy.value !== "disabled",
);

// —— 节点组（group.node）接口 CRUD（仿 Blender Inputs/Outputs 面板）——
const isGroupNode = computed(() => node.value?.type === "group.node");
const groupInterface = computed(() => readInterface(node.value?.config));
const portTypeOptions = PORT_TYPE_OPTIONS;
const portDirections: PortDirection[] = ["inputs", "outputs"];

function commitInterface(next: ReturnType<typeof readInterface>): void {
  if (node.value) {
    store.updateNodeConfig(
      node.value.id,
      writeInterface(node.value.config, next),
    );
  }
}

function onAddPort(dir: PortDirection): void {
  commitInterface(addPort(groupInterface.value, dir));
}

function onRemovePort(dir: PortDirection, index: number): void {
  commitInterface(removePort(groupInterface.value, dir, index));
}

function onRenamePort(dir: PortDirection, index: number, event: Event): void {
  commitInterface(
    renamePort(
      groupInterface.value,
      dir,
      index,
      (event.target as HTMLInputElement).value,
    ),
  );
}

function onRetypePort(dir: PortDirection, index: number, event: Event): void {
  commitInterface(
    retypePort(
      groupInterface.value,
      dir,
      index,
      (event.target as HTMLSelectElement).value as NodeGraphPortType,
    ),
  );
}

const configText = ref("");
const contentText = ref("");
const configError = ref<string | null>(null);
const jsonConfigOpen = ref(false);

const isAnnotationNode = computed(() =>
  Boolean(node.value && isNodeGraphAnnotationNodeType(node.value.type)),
);
/** 节点 config 是否含字符串 `content` 字段。注释节点也使用 content，但不进入运行。 */
const hasContentField = computed(
  () =>
    isAnnotationNode.value ||
    typeof (node.value?.config as { content?: unknown } | undefined)
      ?.content === "string",
);
const contentFieldLabel = computed(() =>
  isAnnotationNode.value
    ? t("graph.inspector.annotationContent")
    : t("graph.inspector.content"),
);
const contentFieldHint = computed(() =>
  isAnnotationNode.value
    ? t("graph.inspector.annotationContentHint")
    : t("graph.inspector.contentHint"),
);

/** 从 config 读出字符串 content，非对象或缺省时回退空串。 */
function readContent(config: unknown): string {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as { content?: unknown }).content;
    return typeof value === "string" ? value : "";
  }
  return "";
}
/** LI11-3（3b）：narrator 节点的叙述者预设引用（config.presetRef）专用编辑。 */
const isNarratorNode = computed(
  () => node.value?.type === "narration.narrator",
);
const isAgentCallNode = computed(() => node.value?.type === "agent.call");
const isControlConditionNode = computed(
  () => node.value?.type === "control.condition",
);
const isControlBranchNode = computed(
  () => node.value?.type === "control.branch",
);
const isControlGateNode = computed(() => node.value?.type === "control.gate");
const hasStructuredConfigForm = computed(
  () =>
    isAgentCallNode.value ||
    isControlConditionNode.value ||
    isControlBranchNode.value ||
    isControlGateNode.value,
);
const selectedNodeDiagnostics = computed<NodeGraphDiagnostic[]>(() => {
  const current = node.value;
  if (!current) {
    return [];
  }
  return store.diagnostics.filter(
    (diagnostic) => diagnostic.nodeId === current.id,
  );
});
const presetIdText = ref("");
const presetVersionText = ref("");
// NG2-10：承载节点（narrator）来源二选一（preset / subgraph），与 NG2-7 config 契约（source / presetRef / subgraphRef 互斥）对齐。
// 读 / 写 / 切换的纯逻辑抽至 ./narrator-source-edit（便于单测），此处仅做响应式状态桥接。
const agentSource = ref<NarratorAgentSource>("preset");
const subgraphGraphIdText = ref("");
const subgraphVersionText = ref("");

/** 克隆当前节点 config 为可写对象（非对象则空对象）。 */
function cloneNodeConfig(): Record<string, unknown> {
  const base = node.value?.config;
  return base && typeof base === "object" && !Array.isArray(base)
    ? { ...(base as Record<string, unknown>) }
    : {};
}

/** 将编辑后的 config 写回 store（空对象 → undefined），并同步 JSON 高级编辑框。 */
function commitNodeConfig(config: Record<string, unknown>): void {
  if (!node.value) {
    return;
  }
  const next = Object.keys(config).length > 0 ? config : undefined;
  store.updateNodeConfig(node.value.id, next);
  configText.value = next === undefined ? "" : JSON.stringify(next, null, 2);
  configError.value = null;
}

/** 收集 preset 分支当前输入（presetId / presetVersionId）。 */
function currentPresetRefInputs(): {
  presetId: string;
  presetVersionId: string;
} {
  return {
    presetId: presetIdText.value,
    presetVersionId: presetVersionText.value,
  };
}

/** 收集 subgraph 分支当前输入（graphId / versionId）。 */
function currentSubgraphRefInputs(): { graphId: string; versionId: string } {
  return {
    graphId: subgraphGraphIdText.value,
    versionId: subgraphVersionText.value,
  };
}

/**
 * preset 分支：presetId / presetVersionId 输入失焦时写回 config.presetRef。
 * 零回归：对无 source 的既有 narrator 仅写 presetRef（不注入 source），行为与现状逐字节等价；
 * source 与互斥在显式切换来源（applyAgentSource）时才落入。
 */
function applyPresetRef(): void {
  if (!node.value) {
    return;
  }
  commitNodeConfig(
    applyPresetRefToConfig(cloneNodeConfig(), currentPresetRefInputs()),
  );
}

/** subgraph 分支：graphId / versionId 输入失焦时写回 config.subgraphRef。 */
function applySubgraphRef(): void {
  if (!node.value) {
    return;
  }
  commitNodeConfig(
    applySubgraphRefToConfig(cloneNodeConfig(), currentSubgraphRefInputs()),
  );
}

/**
 * 显式切换承载来源：置 config.source，清除另一侧引用（互斥），并写回同侧引用。
 * 仅在用户主动切换时落 source（既有无 source narrator 不会因编辑 presetRef 而被注入 source）。
 */
function applyAgentSource(source: NarratorAgentSource): void {
  if (!node.value || agentSource.value === source) {
    return;
  }
  agentSource.value = source;
  commitNodeConfig(
    switchNarratorAgentSource(cloneNodeConfig(), source, {
      preset: currentPresetRefInputs(),
      subgraph: currentSubgraphRefInputs(),
    }),
  );
}

const userInput = ref("");
const confirmDeleteNode = ref(false);
const confirmDeleteEdge = ref(false);

function phaseLabel(phase: string): string {
  const key = `graphNode.phase.${phase}`;
  return te(key) ? t(key) : phase;
}

function openNodeTypeDetail(): void {
  if (node.value) {
    emit("open-node-type", node.value.type);
  }
}

function nodeTitle(): string {
  if (!node.value) {
    return "";
  }
  const key = `graphNode.type.${node.value.type.replaceAll(".", "_")}`;
  return te(key)
    ? t(key)
    : (entry.value?.title ?? node.value.name ?? node.value.type);
}

function syncSelectedConfigEditors(config: unknown): void {
  configText.value =
    config === undefined ? "" : JSON.stringify(config, null, 2);
  contentText.value = readContent(config);
  const presetRef = readNarratorPresetRefInputs(config);
  presetIdText.value = presetRef.presetId;
  presetVersionText.value = presetRef.presetVersionId;
  const subgraphRef = readNarratorSubgraphRefInputs(config);
  subgraphGraphIdText.value = subgraphRef.graphId;
  subgraphVersionText.value = subgraphRef.versionId;
  agentSource.value = readNarratorAgentSource(config);
}

watch(
  () => store.selectedNodeId,
  () => {
    configError.value = null;
    confirmDeleteNode.value = false;
    resetPreview();
    const current = node.value;
    syncSelectedConfigEditors(current?.config);
    jsonConfigOpen.value = !hasStructuredConfigForm.value;
  },
  { immediate: true },
);

watch(
  () =>
    node.value?.config === undefined ? "" : JSON.stringify(node.value.config),
  () => {
    syncSelectedConfigEditors(node.value?.config);
    configError.value = null;
  },
);

watch(
  () => store.selectedEdgeId,
  () => {
    confirmDeleteEdge.value = false;
  },
);

function syncConfigText(config: unknown): void {
  configText.value =
    config === undefined ? "" : JSON.stringify(config, null, 2);
}

function applyStructuredConfig(next: Record<string, unknown>): void {
  if (!node.value) {
    return;
  }
  store.updateNodeConfig(node.value.id, next);
  syncConfigText(next);
  configError.value = null;
}

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
    store.updateNode(node.value.id, {
      name: (event.target as HTMLInputElement).value || undefined,
    });
  }
}

function onPhaseChange(event: Event): void {
  if (node.value) {
    store.updateNode(node.value.id, {
      phase: (event.target as HTMLSelectElement).value as NodeGraphPhase,
    });
  }
}

function onEnabledChange(event: Event): void {
  if (node.value) {
    store.updateNode(node.value.id, {
      enabled: (event.target as HTMLInputElement).checked,
    });
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

function onEdgeKindChange(event: Event): void {
  if (!edge.value) {
    return;
  }
  store.updateEdgeKind(
    edge.value.id,
    (event.target as HTMLSelectElement).value as "data" | "control",
  );
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
    return typeof result.value === "string"
      ? result.value
      : JSON.stringify(result.value, null, 2);
  }
  return "";
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header
      class="flex h-9 shrink-0 items-center gap-2 border-b border-line-subtle px-3 text-xs"
    >
      <span class="font-medium text-text-secondary">{{
        t("graph.inspector.title")
      }}</span>
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
        <div class="text-sm font-medium text-text-primary">
          {{ nodeTitle() }}
        </div>
        <div class="mt-0.5 font-mono text-[10px] text-text-muted">
          {{ node.type }}@{{ node.typeVersion }} · {{ node.id }}
        </div>
      </div>

      <div class="space-y-3 px-3 py-3">
        <NodeTypeHelp
          :detail="nodeKnowledge"
          :unknown-type="node.type"
          @open-detail="openNodeTypeDetail"
        />

        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{
            t("graph.inspector.name")
          }}</span>
          <input
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="node.name ?? ''"
            :placeholder="nodeTitle()"
            @change="onNameInput"
          />
        </label>

        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{
            t("graph.inspector.phase")
          }}</span>
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
          <span class="mb-1 block text-[11px] text-text-muted">{{
            contentFieldLabel
          }}</span>
          <textarea
            v-model="contentText"
            rows="6"
            spellcheck="false"
            class="w-full resize-y whitespace-pre-wrap rounded-md border border-line-subtle bg-float px-2 py-1 text-xs leading-relaxed text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            @blur="applyContent"
          />
          <p class="mt-1 text-[10px] text-text-muted">{{ contentFieldHint }}</p>
        </div>

        <div v-if="isNarratorNode" class="space-y-2">
          <!-- NG2-10 承载来源二选一：preset / subgraph（互斥，写入时清另一侧引用）。 -->
          <div class="space-y-1">
            <span class="block text-[11px] text-text-muted">{{
              t("graph.inspector.agentSource")
            }}</span>
            <div class="flex gap-2">
              <button
                v-for="source in ['preset', 'subgraph'] as const"
                :key="source"
                type="button"
                class="flex-1 rounded-md border px-2 py-1 text-xs transition-colors duration-150"
                :class="
                  agentSource === source
                    ? 'border-signal-accent bg-float text-text-primary'
                    : 'border-line-subtle text-text-secondary hover:border-line-active'
                "
                @click="applyAgentSource(source)"
              >
                {{
                  source === "subgraph"
                    ? t("graph.inspector.sourceSubgraph")
                    : t("graph.inspector.sourcePreset")
                }}
              </button>
            </div>
          </div>

          <!-- preset 来源：presetId / presetVersionId 手输编辑。 -->
          <div v-if="agentSource === 'preset'">
            <span class="mb-1 block text-[11px] text-text-muted">{{
              t("graph.inspector.presetRef")
            }}</span>
            <input
              v-model="presetIdText"
              :placeholder="t('graph.inspector.presetRefId')"
              class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              @blur="applyPresetRef"
            />
            <input
              v-model="presetVersionText"
              :placeholder="t('graph.inspector.presetRefVersion')"
              class="mt-1.5 w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              @blur="applyPresetRef"
            />
            <p class="mt-1 text-[10px] text-text-muted">
              {{ t("graph.inspector.presetRefHint") }}
            </p>
          </div>

          <!-- subgraph 来源：graphId / versionId 手输编辑（NG2-9 承载契约）。 -->
          <div v-else>
            <span class="mb-1 block text-[11px] text-text-muted">{{
              t("graph.inspector.subgraphRef")
            }}</span>
            <input
              v-model="subgraphGraphIdText"
              :placeholder="t('graph.inspector.subgraphRefId')"
              class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              @blur="applySubgraphRef"
            />
            <input
              v-model="subgraphVersionText"
              :placeholder="t('graph.inspector.subgraphRefVersion')"
              class="mt-1.5 w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              @blur="applySubgraphRef"
            />
            <p class="mt-1 text-[10px] text-text-muted">
              {{ t("graph.inspector.subgraphRefHint") }}
            </p>
          </div>
        </div>

        <div v-if="hasStructuredConfigForm" class="space-y-2">
          <div class="text-[11px] font-medium text-text-secondary">
            {{ t("graph.inspector.structuredConfig") }}
          </div>
          <AgentCallConfigForm
            v-if="isAgentCallNode"
            :config="node.config"
            :policies="store.document?.policies ?? null"
            @update:config="applyStructuredConfig"
          />
          <ConditionConfigForm
            v-else-if="isControlConditionNode"
            node-type="control.condition"
            :config="node.config"
            :diagnostics="selectedNodeDiagnostics"
            @update:config="applyStructuredConfig"
          />
          <ConditionConfigForm
            v-else-if="isControlBranchNode"
            node-type="control.branch"
            :config="node.config"
            :diagnostics="selectedNodeDiagnostics"
            @update:config="applyStructuredConfig"
          />
          <GateConfigForm
            v-else-if="isControlGateNode"
            :config="node.config"
            :diagnostics="selectedNodeDiagnostics"
            @update:config="applyStructuredConfig"
          />
        </div>

        <div>
          <div class="mb-1 flex items-center gap-2">
            <span class="block text-[11px] text-text-muted">
              {{
                hasStructuredConfigForm
                  ? t("graph.inspector.jsonAdvanced")
                  : t("graph.inspector.config")
              }}
            </span>
            <button
              v-if="hasStructuredConfigForm"
              type="button"
              class="ml-auto rounded border border-line-subtle px-1.5 py-0.5 text-[10px] text-text-muted transition-colors duration-150 hover:border-line-active hover:text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              @click="jsonConfigOpen = !jsonConfigOpen"
            >
              {{
                jsonConfigOpen
                  ? t("graph.inspector.hideJson")
                  : t("graph.inspector.showJson")
              }}
            </button>
          </div>
          <template v-if="jsonConfigOpen">
            <textarea
              v-model="configText"
              rows="6"
              spellcheck="false"
              class="w-full resize-y rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-[11px] leading-relaxed text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              :placeholder="'{ }'"
              @blur="applyConfig"
            />
            <div class="mt-1 flex items-center gap-2">
              <UiButton
                variant="ghost"
                class="!h-7 !px-2 text-xs"
                @click="applyConfig"
              >
                {{ t("graph.inspector.applyConfig") }}
              </UiButton>
              <span v-if="configError" class="text-[11px] text-signal-error">{{
                configError
              }}</span>
            </div>
          </template>
          <p v-else class="text-[10px] leading-relaxed text-text-muted">
            {{ t("graph.inspector.jsonAdvancedHint") }}
          </p>
        </div>
      </div>

      <!-- Node group interface（仿 Blender Inputs/Outputs CRUD）-->
      <div
        v-if="isGroupNode"
        class="space-y-3 border-t border-line-subtle px-3 py-3"
      >
        <div class="text-[11px] font-medium text-text-secondary">
          {{ t("graph.interface.title") }}
        </div>
        <div v-for="dir in portDirections" :key="dir" class="space-y-1.5">
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-text-muted">
              {{
                dir === "inputs"
                  ? t("graph.interface.inputs")
                  : t("graph.interface.outputs")
              }}
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
          <p
            v-if="groupInterface[dir].length === 0"
            class="text-[10px] text-text-muted"
          >
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
              <option v-for="ty in portTypeOptions" :key="ty" :value="ty">
                {{ ty }}
              </option>
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
          <span class="text-[11px] text-text-muted">{{
            t("graph.inspector.preview")
          }}</span>
          <span
            class="ml-auto rounded border border-line-subtle px-1 font-mono text-[10px] text-text-secondary"
          >
            {{ policy }}
          </span>
        </div>

        <p
          v-if="store.isSample || !store.graphId"
          class="text-[11px] leading-relaxed text-text-muted"
        >
          {{ t("graph.inspector.previewUnavailable") }}
        </p>
        <template v-else-if="policy === 'disabled'">
          <p class="text-[11px] leading-relaxed text-text-muted">
            {{ t("graph.inspector.previewDisabled") }}
          </p>
        </template>
        <template v-else>
          <input
            v-model="userInput"
            class="mb-2 w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :placeholder="t('graph.inspector.previewInput')"
          />
          <UiButton
            class="!h-7 !px-2 text-xs"
            :disabled="previewing"
            @click="doPreview"
          >
            <Play :size="12" :stroke-width="1.5" />
            {{
              previewing
                ? t("graph.inspector.previewing")
                : t("graph.inspector.runPreview")
            }}
          </UiButton>
          <p
            v-if="store.dirty"
            class="mt-2 text-[11px] leading-relaxed text-signal-warn"
          >
            {{ t("graph.inspector.previewStale") }}
          </p>

          <p
            v-if="previewError"
            class="mt-2 text-[11px] leading-relaxed text-signal-error"
          >
            {{ previewError }}
          </p>

          <div v-if="previewResult" class="mt-2 space-y-1.5">
            <div
              class="flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-muted"
            >
              <span
                v-if="previewResult.preview?.kind"
                class="rounded border border-line-subtle px-1"
                >{{ previewResult.preview.kind }}</span
              >
              <span
                v-if="previewResult.preview?.source"
                class="rounded border border-line-subtle px-1"
                >{{ previewResult.preview.source }}</span
              >
              <span v-if="previewResult.preview?.tokenEstimate !== undefined"
                >~{{ previewResult.preview.tokenEstimate }} tok</span
              >
              <span v-if="previewResult.preview?.stale" class="text-signal-warn"
                >stale</span
              >
            </div>
            <p
              v-if="previewResult.preview?.summary"
              class="text-[11px] leading-relaxed text-text-secondary"
            >
              {{ previewResult.preview.summary }}
            </p>
            <pre
              v-if="previewValueText"
              class="max-h-48 overflow-auto rounded-md border border-line-subtle bg-app px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text-secondary"
              >{{ previewValueText }}</pre
            >
          </div>
        </template>
      </div>

      <!-- Delete -->
      <div class="border-t border-line-subtle px-3 py-3">
        <UiButton
          variant="ghost"
          class="!h-7 !px-2 text-xs"
          :class="
            confirmDeleteNode ? 'text-signal-error' : 'text-text-secondary'
          "
          @click="deleteSelectedNode"
        >
          <Trash2 :size="12" :stroke-width="1.5" />
          {{
            confirmDeleteNode
              ? t("graph.inspector.confirmDelete")
              : t("graph.inspector.deleteNode")
          }}
        </UiButton>
      </div>
    </div>

    <!-- Edge inspector -->
    <div v-else-if="edge" class="min-h-0 flex-1 overflow-auto">
      <div class="border-b border-line-subtle px-3 py-2.5">
        <div class="text-sm font-medium text-text-primary">
          {{ t("graph.inspector.edge") }}
        </div>
        <div class="mt-0.5 font-mono text-[10px] text-text-muted">
          {{ edge.id }}
        </div>
      </div>
      <div
        class="space-y-2 px-3 py-3 font-mono text-[11px] text-text-secondary"
      >
        <label class="block font-sans">
          <span class="mb-1 block text-[11px] text-text-muted">{{
            t("graph.inspector.edgeKind")
          }}</span>
          <select
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 font-mono text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            :value="edge.kind ?? 'data'"
            @change="onEdgeKindChange"
          >
            <option value="data">data</option>
            <option value="control">control</option>
          </select>
        </label>
        <div>
          <span class="text-text-muted">from</span> {{ edge.from.nodeId }}:{{
            edge.from.port
          }}
        </div>
        <div>
          <span class="text-text-muted">to</span> {{ edge.to.nodeId }}:{{
            edge.to.port
          }}
        </div>
      </div>
      <div class="border-t border-line-subtle px-3 py-3">
        <UiButton
          variant="ghost"
          class="!h-7 !px-2 text-xs"
          :class="
            confirmDeleteEdge ? 'text-signal-error' : 'text-text-secondary'
          "
          @click="deleteSelectedEdge"
        >
          <Trash2 :size="12" :stroke-width="1.5" />
          {{
            confirmDeleteEdge
              ? t("graph.inspector.confirmDelete")
              : t("graph.inspector.deleteEdge")
          }}
        </UiButton>
      </div>
    </div>
    <!-- Group inspector（折叠节点组：输出通道快速开关）-->
    <div v-else-if="group" class="min-h-0 flex-1 overflow-auto">
      <div
        class="flex items-center gap-2 border-b border-line-subtle px-3 py-2.5"
      >
        <Boxes :size="15" :stroke-width="1.5" class="text-text-secondary" />
        <div class="min-w-0">
          <div class="truncate text-sm font-medium text-text-primary">
            {{ group.name }}
          </div>
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
        <div class="text-[11px] font-medium text-text-secondary">
          {{ t("graph.group.channels") }}
        </div>
        <p
          v-if="groupChannels.length === 0"
          class="text-[10px] text-text-muted"
        >
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
            :title="
              channel.explicitlyDisabled
                ? t('graph.group.channelOff')
                : t('graph.group.channelOn')
            "
            @change="onToggleChannel(channel.id, channel.explicitlyDisabled)"
          />
          <span
            class="min-w-0 flex-1 truncate text-xs"
            :class="
              channel.disabled
                ? 'text-text-muted line-through'
                : 'text-text-secondary'
            "
            :title="channel.label"
            >{{ channel.label }}</span
          >
          <span
            v-if="channel.producerDisabled"
            class="shrink-0 rounded border border-line-subtle px-1 font-mono text-[9px] text-text-muted"
            :title="t('graph.group.channelProducerDisabled')"
            >{{ t("graph.group.channelProducerDisabledShort") }}</span
          >
        </label>
      </div>
    </div>

    <!-- Empty -->
    <div v-else class="flex flex-1 items-center justify-center p-6 text-center">
      <p class="text-xs leading-relaxed text-text-muted">
        {{ t("graph.inspector.empty") }}
      </p>
    </div>
  </div>
</template>

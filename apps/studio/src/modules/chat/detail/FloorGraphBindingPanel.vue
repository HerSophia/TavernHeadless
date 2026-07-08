<script setup lang="ts">
/**
 * 楼层图绑定面板（SC2-5，方向 1）：主会话侧右栏抽屉。
 *
 * project 级 + kind 维度（native / compat）：查看 / 设置 / 清除当前项目的默认楼层图绑定。
 * 绑定状态单一事实源在 graph-editor store（`floorGraphBindings`），本面板复用；图 / 版本列表
 * 经第一方 `lib/nodegraph-api` 按需拉取，只作面板内轻缓存（非持久第二状态）。
 * 显式写动作用 `store.setFloorGraphBindingTo(projectId, kind, graphId, versionId)` / `clearFloorGraphBinding`；
 * compat 约束（禁 agent./verify.、恰好 1 个 narrator、需 project.config.write）由后端 400 兜底，
 * 前端如实静态提示 + 失败回显（`store.error`）。
 */
import { AlertCircle, Workflow, X } from "lucide-vue-next";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import {
  nodeGraphApi,
  type FloorGraphBindingKind,
  type FloorGraphBindingResponse,
  type NodeGraphDefinitionResponse,
  type NodeGraphVersionResponse,
} from "../../../lib/nodegraph-api";
import { useGraphEditorStore } from "../../../stores/graph-editor";
import UiButton from "../../../ui/UiButton.vue";
import UiConfirmDialog from "../../../ui/UiConfirmDialog.vue";
import UiIconButton from "../../../ui/UiIconButton.vue";
import UiSelect from "../../../ui/UiSelect.vue";
import {
  resolveDefaultVersionId,
  toGraphOptions,
  toVersionOptions,
} from "./floor-graph-binding-options";

const props = defineProps<{ projectId: string | null }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const store = useGraphEditorStore();

const FLOOR_KINDS: FloorGraphBindingKind[] = ["native", "compat"];

const graphs = ref<NodeGraphDefinitionResponse[]>([]);
const loadingGraphs = ref(false);
const listError = ref<string | null>(null);

// 每个 kind 独立的图 / 版本选择（"" 表示未选）。
const selectedGraph = reactive<Record<FloorGraphBindingKind, string>>({ native: "", compat: "" });
const selectedVersion = reactive<Record<FloorGraphBindingKind, string>>({ native: "", compat: "" });

// 版本列表按图缓存（按需拉取，用完即弃随面板生命周期）。
const versionsCache = reactive<Record<string, NodeGraphVersionResponse[]>>({});
const versionsLoading = reactive<Record<string, boolean>>({});

const clearTarget = ref<FloorGraphBindingKind | null>(null);

// 快速切项目时丢弃过期响应。
let requestToken = 0;

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const graphOptions = computed(() => toGraphOptions(graphs.value));

function binding(kind: FloorGraphBindingKind): FloorGraphBindingResponse | null {
  return store.getFloorGraphBinding(kind);
}

function versionOptions(kind: FloorGraphBindingKind): { value: string; label: string }[] {
  const graphId = selectedGraph[kind];
  if (!graphId) {
    return [];
  }
  const graph = graphs.value.find((candidate) => candidate.id === graphId) ?? null;
  const current = graph?.current_version_id ?? null;
  return toVersionOptions(versionsCache[graphId] ?? []).map((option) =>
    option.value === current
      ? { ...option, label: `${option.label} · ${t("graph.floorBinding.currentVersion")}` }
      : option,
  );
}

async function ensureVersions(graphId: string): Promise<void> {
  if (!props.projectId || versionsCache[graphId]) {
    return;
  }
  versionsLoading[graphId] = true;
  try {
    versionsCache[graphId] = (await nodeGraphApi.listVersions(props.projectId, graphId)).items;
  } catch (cause) {
    listError.value = describe(cause);
  } finally {
    versionsLoading[graphId] = false;
  }
}

async function onGraphChange(kind: FloorGraphBindingKind, graphId: string): Promise<void> {
  selectedGraph[kind] = graphId;
  selectedVersion[kind] = "";
  if (!graphId) {
    return;
  }
  await ensureVersions(graphId);
  const graph = graphs.value.find((candidate) => candidate.id === graphId) ?? null;
  selectedVersion[kind] = resolveDefaultVersionId(graph, versionsCache[graphId] ?? []) ?? "";
}

function canSet(kind: FloorGraphBindingKind): boolean {
  return Boolean(props.projectId && selectedGraph[kind] && selectedVersion[kind]) && !store.floorGraphBindingSaving;
}

async function onSet(kind: FloorGraphBindingKind): Promise<void> {
  const projectId = props.projectId;
  const graphId = selectedGraph[kind];
  const versionId = selectedVersion[kind];
  if (!projectId || !graphId || !versionId) {
    return;
  }
  await store.setFloorGraphBindingTo(projectId, kind, graphId, versionId);
}

async function confirmClear(): Promise<void> {
  const kind = clearTarget.value;
  const projectId = props.projectId;
  if (!kind || !projectId) {
    clearTarget.value = null;
    return;
  }
  await store.clearFloorGraphBinding(projectId, kind);
  clearTarget.value = null;
}

async function load(projectId: string): Promise<void> {
  const token = (requestToken += 1);
  loadingGraphs.value = true;
  listError.value = null;
  selectedGraph.native = "";
  selectedGraph.compat = "";
  selectedVersion.native = "";
  selectedVersion.compat = "";
  for (const key of Object.keys(versionsCache)) {
    delete versionsCache[key];
  }
  await store.loadFloorGraphBindings(projectId);
  try {
    const items = (await nodeGraphApi.list(projectId)).items;
    if (token !== requestToken) {
      return;
    }
    graphs.value = items;
  } catch (cause) {
    if (token !== requestToken) {
      return;
    }
    listError.value = describe(cause);
    graphs.value = [];
  } finally {
    if (token === requestToken) {
      loadingGraphs.value = false;
    }
  }
}

watch(
  () => props.projectId,
  (id) => {
    if (id) {
      void load(id);
    } else {
      requestToken += 1;
      graphs.value = [];
      loadingGraphs.value = false;
      listError.value = null;
    }
  },
  { immediate: true },
);
</script>

<template>
  <aside class="flex h-full w-96 shrink-0 flex-col border-l border-line-subtle bg-panel">
    <header class="flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
      <Workflow :size="14" :stroke-width="1.5" class="text-text-muted" />
      <span class="text-sm font-medium text-text-secondary">{{ t("graph.floorBinding.title") }}</span>
      <UiIconButton class="ml-auto" :label="t('chat.sessions.info.close')" @click="emit('close')">
        <X :size="14" :stroke-width="1.5" />
      </UiIconButton>
    </header>

    <div class="min-h-0 flex-1 overflow-auto">
      <!-- 无当前项目 -->
      <div v-if="!projectId" class="flex h-full items-center justify-center p-6 text-center">
        <p class="text-xs text-text-muted">{{ t("graph.floorBinding.selectProjectFirst") }}</p>
      </div>

      <template v-else>
        <p class="border-b border-line-subtle px-3 py-2 text-xs text-text-muted">
          {{ t("graph.floorBinding.projectScopeNote") }}
        </p>

        <!-- 图列表拉取失败 -->
        <div v-if="listError" class="flex items-start gap-2 px-3 py-2 text-xs text-signal-error">
          <AlertCircle :size="13" :stroke-width="1.5" class="mt-0.5 shrink-0" />
          <span class="min-w-0 break-words">{{ listError }}</span>
        </div>

        <!-- 设置 / 清除失败（含后端 400 约束违规） -->
        <div v-if="store.error" class="flex items-start gap-2 px-3 py-2 text-xs text-signal-error">
          <AlertCircle :size="13" :stroke-width="1.5" class="mt-0.5 shrink-0" />
          <span class="min-w-0 break-words">{{ store.error }}</span>
        </div>

        <!-- 加载骨架 -->
        <div v-if="loadingGraphs && graphs.length === 0" class="space-y-3 p-3">
          <div class="h-4 w-24 animate-pulse rounded bg-float" />
          <div class="h-20 w-full animate-pulse rounded bg-float" />
          <div class="h-20 w-full animate-pulse rounded bg-float" />
        </div>

        <!-- 项目暂无可绑定图 -->
        <div
          v-else-if="graphs.length === 0"
          class="flex h-40 items-center justify-center p-6 text-center"
        >
          <p class="text-xs text-text-muted">{{ t("graph.floorBinding.noGraphs") }}</p>
        </div>

        <div v-else class="divide-y divide-line-subtle">
          <section v-for="kind in FLOOR_KINDS" :key="kind" class="px-3 py-3">
            <h3 class="fgb-h">{{ t(`graph.floorBinding.kind.${kind}`) }}</h3>

            <!-- 当前绑定态 -->
            <p class="mt-1 text-xs" :class="binding(kind) ? 'text-text-secondary' : 'text-text-muted'">
              <template v-if="binding(kind)">
                {{
                  t("graph.floorBinding.bound", {
                    graph: binding(kind)!.graph_name,
                    version: binding(kind)!.graph_version_no,
                  })
                }}
                <span class="text-text-muted"> · {{ binding(kind)!.status }}</span>
              </template>
              <template v-else>{{ t("graph.floorBinding.notBound") }}</template>
            </p>

            <!-- 图 + 版本选择 -->
            <div class="mt-2 space-y-2">
              <UiSelect
                :model-value="selectedGraph[kind]"
                :options="graphOptions"
                :placeholder="t('graph.floorBinding.pickGraph')"
                @update:model-value="(value) => onGraphChange(kind, value)"
              />
              <UiSelect
                :model-value="selectedVersion[kind]"
                :options="versionOptions(kind)"
                :placeholder="t('graph.floorBinding.pickVersion')"
                :disabled="!selectedGraph[kind] || Boolean(versionsLoading[selectedGraph[kind]])"
                @update:model-value="(value) => (selectedVersion[kind] = value)"
              />
              <div class="flex flex-wrap items-center gap-2">
                <UiButton class="!h-7 !px-2.5 !text-xs" :disabled="!canSet(kind)" @click="onSet(kind)">
                  {{ store.floorGraphBindingSaving ? t("graph.floorBinding.setting") : t("graph.floorBinding.setBinding") }}
                </UiButton>
                <UiButton
                  v-if="binding(kind)"
                  variant="ghost"
                  class="!h-7 !px-2.5 !text-xs"
                  :disabled="store.floorGraphBindingSaving"
                  @click="clearTarget = kind"
                >
                  {{ t("graph.floorBinding.clear", { kind }) }}
                </UiButton>
              </div>
            </div>

            <!-- 约束提示（compat 额外强调） -->
            <div class="mt-2 rounded border border-line-subtle bg-float px-2 py-1.5">
              <p class="fgb-label">{{ t("graph.floorBinding.constraints.title") }}</p>
              <ul class="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-text-muted">
                <li v-if="kind === 'compat'">{{ t("graph.floorBinding.constraints.compatNoAgentVerify") }}</li>
                <li>{{ t("graph.floorBinding.constraints.exactlyOneNarrator") }}</li>
                <li>{{ t("graph.floorBinding.constraints.needConfigWrite") }}</li>
              </ul>
            </div>
          </section>
        </div>
      </template>
    </div>

    <UiConfirmDialog
      :open="clearTarget !== null"
      :title="t('graph.floorBinding.clearConfirmTitle')"
      :message="t('graph.floorBinding.clearConfirmMessage', { kind: clearTarget ?? '' })"
      :confirm-label="t('graph.floorBinding.clearConfirm')"
      :cancel-label="t('graph.floorBinding.cancel')"
      :busy="store.floorGraphBindingSaving"
      tone="danger"
      @confirm="confirmClear"
      @cancel="clearTarget = null"
    />
  </aside>
</template>

<style scoped>
.fgb-h {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.fgb-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}
</style>

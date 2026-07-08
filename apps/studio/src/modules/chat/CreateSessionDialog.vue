<script setup lang="ts">
/**
 * 创建会话对话框（SC2-4 / 批次六大改进）。
 *
 * 基于 `UiDialog size="wide"`（动态 80% 视口宽）的「顶栏 + 三列浏览器」布局：
 * - 顶栏：标题 + 提示词模式 + 工具预设。
 * - 三列：左=预设、中=角色卡（含同步策略）、右=世界书，各为 `SessionAssetColumn` 密集浏览列（可选、可选版本、可留空）。
 * 全部留空即建空会话（向后兼容）。正则档暂不纳入（正则系统即将大改）。
 * 本组件只收集表单为 `CreateSessionInput` 并 `emit("create", input)`；建会话 / 刷新 / 选中 / 回显由父组件（ChatView）负责。
 */
import { Loader2 } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { AssetSelection } from "../../lib/assets/types";
import type {
  CreateSessionInput,
  SessionCharacterSyncPolicy,
  SessionPromptMode,
} from "../../lib/chat";
import { toolPolicyPresetApi, type ToolPolicyPresetSummary } from "../../lib/tool-policy-preset-api";
import UiButton from "../../ui/UiButton.vue";
import UiDialog from "../../ui/UiDialog.vue";
import UiSelect from "../../ui/UiSelect.vue";
import UiTextInput from "../../ui/UiTextInput.vue";
import SessionAssetColumn from "./SessionAssetColumn.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    projectId?: string | null;
    busy?: boolean;
    error?: string | null;
  }>(),
  { projectId: null, busy: false, error: null },
);

const emit = defineEmits<{ create: [input: CreateSessionInput]; close: [] }>();

const { t, te } = useI18n();

// 空字符串表示「默认 / 不指定」（提交时不写入 CreateSessionInput）。
type PromptModeValue = "" | SessionPromptMode;
type SyncPolicyValue = "" | SessionCharacterSyncPolicy;

const title = ref("");
const promptMode = ref<PromptModeValue>("");
const character = ref<AssetSelection | null>(null);
const preset = ref<AssetSelection | null>(null);
const worldbook = ref<AssetSelection | null>(null);
const syncPolicy = ref<SyncPolicyValue>("");
// 工具预设（SC2-10 / #b4-7b）："" = 默认（不指定，沿用原策略）；否则为项目下某预设 key。
const toolPresetKey = ref<string>("");
const presetSummaries = ref<ToolPolicyPresetSummary[]>([]);
const presetsLoading = ref(false);

const promptModeOptions: Array<{ value: PromptModeValue; label: string }> = [
  { value: "", label: t("chat.createDialog.promptMode_default") },
  { value: "compat_strict", label: t("chat.createDialog.promptMode_compat_strict") },
  { value: "compat_plus", label: t("chat.createDialog.promptMode_compat_plus") },
  { value: "native", label: t("chat.createDialog.promptMode_native") },
];

const syncPolicyOptions: Array<{ value: SyncPolicyValue; label: string }> = [
  { value: "", label: t("chat.createDialog.syncPolicy_default") },
  { value: "pin", label: t("chat.createDialog.syncPolicy_pin") },
  { value: "manual", label: t("chat.createDialog.syncPolicy_manual") },
  { value: "force", label: t("chat.createDialog.syncPolicy_force") },
];

/** 内置预设优先用本地化名，自定义预设回退后端 display_name。 */
function presetLabel(summary: ToolPolicyPresetSummary): string {
  const key = `chat.createDialog.toolPresetName.${summary.preset_key}`;
  return te(key) ? t(key) : summary.display_name;
}

// 首项为「默认（不指定）」，其余为项目下可用预设。
const toolPresetOptions = computed<Array<{ value: string; label: string }>>(() => [
  { value: "", label: t("chat.createDialog.toolPreset_default") },
  ...presetSummaries.value.map((summary) => ({
    value: summary.preset_key,
    label: presetLabel(summary),
  })),
]);

/** 加载项目下工具预设列表；失败不阻断建会话（退化为仅「默认」）。 */
async function loadPresets(): Promise<void> {
  const projectId = props.projectId;
  if (!projectId) {
    presetSummaries.value = [];
    return;
  }
  presetsLoading.value = true;
  try {
    const response = await toolPolicyPresetApi.list(projectId);
    presetSummaries.value = response.presets;
  } catch {
    presetSummaries.value = [];
  } finally {
    presetsLoading.value = false;
  }
}

function resetForm(): void {
  title.value = "";
  promptMode.value = "";
  character.value = null;
  preset.value = null;
  worldbook.value = null;
  syncPolicy.value = "";
  toolPresetKey.value = "";
}

// 每次打开都以空表单起步（一次「新建」= 一次全新选择），并拉取当前项目的工具预设。
watch(
  () => props.open,
  (open) => {
    if (open) {
      resetForm();
      void loadPresets();
    }
  },
);

// projectId 可能在对话框打开之后才就绪（项目仍在加载）；此时若已打开则重新拉取，
// 避免打开瞬间 projectId 为空导致工具预设列表只剩「默认」一项。
watch(
  () => props.projectId,
  () => {
    if (props.open) {
      void loadPresets();
    }
  },
);

function onCreate(): void {
  if (props.busy) {
    return;
  }
  const input: CreateSessionInput = {};
  const trimmed = title.value.trim();
  if (trimmed) {
    input.title = trimmed;
  }
  if (character.value) {
    input.character = character.value;
    if (syncPolicy.value) {
      input.characterSyncPolicy = syncPolicy.value;
    }
  }
  if (preset.value) {
    input.preset = preset.value;
  }
  if (worldbook.value) {
    input.worldbook = worldbook.value;
  }
  if (promptMode.value) {
    input.promptMode = promptMode.value;
  }
  if (toolPresetKey.value) {
    input.toolPresetKey = toolPresetKey.value;
  }
  emit("create", input);
}
</script>

<template>
  <UiDialog
    :open="open"
    :title="t('chat.createDialog.title')"
    size="wide"
    body-class="flex min-h-0 flex-col overflow-hidden"
    :busy="busy"
    @close="emit('close')"
  >
    <!-- 顶栏：标题 + 提示词模式 + 工具预设 -->
    <div class="flex shrink-0 flex-wrap items-end gap-3 border-b border-line-subtle px-4 py-3">
      <div class="min-w-[220px] flex-1 space-y-1">
        <label class="text-[11px] font-medium text-text-muted">{{ t("chat.createDialog.fieldTitle") }}</label>
        <UiTextInput
          v-model="title"
          :placeholder="t('chat.createDialog.titlePlaceholder')"
          :aria-label="t('chat.createDialog.fieldTitle')"
          :disabled="busy"
        />
      </div>
      <div class="w-52 space-y-1">
        <label class="text-[11px] font-medium text-text-muted">{{ t("chat.createDialog.promptMode") }}</label>
        <UiSelect v-model="promptMode" :options="promptModeOptions" :disabled="busy" />
      </div>
      <div class="w-52 space-y-1">
        <label class="text-[11px] font-medium text-text-muted">{{ t("chat.createDialog.toolPreset") }}</label>
        <UiSelect
          v-model="toolPresetKey"
          :options="toolPresetOptions"
          :disabled="busy || presetsLoading"
          :title="t('chat.createDialog.toolPresetHint')"
        />
      </div>
    </div>

    <!-- 三列资产浏览器：左=预设 · 中=角色卡 · 右=世界书 -->
    <div class="flex min-h-0 flex-1 divide-x divide-line-subtle">
      <SessionAssetColumn
        v-model="preset"
        kind="preset"
        :title="t('chat.createDialog.preset')"
        :disabled="busy"
      />

      <SessionAssetColumn
        v-model="character"
        kind="character"
        :title="t('chat.createDialog.character')"
        :disabled="busy"
      >
        <template #footer>
          <div v-if="character" class="flex items-center gap-2">
            <span class="shrink-0 text-[11px] text-text-muted">{{ t("chat.createDialog.syncPolicy") }}</span>
            <div class="min-w-0 flex-1">
              <UiSelect v-model="syncPolicy" :options="syncPolicyOptions" :disabled="busy" />
            </div>
          </div>
        </template>
      </SessionAssetColumn>

      <SessionAssetColumn
        v-model="worldbook"
        kind="worldbook"
        :title="t('chat.createDialog.worldbook')"
        :disabled="busy"
      />
    </div>

    <template #footer>
      <p v-if="error" class="mr-auto min-w-0 flex-1 truncate text-xs text-signal-error" :title="error">
        {{ error }}
      </p>
      <UiButton variant="ghost" :disabled="busy" @click="emit('close')">
        {{ t("chat.createDialog.cancel") }}
      </UiButton>
      <UiButton :disabled="busy" @click="onCreate">
        <Loader2 v-if="busy" :size="13" :stroke-width="1.5" class="animate-spin" />
        {{ busy ? t("chat.createDialog.creating") : t("chat.createDialog.create") }}
      </UiButton>
    </template>
  </UiDialog>
</template>

/**
 * 图助手「上下文与提示词」项目级配置 store（提示词阶段一）。
 *
 * 配置为项目级、后端持久。本 store 仅经第一方薄客户端读写前端。
 * 阶段一仅静态提示词（static_mode / static_text）落地；dynamic_template / context_config
 * 字段一并随配置往返，留待后续阶段编辑。
 */
import { defineStore } from "pinia";
import { computed,ref } from "vue";

import {
  graphAssistantPromptConfigApi,
    type GraphAssistantPromptConfigResponse,
  type GraphAssistantPromptConfigUpdateInput,
  type GraphAssistantStaticPromptMode,
} from "../lib/graph-assistant-prompt-config-api";
import {
  normalizeContextConfig,
  type GraphAssistantContextConfig,
} from "../modules/graph/assistant/context-config";

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export const useGraphAssistantPromptStore = defineStore("graph-assistant-prompt", () => {
  const config = ref<GraphAssistantPromptConfigResponse | null>(null);
  const projectId = ref<string | null>(null);
  const loading = ref(false);
  const saving = ref(false);
 const error = ref<string | null>(null);

  /** 内置默认静态提示词（只读展示用）。 */
  const builtinDefault = computed(() => config.value?.builtin_default ?? "");

  /** 当前叠加模式（缺省 append）。*/
  const staticMode = computed<GraphAssistantStaticPromptMode>(() => config.value?.static_mode ?? "append");

  /** 归一化后的上下文数据块配置（缺记录时为内置默认）。 */
  const contextConfig = computed<GraphAssistantContextConfig>(() =>
    normalizeContextConfig(config.value?.context_config),
  );

  /** 当前动态提示词模板（留空则渲染时走内置默认模板）。 */
  const dynamicTemplate = computed<string>(() => config.value?.dynamic_template ?? "");

  /**
   * 合成预览：内置默认 + 自定义 = 最终静态提示词。
   * 与后端 resolveStaticPrompt 合成规则保持一致（单一事实源在后端，这里仅做前端预览）。
   */
  const resolvedStaticPrompt = computed(() => {
    const cfg = config.value;
    if (!cfg) {
      return "";
    }
    const custom = cfg.static_text.trim();
    if(cfg.static_mode === "override") {
      return custom.length > 0 ? custom : cfg.builtin_default;
    }
    return custom.length > 0 ? `${cfg.builtin_default}\n\n${custom}` : cfg.builtin_default;
  });

  async function load(targetProjectId: string): Promise<void> {
    if (!targetProjectId) {
      return;
    }
    projectId.value = targetProjectId;
    loading.value = true;
    error.value = null;
    try {
      config.value = await graphAssistantPromptConfigApi.get(targetProjectId);
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  /** 保存配置；成功后用返回的 effective 配置刷新本地状态。 */
  async function save(input: GraphAssistantPromptConfigUpdateInput): Promise<void> {
    if (!projectId.value) {
return;
    }
    saving.value = true;
    error.value = null;
    try {
      config.value = await graphAssistantPromptConfigApi.update(projectId.value, input);
    } catch (cause) {
      error.value = toMessage(cause);
      throw cause;
    } finally {
      saving.value = false;
    }
  }

  /** 保存静态提示词（模式 + 自定义文本），保留其余字段不变。 */
  async function saveStatic(
    mode: GraphAssistantStaticPromptMode,
    text: string,
  ): Promise<void>{
    await save({
        static_mode: mode,
      static_text: text,
      dynamic_template: config.value?.dynamic_template,
      context_config: config.value?.context_config ?? undefined,
    });
  }

  /** 保存上下文数据块配置，保留静态提示词与动态模板不变。 */
  async function saveContext(nextConfig: GraphAssistantContextConfig): Promise<void> {
    await save({
      static_mode: config.value?.static_mode ?? "append",
      static_text: config.value?.static_text ?? "",
      dynamic_template: config.value?.dynamic_template,
      context_config: nextConfig as unknown as Record<string, unknown>,
    });
  }

  /** 保存动态提示词模板，保留静态提示词与上下文配置不变。 */
  async function saveDynamic(template: string): Promise<void> {
    await save({
      static_mode: config.value?.static_mode ?? "append",
      static_text: config.value?.static_text ?? "",
      dynamic_template: template,
      context_config: config.value?.context_config ?? undefined,
    });
  }

  return {
    config,
    projectId,
    loading,
    saving,
    error,
    builtinDefault,
    staticMode,
    contextConfig,
    dynamicTemplate,
    resolvedStaticPrompt,
    load,
    save,
    saveStatic,
    saveContext,
    saveDynamic,
  };
});

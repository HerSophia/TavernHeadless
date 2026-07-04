/** 静态提示词叠加模式：追加在内置默认之后，或完全覆盖内置默认。 */
export type GraphAssistantStaticPromptMode = "append" | "override";

/** 项目级提示词配置（后端 effective 视图）。 */
export interface GraphAssistantPromptConfigResponse {
  static_mode: GraphAssistantStaticPromptMode;
  static_text: string;
  dynamic_template: string;
  /** 上下文数据块配置（阶段二起使用）；无记录或为空时为 null。 */
  context_config: Record<string, unknown> | null;
  /** 内置默认静态提示词，供设置页只读展示与合成预览。 */
  builtin_default:string;
}

/** 写入项目级提示词配置入参。 */
export interface GraphAssistantPromptConfigUpdateInput {
  static_mode: GraphAssistantStaticPromptMode;
  static_text:string;
  dynamic_template?: string;
  context_config?: Record<string, unknown> | null;
}

/** 图助手逐工具策略：自动执行或需要确认。 */
export type GraphAssistantToolDecision = "auto" | "confirm";

/** 工具副作用级别（与后端 NodeGraph 工具声明一致）。 */
export type GraphAssistantToolSideEffectLevel = "none" |"sandbox" | "irreversible";

/** 单个工具的 effective 策略（默认值与 override 合并后的结果）。 */
export interface GraphAssistantToolPolicyItem {
  tool_name: string;
  side_effect_level: GraphAssistantToolSideEffectLevel;
  default_decision: GraphAssistantToolDecision;
  decision: GraphAssistantToolDecision;
  source: "default" | "override";
}

export interface GraphAssistantToolPolicyResponse {
  items: GraphAssistantToolPolicyItem[];
}

/** 批量更新单条策略入参。 */
export interface GraphAssistantToolPolicyUpdateItem {
  tool_name: string;
  decision: GraphAssistantToolDecision;
}

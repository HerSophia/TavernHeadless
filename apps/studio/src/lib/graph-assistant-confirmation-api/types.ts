/** 待确认工具调用的状态机（与后端 graph_assistant_pending_tool_calls 一致）。 */
export type GraphAssistantPendingToolCallStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "expired"
  | "cancelled";

/** 工具副作用级别（与后端 NodeGraph 工具声明一致；待确认记录里可能缺省为 null）。 */
export type GraphAssistantToolSideEffectLevel = "none" | "sandbox" | "irreversible";

/** 一条待确认（pending）工具调用记录（后端 snake_case 响应形态）。 */
export interface GraphAssistantPendingToolCall {
  id: string;
  conversation_id: string;
  branch_id: string;
  floor_id: string;
  call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  side_effect_level: GraphAssistantToolSideEffectLevel | null;
  status: GraphAssistantPendingToolCallStatus;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
}

export interface ListPendingToolCallsResponse {
  items: GraphAssistantPendingToolCall[];
}

/** 解决待确认的决策。 */
export type ResolvePendingToolCallDecision = "approve" | "reject";

/** 批准并续跑后返回的最终一轮结果（respond 结果子集，snake_case）。 */
export interface ResolvePendingToolCallResultPayload {
  conversation_id: string;
  branch_id: string;
  floor_id: string;
  floor_no: number;
  page_id: string;
  generated_text: string;
  total_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  final_state: string | null;
}

/**
 * 解决待确认的响应：
 * - approved：携带续跑后的最终结果（可能再次进入待确认，需重新拉取 pending 列表）。
 * - rejected：仅回传被标记为 rejected 的记录，控制权交回用户。
 */
export type ResolvePendingToolCallResponse =
  | {
      data: {
        decision: "approved";
        pending_tool_call: GraphAssistantPendingToolCall;
        result: ResolvePendingToolCallResultPayload;
      };
    }
  | {
      data: {
        decision: "rejected";
        pending_tool_call: GraphAssistantPendingToolCall;
      };
    };

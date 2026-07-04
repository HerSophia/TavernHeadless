export type TemporaryConversationErrorCode =
  | "source_session_not_found"
  | "source_project_not_found"
  | "conversation_not_found"
  | "invalid_kind"
  | "conversation_not_active"
  | "conversation_busy"
  | "unsupported_branch"
  | "invalid_message_role"
  | "empty_message_content"
  | "no_pending_input"
  | "missing_effective_user_tail"
  | "invalid_retention_policy"
  | "ttl_required"
  | "invalid_ttl_seconds"
  | "invalid_visibility"
  | "unsupported_export_target"
  | "source_output_page_not_found"
  | "invalid_source_output_page"
  | "target_page_not_found"
  | "pending_tool_call_not_found"
  | "pending_tool_call_not_pending"
  | "retry_target_not_found"
  | "invalid_from_step_index"
  | "step_retry_blocked_side_effect";

export class TemporaryConversationError extends Error {
  constructor(
    public readonly code: TemporaryConversationErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TemporaryConversationError";
  }
}

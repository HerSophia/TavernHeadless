export type VariableServiceErrorCode =
  | "duplicate_variable_target"
  | "invalid_variable_context"
  | "invalid_variable_value"
  | "variable_host_not_found"
  | "variable_not_found"
  | "variable_target_locked";

export class VariableServiceError extends Error {
  constructor(public readonly code: VariableServiceErrorCode, message: string) {
    super(message);
    this.name = "VariableServiceError";
  }
}

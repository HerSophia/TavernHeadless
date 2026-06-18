/**
 * Agent run budget（R6-2，缺口 4）。
 *
 * 给后台 Agent 运行加上输出派发与嵌套作业上限，阻止单次运行无限扩张持久副作用。
 * 第一版只做硬上限校验，不做完整计费系统。
 */
import { RUNTIME_GOVERNANCE_BUDGET_REASON_CODES } from "../governance/runtime-governance-types.js";

export interface AgentRunBudget {
  /** 单次运行允许派发的最大持久输出数。 */
  maxOutputDispatch: number;
  /** 单次运行允许触发的最大嵌套作业数。 */
  maxNestedJobs: number;
}

export const DEFAULT_AGENT_RUN_BUDGET: AgentRunBudget = {
  maxOutputDispatch: 16,
  maxNestedJobs: 16,
};

export interface AgentRunBudgetViolation {
  reasonCode: string;
  dimension: "output_dispatch" | "nested_jobs";
  limit: number;
  actual: number;
  message: string;
}

export function checkAgentRunOutputDispatchBudget(
  outputCount: number,
  budget: AgentRunBudget = DEFAULT_AGENT_RUN_BUDGET,
): AgentRunBudgetViolation | null {
  if (outputCount > budget.maxOutputDispatch) {
    return {
      reasonCode: RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.agentRunMaxOutputDispatch,
      dimension: "output_dispatch",
      limit: budget.maxOutputDispatch,
      actual: outputCount,
      message: `Agent run output dispatch budget exceeded: ${outputCount} > limit ${budget.maxOutputDispatch}.`,
    };
  }
  return null;
}

export function checkAgentRunNestedJobsBudget(
  nestedJobCount: number,
  budget: AgentRunBudget = DEFAULT_AGENT_RUN_BUDGET,
): AgentRunBudgetViolation | null {
  if (nestedJobCount > budget.maxNestedJobs) {
    return {
      reasonCode: RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.agentRunMaxNestedJobs,
      dimension: "nested_jobs",
      limit: budget.maxNestedJobs,
      actual: nestedJobCount,
      message: `Agent run nested jobs budget exceeded: ${nestedJobCount} > limit ${budget.maxNestedJobs}.`,
    };
  }
  return null;
}

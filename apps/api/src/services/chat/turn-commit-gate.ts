import type { AgentFinding, PostResponseEnvelope } from "../agent-runtime/inline-agent-types.js";

export type CommitGatePolicy = "warn_only" | "block_on_error";

export interface CommitGateReason {
  code: string;
  severity: "info" | "warn" | "error";
  summary: string;
  sourceAgentId?: string;
}

export interface CommitGateDecision {
  status: "allow" | "warn" | "block";
  policy: CommitGatePolicy;
  reasons: CommitGateReason[];
}

export interface BuildCommitGateDecisionInput {
  findings?: Partial<PostResponseEnvelope["findings"]>;
  policy?: CommitGatePolicy;
}

/**
 * 根据 post_response finding 构造 commit gate 决策。
 *
 * R2 默认使用 warn_only，避免直接改变现有提交行为。
 */
export function buildCommitGateDecision(input: BuildCommitGateDecisionInput = {}): CommitGateDecision {
  const policy = input.policy ?? "warn_only";
  const reasons = flattenFindings(input.findings);
  const hasError = reasons.some((reason) => reason.severity === "error");
  const hasWarn = reasons.some((reason) => reason.severity === "warn");

  if (policy === "block_on_error" && hasError) {
    return { status: "block", policy, reasons };
  }

  if (hasError || hasWarn) {
    return { status: "warn", policy, reasons };
  }

  return { status: "allow", policy, reasons };
}

function flattenFindings(findings: Partial<PostResponseEnvelope["findings"]> | undefined): CommitGateReason[] {
  if (!findings) {
    return [];
  }

  return [
    ...toReasons(findings.continuity, "continuity"),
    ...toReasons(findings.agency, "agency"),
    ...toReasons(findings.style, "style"),
  ];
}

function toReasons(findings: AgentFinding[] | undefined, sourceAgentId: string): CommitGateReason[] {
  return (findings ?? []).map((finding) => ({
    code: finding.code,
    severity: finding.severity,
    summary: finding.summary,
    sourceAgentId,
  }));
}

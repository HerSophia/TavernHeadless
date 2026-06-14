/**
 * ContinuityVerifier（post_response）。
 *
 * 职责：检查生成结果与scene / world / branch 上下文是否明显冲突。
 *
 * R1 采用确定性启发式，不调用 LLM。当前只做最小可解释检查：
 *  - 空正文视为连续性风险。
 * 其余检查留待后续阶段引入。
 */
import type {
  AgentFinding,
  AgentProcessor,
  AgentRunContext,
  AgentRunOutput,
  InlineAgentSpec,
} from "../inline-agent-types.js";

export class ContinuityVerifierAgent implements AgentProcessor {
  constructor(public readonly spec: InlineAgentSpec) {}

  prepare(): void {
    return undefined;
 }

  execute(_prepared: unknown, context: AgentRunContext): AgentRunOutput {
    const text = context.narratorText ?? "";
    const findings: AgentFinding[] = [];
    if (text.trim().length === 0) {
      findings.push({
        code: "continuity_empty_output",
        severity: "warn",
        summary: "Narrator produced empty output; continuity cannot be verified.",
      });
    }

    return {
      findings,
      summary:
        findings.length > 0
          ? "continuity risk detected (heuristic)"
          : "no obvious continuity issue detected (heuristic)",
    };
  }
}

/**
 * StyleFidelityVerifier（post_response）。
 *
 * 职责：检查输出是否违背 preset / style / narrator person / 禁止项。
 *
 * R1 采用确定性启发式，不调用 LLM。当前只做最小可解释检查：
 *  - 检测明显的 meta / 出戏表达。
 * 其余检查留待后续阶段引入。
 */
import type {
  AgentFinding,
  AgentProcessor,
  AgentRunContext,
  AgentRunOutput,
  InlineAgentSpec,
} from "../inline-agent-types.js";

const META_PATTERNS = [/\bas an ai\b/i, /\blanguage model\b/i, /作为(一个)?(ai|人工智能|语言模型)/i];

export class StyleFidelityVerifierAgent implements AgentProcessor {
  constructor(public readonly spec: InlineAgentSpec) {}

  prepare(): void {
    return undefined;
  }

  execute(_prepared: unknown, context:AgentRunContext): AgentRunOutput {
    const text = context.narratorText ?? "";
    const findings: AgentFinding[] = [];
    if (text.trim().length > 0 && META_PATTERNS.some((pattern) => pattern.test(text))) {
      findings.push({
        code: "style_meta_leak",
        severity: "warn",
        summary: "Narrator output may contain meta or out-of-character expressions.",
      });
    }

    return {
      findings,
      summary:
        findings.length > 0
          ? "style fidelity risk detected (heuristic)"
          : "no obvious style fidelity issue detected (heuristic)",
    };
  }
}

/**
 * MemoryProposalAgent（post_response）。
 *
 * 职责：从本轮 Narrator 输出中提取最小 memory proposal。
 *
 * R1 约束：proposal 只进入 page-scoped buffer 或 trace，不自动写 memory truth。
 * R1 不调用 LLM，仅在正文包含显式摘要标记时提取，否则不产出 proposal。
 */
import type {
  AgentMemoryProposal,
  AgentProcessor,
  AgentRunContext,
  AgentRunOutput,
  InlineAgentSpec,
} from "../inline-agent-types.js";

const SUMMARY_TAG_PATTERN = /<summary>([\s\S]*?)<\/summary>/gi;

export class MemoryProposalAgent implements AgentProcessor {
  constructor(public readonly spec: InlineAgentSpec) {}

  prepare(): void {
  return undefined;
  }

  execute(_prepared: unknown, context: AgentRunContext): AgentRunOutput {
    const text = context.narratorText ?? "";
    const proposals: AgentMemoryProposal[] = [];

    for (const match of text.matchAll(SUMMARY_TAG_PATTERN)) {
      const raw = match[1]?.trim();
      if (raw) {
        proposals.push({
          kind: "summary",
          summary: raw,
        });
      }
    }

    return {
      memoryProposals: proposals,
      summary:
        proposals.length > 0
          ? `memory proposals extracted (count=${proposals.length})`
          : "no memory proposal extracted in R1 heuristic mode",
    };
  }
}

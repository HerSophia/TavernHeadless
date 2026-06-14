/**
 * StateProposalAgent（post_response）。
 *
 * 职责：从本轮 Narrator 输出中提取最小 session state proposal。
 *
 * R1 约束：proposal 只进入 page-scoped buffer 或 trace，不自动写 live state。
 * R1 不调用 LLM，仅在正文包含显式结构化标记时提取，否则不产出 proposal。
 */
import type {
  AgentProcessor,
  AgentRunContext,
  AgentRunOutput,
  AgentStateProposal,
  InlineAgentSpec,
} from "../inline-agent-types.js";

const STATE_TAG_PATTERN = /<state>([\s\S]*?)<\/state>/gi;

export class StateProposalAgent implements AgentProcessor {
  constructor(public readonly spec: InlineAgentSpec) {}

  prepare(): void {
    return undefined;
 }

  execute(_prepared: unknown, context: AgentRunContext): AgentRunOutput {
    const text = context.narratorText ?? "";
    const proposals: AgentStateProposal[] = [];

    for (const match of text.matchAll(STATE_TAG_PATTERN)) {
      const raw = match[1]?.trim();
      if (raw) {
        proposals.push({
          summary: "state proposal extracted from narrator output",
          payload: { raw },
        });
      }
    }

    return {
      stateProposals: proposals,
      summary:
        proposals.length > 0
          ? `state proposals extracted (count=${proposals.length})`
    : "no state proposal extracted in R1 heuristic mode",
    };
  }
}

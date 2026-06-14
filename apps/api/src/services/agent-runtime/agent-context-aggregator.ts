/**
 * AgentContextAggregator：pre_response 与 Narrator 之间的内部汇总器。
 *
 * 它不是普通 Agent，而是 runtime 内部协作者。职责：
 *  - 合并 pre_response Agent 输出。
 *  - 解决轻量冲突。
 *  - 产出 Narrator 可消费的统一上下文，并把可渲染部分折叠为 contributor 列表。
 *
 * R1 冲突规则：
 *  1. agency_guard 约束优先于 director_hint 的积极推动建议。
 *  2. required worldbook 优先于 optional worldbook。
 *  3. MemorySelectAgent 失败时回退到现有 memory injection 结果。
 *  4. WorldbookFocusAgent 失败时回退到现有 worldbook 命中结果。
 *  5. Aggregator 只解决“如何给 Narrator”，不直接决定 commit。
 */
import type {
  AggregatedPreResponseContext,
  AgentRunRecord,
} from "./inline-agent-types.js";
import type { PromptRuntimeContributorOutput } from "../chat/types.js";

export class AgentContextAggregator {
  aggregate(records: AgentRunRecord[]): AggregatedPreResponseContext{
    const contributors: PromptRuntimeContributorOutput[] = [];
    const narratorConstraints: string[] = [];
    const conflicts: AggregatedPreResponseContext["conflicts"] = [];

    let worldbookSelectionOverride: AggregatedPreResponseContext["worldbookSelectionOverride"];
    let memorySelectionOverride: AggregatedPreResponseContext["memorySelectionOverride"];
    let hasAgencyConstraint = false;
    let hasDirectorHint = false;

    for (const record of records) {
      if (record.phase !== "pre_response" || record.status !== "ok" || !record.output) {
continue;
      }

      const output = record.output;

      if (output.contributor) {
        contributors.push(output.contributor);
      }

      if (output.narratorConstraints?.length) {
        for (const constraint of output.narratorConstraints) {
          if (!narratorConstraints.includes(constraint)) {
            narratorConstraints.push(constraint);
          }
        }
        if (record.roleKind === "agency_guard") {
          hasAgencyConstraint = true;
        }
      }

      if (record.roleKind === "director") {
        hasDirectorHint = true;
      }

      if (output.worldbookSelectionOverride) {
        worldbookSelectionOverride = output.worldbookSelectionOverride;
  }

 if (output.memorySelectionOverride) {
        memorySelectionOverride = output.memorySelectionOverride;
      }
    }

    // 规则 1：agency_guard 约束优先于 director_hint 的积极推动建议。
    if (hasAgencyConstraint && hasDirectorHint) {
      conflicts.push({
        code: "agency_over_director",
        summary: "Player agency constraints take precedence over director suggestions.",
        resolvedBy: "agency_guard",
      });
    }

    return {
      contributors,
      narratorConstraints,
      ...(worldbookSelectionOverride ? { worldbookSelectionOverride } : {}),
      ...(memorySelectionOverride ? { memorySelectionOverride } : {}),
      conflicts,
    };
  }
}

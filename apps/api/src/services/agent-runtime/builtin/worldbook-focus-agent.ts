/**
 * WorldbookFocusAgent（pre_response）。
 *
 * 职责：对当前 worldbook 命中结果做聚焦，区分 required / optional / suppressed。
 *
 * R1 约束：先做 hint-only 版本，只写 contributor 与trace，不直接修改 assemble 算法。
 * 默认把全部命中视为 required，后续阶段再收紧裁剪策略。
 */
import type {
  AgentProcessor,
  AgentRunContext,
  AgentRunOutput,
  InlineAgentSpec,
  WorldbookFocusSelection,
} from "../inline-agent-types.js";

export class WorldbookFocusAgent implements AgentProcessor {
  constructor(public readonly spec: InlineAgentSpec) {}

  prepare(): void {
    return undefined;
  }

  execute(_prepared: unknown, context: AgentRunContext): AgentRunOutput {
    const hits = context.worldbookHits ?? [];
    if (hits.length === 0) {
      return { summary: "no worldbookhitsto focus" };
    }

    const required = hits
      .map((hit) => hit.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const selection: WorldbookFocusSelection = {
      required,
      optional: [],
      suppressed: [],
    };

    const lines =hits.map((hit) => `- ${hit.name ?? hit.id}`);

    return {
      contributor: {
        id: "agent:worldbook_focus",
        kind: "worldbook_focus",
        sourceKind: "worldbook",
        modeScope: context.promptMode === "native" ? "native" : "compat_plus",
        payload: {
          requiredCount: required.length,
        },
        promptRenderable: {
          title: "Worldbook focus",
          content: ["Required worldbook entries:", ...lines].join("\n"),
        },
        trace: {
          deterministic: true,
          cacheScope: "floor",
        },
      },
      worldbookSelectionOverride: selection,
      summary: `worldbook focus prepared (required=${required.length})`,
    };
  }
}

/**
 * PlayerAgencyGuardAgent（pre_response 与 post_response 两阶段）。
 *
 * pre_response：把“不要替玩家做决定”的约束显式化为 Narrator 硬约束，只给 hint，不做 veto。
 * post_response：检查 Narrator 正文是否替玩家做决定、改写玩家意图，产出 finding，不自动重写。
 *
 * R1 采用确定性启发式，不调用 LLM。
 */
import type {
  AgentFinding,
  AgentProcessor,
  AgentRunContext,
  AgentRunOutput,
  InlineAgentSpec,
} from "../inline-agent-types.js";

const AGENCY_CONSTRAINT =
  "Do not decide, narrate, or assume the player's choices, dialogue, or inner thoughts without explicit player input.";

const FIRST_PERSON_PATTERNS = [/\bI (decide|choose|feel|think|say)\b/i, /\b我(决定|选择|觉得|认为|说道)\b/];

export class PlayerAgencyGuardAgent implements AgentProcessor {
  constructor(public readonly spec: InlineAgentSpec) {}

  prepare(): void {
    return undefined;
  }

  execute(_prepared: unknown, context: AgentRunContext): AgentRunOutput {
    if (context.spec.phase === "pre_response") {
      return {
        contributor: {
          id: "agent:agency_guard_pre",
          kind: "agency_guard",
      sourceKind: "agency_guard",
          modeScope: context.promptMode === "native" ? "native" : "compat_plus",
          payload: { constraints: [AGENCY_CONSTRAINT] },
          promptRenderable: {
            title: "Player agency guard",
            content: AGENCY_CONSTRAINT,
         },
      trace: {
      deterministic: true,
            cacheScope: "floor",
          },
        },
        narratorConstraints: [AGENCY_CONSTRAINT],
        summary: "player agency constraint prepared",
      };
    }

    const text = context.narratorText ?? "";
    const findings: AgentFinding[] = [];
    if (text.trim().length> 0 && FIRST_PERSON_PATTERNS.some((pattern) => pattern.test(text))) {
      findings.push({
        code: "agency_first_person_action",
        severity: "warn",
      summary: "Narrator output may have narrated the player's own action or thought.",
      });
    }

    return {
      findings,
      summary:
        findings.length > 0
          ? "potential player agency risk detected (heuristic)"
          : "no obvious player agency risk detected (heuristic)",
    };
  }
}

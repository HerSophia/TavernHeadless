/**
 * DirectorAgent（pre_response）。
 *
 * 职责：给 Narrator 提供本回合叙事意图，输出 do / dont 一类轻量提示。
 *
 * R1 约束：Director 只能给建议，不能替代 Narrator 写正文，也不能改写玩家输入。
 * R1 采用确定性启发式输出，不调用 LLM，便于稳定与测试。
 */
import type {
  AgentProcessor,
  AgentRunContext,
  AgentRunOutput,
  InlineAgentSpec,
} from "../inline-agent-types.js";

export class DirectorAgent implements AgentProcessor {
  constructor(public readonly spec: InlineAgentSpec) {}

  prepare(): void {
    return undefined;
  }

  execute(_prepared: unknown, context: AgentRunContext): AgentRunOutput {
    const hasScene = Boolean(context.firstPartyStateContext?.scene?.present);
    const plan = {
      pacing: "normal" as const,
      narrativeIntent: hasScene
        ? "Continue the current scene naturally and keep established context consistent."
        : "Advance the narrative naturally based on the latest player input.",
      do: ["Respect established scene, world, and character context."],
      dont: ["Do not introduce unestablished facts that contradict prior context."],
    };

    return {
      contributor: {
        id: "agent:director",
        kind: "director_hint",
        sourceKind: "director_hint",
        modeScope: context.promptMode === "native" ? "native" : "compat_plus",
        payload: plan,
        promptRenderable: {
          title: "Director hint",
          content: [
            `Pacing: ${plan.pacing}`,
            `Intent: ${plan.narrativeIntent}`,
            ...plan.do.map((line) => `Do: ${line}`),
            ...plan.dont.map((line) => `Dont: ${line}`),
          ].join("\n"),
        },
        trace: {
          deterministic: true,
         cacheScope: "floor",
        },
      },
     summary:"director hint prepared",
    };
  }
}

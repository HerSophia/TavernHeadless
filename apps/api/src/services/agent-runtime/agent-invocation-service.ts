/**
 * AgentInvocationService：R1 单回合 inline Agent 的统一调用入口。
 *
 * 它只负责“该跑谁、顺序怎样”，不负责真实执行。真实执行由 InlineAgentExecutor 承担。
 *
 * 约束：
 *  - 只解析主回合的 pre_response / post_response 两类来源。
 *  - aggregator 不作为 InlineAgentSpec 出现在计划里，由上层在 pre_response 执行后单独调用。
 */
import type {
  AgentInvocationPlan,
  AgentInvocationSource,
  InlineAgentSpec,
} from "./inline-agent-types.js";

const PRE_RESPONSE_AGENTS: InlineAgentSpec[] = [
  {
    id: "inline:scene_state",
    roleKind: "scene_state",
    phase: "pre_response",
    stabilityHint: "floor",
    failurePolicy: "fail_open",
  },
  {
    id: "inline:memory_selection",
    roleKind: "memory_selection",
    phase: "pre_response",
    stabilityHint: "floor",
   failurePolicy: "fail_open",
  },
  {
    id: "inline:worldbook_focus",
    roleKind: "worldbook_focus",
    phase: "pre_response",
    stabilityHint: "floor",
    failurePolicy: "fail_open",
  },
  {
    id: "inline:director",
    roleKind: "director",
    phase: "pre_response",
    stabilityHint: "floor",
    failurePolicy: "fail_open",
  },
  {
    id: "inline:agency_guard_pre",
    roleKind: "agency_guard",
    phase: "pre_response",
    stabilityHint: "floor",
    failurePolicy: "fail_open",
  },
];

const POST_RESPONSE_AGENTS: InlineAgentSpec[] = [
  {
    id: "inline:continuity_verifier",
    roleKind: "continuity_verifier",
    phase: "post_response",
    stabilityHint: "page",
    failurePolicy: "fail_open",
  },
  {
    id: "inline:agency_guard_post",
    roleKind: "agency_guard",
    phase: "post_response",
    stabilityHint: "page",
    failurePolicy: "fail_open",
  },
  {
    id: "inline:style_verifier",
    roleKind: "style_verifier",
    phase: "post_response",
    stabilityHint: "page",
    failurePolicy: "fail_open",
  },
  {
    id: "inline:state_proposal",
    roleKind: "state_proposal",
    phase: "post_response",
    stabilityHint: "page",
    failurePolicy: "fail_open",
  },
  {
    id: "inline:memory_proposal",
    roleKind: "memory_proposal",
    phase: "post_response",
    stabilityHint: "page",
    failurePolicy: "fail_open",
  },
];

export class AgentInvocationService {
  /**
   * 根据调用来源解析执行计划。
   */
  planForSource(source: AgentInvocationSource): AgentInvocationPlan {
    const isPreResponse = source.kind === "turn_pre_response" || source.kind === "respond_pre_response";

    if (isPreResponse) {
      return {
        source,
        phase: "pre_response",
        groups: [
          {
            groupId: "pre_response_parallel",
            parallel: true,
            agents: PRE_RESPONSE_AGENTS.map((spec) => ({ ...spec })),
          },
        ],
      };
    }

    return {
      source,
      phase: "post_response",
      groups: [
        {
          groupId: "post_response_parallel",
          parallel: true,
          agents: POST_RESPONSE_AGENTS.map((spec) => ({ ...spec })),
        },
      ],
    };
  }
}

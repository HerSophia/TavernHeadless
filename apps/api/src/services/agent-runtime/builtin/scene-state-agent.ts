/**
 * SceneStateAgent（pre_response）。
 *
 * 职责：从现有 first-party scene / world 投影中提取本回合需要的场景摘要。
 * 不直接写 live state，仅产出可渲染 contributor 与 trace 摘要。
 *
 * 复用现有 state_projection 投影渲染，不另起一套状态读取入口。
 */
import { buildFirstPartyStateProjectionRenderable } from "../../chat/prompt-runtime-contributors.js";

import type {
  AgentProcessor,
  AgentRunContext,
  AgentRunOutput,
InlineAgentSpec,
} from "../inline-agent-types.js";

export class SceneStateAgent implements AgentProcessor {
  constructor(public readonly spec: InlineAgentSpec) {}

  prepare(): void {
    return undefined;
  }

  execute(_prepared: unknown, context: AgentRunContext): AgentRunOutput {
    const renderable = buildFirstPartyStateProjectionRenderable(context.firstPartyStateContext);
    if (!renderable) {
      return { summary: "no managed scene/world projection available" };
    }

    return {
      contributor: {
        id: "agent:scene_state",
        kind: "scene_state",
        sourceKind: "state_projection",
     modeScope: context.promptMode === "native" ? "native" : "compat_plus",
        payload: {
          scene: context.firstPartyStateContext?.scene ?? null,
          world: context.firstPartyStateContext?.world ?? null,
        },
        promptRenderable: renderable,
        trace: {
          deterministic: true,
          cacheScope: "floor",
        },
      },
      summary: "scene/world projection prepared",
    };
  }
}

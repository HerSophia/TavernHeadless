/**
 * 内建 inline Agent 注册表。
 *
 * R1 的楼层级 Agent 先以内建 registry 落地，不直接复用 agent_type /
 * project_agent_binding 的持久化资源面。
 *
 * registry 以角色类型解析 processor。agency_guard 在 pre / post 两阶段共用
 * 同一 processor，由 processor 依据 spec.phase 分流。
 */
import type {
  AgentProcessor,
  InlineAgentRoleKind,
  InlineAgentSpec,
} from "../inline-agent-types.js";
import type { InlineAgentRegistry } from "../inline-agent-executor.js";

import { SceneStateAgent } from "./scene-state-agent.js";
import { MemorySelectAgent } from "./memory-select-agent.js";
import { WorldbookFocusAgent } from "./worldbook-focus-agent.js";
import { DirectorAgent } from "./director-agent.js";
import { PlayerAgencyGuardAgent } from "./player-agency-guard-agent.js";
import { ContinuityVerifierAgent } from "./continuity-verifier-agent.js";
import { StyleFidelityVerifierAgent } from "./style-fidelity-verifier-agent.js";
import { StateProposalAgent } from "./state-proposal-agent.js";
import { MemoryProposalAgent } from "./memory-proposal-agent.js";

type AgentFactory = (spec: InlineAgentSpec) => AgentProcessor;

const FACTORIES: Record<InlineAgentRoleKind, AgentFactory> = {
  scene_state: (spec) => new SceneStateAgent(spec),
  memory_selection: (spec) => new MemorySelectAgent(spec),
  worldbook_focus: (spec) => new WorldbookFocusAgent(spec),
  director: (spec) => new DirectorAgent(spec),
  agency_guard: (spec) => new PlayerAgencyGuardAgent(spec),
  continuity_verifier: (spec) => new ContinuityVerifierAgent(spec),
  style_verifier: (spec) => new StyleFidelityVerifierAgent(spec),
  state_proposal: (spec) => new StateProposalAgent(spec),
  memory_proposal: (spec) => new MemoryProposalAgent(spec),
};

export class BuiltinInlineAgentRegistry implements InlineAgentRegistry {
  resolve(spec: InlineAgentSpec): AgentProcessor | undefined {
    const factory = FACTORIES[spec.roleKind];
    if (!factory) {
      return undefined;
    }
    return factory(spec);
  }
}

export function createBuiltinInlineAgentRegistry(): InlineAgentRegistry {
  return new BuiltinInlineAgentRegistry();
}

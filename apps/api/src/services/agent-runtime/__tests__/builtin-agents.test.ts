import { describe, expect, it } from "vitest";

import { SceneStateAgent } from "../builtin/scene-state-agent.js";
import { MemorySelectAgent } from "../builtin/memory-select-agent.js";
import { WorldbookFocusAgent } from "../builtin/worldbook-focus-agent.js";
import { DirectorAgent } from "../builtin/director-agent.js";
import { PlayerAgencyGuardAgent } from "../builtin/player-agency-guard-agent.js";
import { ContinuityVerifierAgent } from "../builtin/continuity-verifier-agent.js";
import { StyleFidelityVerifierAgent } from "../builtin/style-fidelity-verifier-agent.js";
import { StateProposalAgent } from "../builtin/state-proposal-agent.js";
import { MemoryProposalAgent } from "../builtin/memory-proposal-agent.js";
import { createBuiltinInlineAgentRegistry } from "../builtin/index.js";
import type { AgentRunContext, InlineAgentSpec } from "../inline-agent-types.js";

function makeContext(
  spec: InlineAgentSpec,
  overrides: Partial<AgentRunContext> = {},
): AgentRunContext {
  return {
    sessionId: "sess_1",
    floorId: "floor_1",
    accountId: "acc_1",
    source:
   spec.phase === "pre_response"
        ? { kind: "respond_pre_response", sessionId: "sess_1", floorId: "floor_1" }
        : { kind: "respond_post_response", sessionId: "sess_1", floorId: "floor_1", pageId: "page_1" },
    spec,
    promptMode: "native",
    ...overrides,
  };
}

const preSpec = (id: string, roleKind: InlineAgentSpec["roleKind"]): InlineAgentSpec => ({
  id,
  roleKind,
  phase: "pre_response",
  stabilityHint: "floor",
  failurePolicy: "fail_open",
});

const postSpec = (id: string, roleKind: InlineAgentSpec["roleKind"]): InlineAgentSpec => ({
  id,
  roleKind,
  phase: "post_response",
  stabilityHint: "page",
  failurePolicy: "fail_open",
});

describe("builtin pre_response agents", () => {
  it("SceneStateAgent 无投影时返回空输出", () => {
    const spec = preSpec("inline:scene_state", "scene_state");
    const agent = new SceneStateAgent(spec);
 const output = agent.execute(undefined, makeContext(spec));
    expect(output.contributor).toBeUndefined();
  });

  it("SceneStateAgent 有场景投影时产出 scene_state contributor", () => {
    const spec = preSpec("inline:scene_state", "scene_state");
    const agent = new SceneStateAgent(spec);
    const output = agent.execute(
      undefined,
      makeContext(spec, {
        firstPartyStateContext: {
          scene: {
            present: true,
            source: "floor",
            floorId: "floor_1",
            updatedAt: 1,
            schemaVersion: 1,
            scene: { generatedText: "A quiet tavern at dusk.", summaries: [] },
          },
          world: null,
        } as unknown as AgentRunContext["firstPartyStateContext"],
      }),
    );
    expect(output.contributor?.kind).toBe("scene_state");
    expect(output.contributor?.promptRenderable?.content).toContain("A quiet tavern");
  });

  it("MemorySelectAgent把已选记忆视为 required", () => {
    const spec = preSpec("inline:memory_selection", "memory_selection");
    const agent = new MemorySelectAgent(spec);
    const output = agent.execute(
      undefined,
      makeContext(spec, {
        memoryTrace: {
          selectedItems: [
            { memoryId: "m1", scope: "chat", kind: "fact" },
            { memoryId: "m2", scope: "chat", kind: "summary" },
          ],
        } as unknown as AgentRunContext["memoryTrace"],
      }),
    );
    expect(output.contributor?.kind).toBe("memory_selection");
    expect(output.memorySelectionOverride?.required).toEqual(["m1", "m2"]);
  });

  it("WorldbookFocusAgent hint-only：全部命中视为 required", () => {
    const spec = preSpec("inline:worldbook_focus", "worldbook_focus");
    const agent = new WorldbookFocusAgent(spec);
    const output = agent.execute(
      undefined,
      makeContext(spec, { worldbookHits: [{ id: "w1", name: "Tavern" }, { id: "w2" }] }),
    );
    expect(output.worldbookSelectionOverride?.required).toEqual(["w1", "w2"]);
    expect(output.contributor?.kind).toBe("worldbook_focus");
  });

  it("DirectorAgent 产出 director_hint contributor", () => {
    const spec = preSpec("inline:director", "director");
    const agent = new DirectorAgent(spec);
    const output = agent.execute(undefined, makeContext(spec));
    expect(output.contributor?.kind).toBe("director_hint");
  });

  it("PlayerAgencyGuard(pre) 产出 narrator 硬约束", () => {
    const spec = preSpec("inline:agency_guard_pre", "agency_guard");
    const agent = new PlayerAgencyGuardAgent(spec);
    const output = agent.execute(undefined, makeContext(spec));
expect(output.contributor?.kind).toBe("agency_guard");
    expect(output.narratorConstraints?.length).toBeGreaterThan(0);
  });
});

describe("builtin post_response agents", () => {
  it("ContinuityVerifier 对空正文产出 finding", () => {
    const spec = postSpec("inline:continuity_verifier", "continuity_verifier");
    const agent = new ContinuityVerifierAgent(spec);
    const output = agent.execute(undefined, makeContext(spec, { narratorText: "   " }));
    expect(output.findings?.[0]?.code).toBe("continuity_empty_output");
  });

  it("StyleFidelityVerifier 检测 meta 泄漏", () => {
    const spec = postSpec("inline:style_verifier", "style_verifier");
    const agent = new StyleFidelityVerifierAgent(spec);
    const output = agent.execute(
      undefined,
      makeContext(spec, { narratorText: "As an AI, I cannot do that." }),
    );
    expect(output.findings?.[0]?.code).toBe("style_meta_leak");
  });

  it("PlayerAgencyGuard(post) 检测替玩家行动", () => {
    const spec = postSpec("inline:agency_guard_post", "agency_guard");
    const agent = new PlayerAgencyGuardAgent(spec);
    const output = agent.execute(undefined, makeContext(spec, { narratorText: "I decide to leave." }));
    expect(output.findings?.[0]?.code).toBe("agency_first_person_action");
  });

  it("StateProposalAgent 仅在显式标记时提取 proposal", () => {
    const spec = postSpec("inline:state_proposal", "state_proposal");
    const agent = new StateProposalAgent(spec);
    const empty = agent.execute(undefined, makeContext(spec, { narratorText: "plain text" }));
    expect(empty.stateProposals ?? []).toHaveLength(0);
    const extracted = agent.execute(
   undefined,
      makeContext(spec, { narratorText: "<state>location=tavern</state>" }),
    );
    expect(extracted.stateProposals).toHaveLength(1);
  });

  it("MemoryProposalAgent 仅在显式摘要标记时提取 proposal", () => {
    const spec = postSpec("inline:memory_proposal", "memory_proposal");
    const agent = new MemoryProposalAgent(spec);
    const extracted = agent.execute(
      undefined,
      makeContext(spec, { narratorText:"<summary>The hero arrived.</summary>" }),
    );
    expect(extracted.memoryProposals).toHaveLength(1);
    expect(extracted.memoryProposals?.[0]?.kind).toBe("summary");
  });
});

describe("createBuiltinInlineAgentRegistry", () => {
  it("能解析所有内建角色类型", () => {
    const registry = createBuiltinInlineAgentRegistry();
    const roleKinds: InlineAgentSpec["roleKind"][] = [
      "scene_state",
      "memory_selection",
      "worldbook_focus",
      "director",
      "agency_guard",
      "continuity_verifier",
      "style_verifier",
      "state_proposal",
      "memory_proposal",
    ];
   for (const roleKind of roleKinds) {
      const processor =registry.resolve(preSpec(`inline:${roleKind}`, roleKind));
      expect(processor).toBeDefined();
    }
  });
});

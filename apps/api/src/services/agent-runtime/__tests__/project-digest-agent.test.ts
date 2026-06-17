import { describe, expect, it } from "vitest";

import {
  ProjectDigestAgent,
  DeterministicProjectDigestSummarizer,
  PROJECT_DIGEST_AGENT_KEY,
} from "../builtin/project-digest-agent.js";
import { BackgroundAgentExecutorError } from "../background-agent-executor.js";
import type { BackgroundAgentExecutionContext } from "../background-agent-types.js";
import type { AgentScopeKind } from "../../agent-scope-types.js";

function buildContext(overrides: Partial<BackgroundAgentExecutionContext> = {}): BackgroundAgentExecutionContext {
  return {
    db: {} as BackgroundAgentExecutionContext["db"],
    accountId: "acc_1",
    workspaceId: "ws_1",
    projectId: "proj_1",
    agentTypeId: "agt_1",
    agentBindingId: "agb_1",
    scopeKind: "project" as AgentScopeKind,
    resolvedConfig: {
      llmProfileId: null,
      toolPolicyId: null,
      mcpBindings: [],
      eventSubscriptions: [],
      grants: {},
      allowedOutputTargets: ["derived_output"],
    },
    lineage: { rootRunId: "job_1" },
    dryRun: false,
    inputJson: { events: [{ id: "e1" }, { id: "e2" }, { id: "e3" }] },
    sourceEventId: null,
    actorClientId: null,
    ...overrides,
  };
}

describe("ProjectDigestAgent", () => {
  it("exposes the project.digest agent key", () => {
    expect(new ProjectDigestAgent().agentKey).toBe(PROJECT_DIGEST_AGENT_KEY);
  });

  it("produces a derived_output descriptor on the real path", async () => {
    const agent = new ProjectDigestAgent();
    const result = await agent.run(buildContext());

    expect(result.status).toBe("completed");
    expect(result.outputs).toHaveLength(1);
    const output = result.outputs[0];
    expect(output?.target).toBe("derived_output");
    if (output && output.target === "derived_output") {
      expect(output.projectId).toBe("proj_1");
expect(output.domain).toBe("project_digest");
      expect(output.value).toMatchObject({ event_count: 3 });
    }
    expect(result.traceDraft.deliveryTarget).toBe("derived_output");
  });

  it("only plans on dry_run and produces no outputs", async () => {
 const agent = new ProjectDigestAgent();
    const result = await agent.run(buildContext({ dryRun: true }));

    expect(result.status).toBe("skipped");
    expect(result.outputs).toHaveLength(0);
  });

  it("rejects non-project scope", async () => {
    const agent = new ProjectDigestAgent();
    await expect(agent.run(buildContext({ scopeKind: "workspace" as AgentScopeKind }))).rejects.toBeInstanceOf(
      BackgroundAgentExecutorError,
    );
  });

  it("rejects when derived_output is not allowed", async () => {
    const agent = new ProjectDigestAgent();
    await expect(
      agent.run(
        buildContext({
          resolvedConfig: {
            llmProfileId: null,
            toolPolicyId: null,
            mcpBindings: [],
            eventSubscriptions: [],
            grants: {},
            allowedOutputTargets: ["project_inbox"],
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BackgroundAgentExecutorError);
  });

  it("uses an injected summarizer when provided", async () => {
    const agent = new ProjectDigestAgent({
      summarizer: {
        summarize: async () => ({ text: "custom", eventCount: 42 }),
      },
    });
    const result = await agent.run(buildContext());
    const output = result.outputs[0];
    if (output && output.target === "derived_output") {
      expect(output.value).toMatchObject({ text: "custom", event_count: 42 });
    }
  });

  it("default summarizer counts inputJson events deterministically", async () => {
    const summarizer = new DeterministicProjectDigestSummarizer();
    const summary = await summarizer.summarize({ projectId: "proj_1", inputJson: { events: [{}, {}] } });
    expect(summary.eventCount).toBe(2);
    expect(summary.text).toContain("proj_1");
  });
});

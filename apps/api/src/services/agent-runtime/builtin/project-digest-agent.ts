/**
 * ProjectDigestAgent：R4 第一批后台 Agent。
 *
 * scope_kind = project。对 committed-only 项目事件或入参做一次项目级摘要，
 * 产出一个 derived_output 写入描述。
 *
 * R4 第一批以可注入的 summarizer 承载摘要逻辑：
 *  - 默认实现是确定性摘要，便于稳定与测试，不调用 LLM。
 *  - 生产装配可注入基于现有 LLM 接入的 summarizer。
 *
 * 边界：
 *  - 只允许在 project scope 执行，否则抛 fatal。
 *  - 必须在 allowedOutputTargets含 derived_output 时才产出写入描述，否则抛 fatal。
 *  - dry_run = true只做计划解析与校验，不调用 summarizer，也不产出写入描述。
 */
import {
  BackgroundAgentExecutorError,
} from "../background-agent-executor.js";
import type {
  BackgroundAgentExecutionContext,
  BackgroundAgentHandler,
  BackgroundAgentResult,
} from "../background-agent-types.js";

export const PROJECT_DIGEST_AGENT_KEY = "project.digest";

/** 项目级摘要的输入快照。 */
export interface ProjectDigestSummarizerInput {
  projectId: string;
  inputJson: Record<string, unknown>;
}

/** 项目级摘要的产出。 */
export interface ProjectDigestSummary {
  text: string;
  eventCount: number;
}

export interface ProjectDigestSummarizer {
  summarize(input: ProjectDigestSummarizerInput): Promise<ProjectDigestSummary>;
}

/**
 * 默认确定性摘要器。
 *
 * 从 inputJson.events 读取事件数组，产出一个稳定的项目级摘要文本。
 * 不调用 LLM，便于在测试与无 LLM 装配下稳定运行。
 */
export class DeterministicProjectDigestSummarizer implements ProjectDigestSummarizer {
  async summarize(input: ProjectDigestSummarizerInput): Promise<ProjectDigestSummary> {
    const events = Array.isArray(input.inputJson.events) ? input.inputJson.events : [];
    const eventCount = events.length;
    const text = `Project ${input.projectId} digest: ${eventCount} committed event(s) reviewed.`;
    return { text, eventCount };
  }
}

export interface ProjectDigestAgentOptions {
  summarizer?: ProjectDigestSummarizer;
  domain?: string;
}

export class ProjectDigestAgent implements BackgroundAgentHandler {
  readonly agentKey = PROJECT_DIGEST_AGENT_KEY;

  private readonly summarizer: ProjectDigestSummarizer;
  private readonly domain: string;

  constructor(options: ProjectDigestAgentOptions = {}) {
    this.summarizer = options.summarizer ?? new DeterministicProjectDigestSummarizer();
    this.domain = options.domain ?? "project_digest";
  }

  async run(context: BackgroundAgentExecutionContext): Promise<BackgroundAgentResult> {
    if (context.scopeKind !== "project") {
      throw new BackgroundAgentExecutorError(
        "fatal",
        "background_agent_scope_kind_not_supported",
        `ProjectDigestAgent only runs in project scope, got '${context.scopeKind}'.`,
      );
    }

    const allowed = new Set(context.resolvedConfig.allowedOutputTargets);
    if (!allowed.has("derived_output")) {
      throw new BackgroundAgentExecutorError(
        "fatal",
        "background_agent_handler_not_registered",
        "ProjectDigestAgent requires 'derived_output' in allowed_output_targets.",
      );
    }

    // dry_run：只做计划解析与校验，不调用 summarizer，也不产出写入描述。
    if (context.dryRun) {
      return {
        status: "skipped",
        outputs: [],
        traceDraft: {
          deliveryTarget: "derived_output",
          purpose: "project_digest",
        ...(context.lineage ? { lineage: context.lineage }: {}),
        },
        summary: `project digest dry runplanned for project ${context.projectId}`,
      };
    }

    const digest = await this.summarizer.summarize({
      projectId: context.projectId,
      inputJson: context.inputJson,
    });

    return {
      status: "completed",
      outputs: [
        {
          target: "derived_output",
          actorAccountId: context.accountId,
          actor: {
            actorType: context.actorClientId ? "client" : "account",
            actorAccountId: context.accountId,
            actorClientId: context.actorClientId ?? null,
          },
          projectId: context.projectId,
          domain: this.domain,
          value: {
            text: digest.text,
            event_count: digest.eventCount,
            agent_type_id: context.agentTypeId,
            agent_binding_id: context.agentBindingId,
            source_event_id: context.sourceEventId,
          },
          status: "draft",
          ...(context.lineage.sourceSessionId ? { sourceSessionId: context.lineage.sourceSessionId } : {}),
          ...(context.lineage.sourceFloorId ? { sourceFloorId: context.lineage.sourceFloorId } : {}),
          ...(context.lineage.sourcePageId ? { sourcePageId: context.lineage.sourcePageId } : {}),
          lineage: context.lineage,
        },
      ],
      traceDraft: {
        deliveryTarget: "derived_output",
        purpose: "project_digest",
        lineage: context.lineage,
      },
      summary: `project digest produced for project ${context.projectId} (${digest.eventCount} event(s))`,
    };
  }
}

import { eq } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import { projects, sessions } from "../db/schema.js";
import {
  ProjectLlmProfileOverrideService,
  type ProjectLlmProfileOverrideRecord,
} from "./project-llm-profile-override-service.js";
import {
  ProjectMcpBindingService,
  type ProjectMcpBindingRecord,
} from "./project-mcp-binding-service.js";
import {
  ProjectToolPolicyOverrideService,
  type ProjectToolPolicyOverrideRecord,
} from "./project-tool-policy-override-service.js";

export type EffectiveConfigSource = "workspace" | "project" | "session";

export interface EffectiveLlmProfileView {
  source: EffectiveConfigSource;
  profileId: string | null;
  override: Record<string, unknown> | null;
}

export interface EffectiveToolPolicyView {
  source: EffectiveConfigSource;
  policyId: string | null;
  override: Record<string, unknown> | null;
}

export interface EffectiveMcpBindingView {
  source: EffectiveConfigSource;
  bindings: ProjectMcpBindingRecord[];
}

export interface ProjectEffectiveConfigView {
  projectId: string;
  workspaceId: string;
  llmProfile: EffectiveLlmProfileView;
  toolPolicies: {
    overrides: ProjectToolPolicyOverrideRecord[];
  };
  mcp: EffectiveMcpBindingView;
}

export interface SessionEffectiveConfigView extends ProjectEffectiveConfigView {
  sessionId: string;
  sessionOverrides: {
    llmProfile: EffectiveLlmProfileView | null;
  };
}

export type EffectiveConfigServiceErrorCode =
  | "project_not_found"
  | "session_not_found"
  | "session_project_scope_missing";

export class EffectiveConfigServiceError extends Error {
  constructor(
    public readonly statusCode: 404 | 409,
    public readonly code: EffectiveConfigServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EffectiveConfigServiceError";
  }
}

export class EffectiveConfigService {
  private readonly llmOverrideService: ProjectLlmProfileOverrideService;
  private readonly mcpService: ProjectMcpBindingService;
  private readonly toolOverrideService: ProjectToolPolicyOverrideService;

  constructor(
    private readonly db: AppDb | DbExecutor,
    options: {
      llmOverrideService?: ProjectLlmProfileOverrideService;
      mcpService?: ProjectMcpBindingService;
      toolOverrideService?: ProjectToolPolicyOverrideService;
    } = {},
  ) {
    this.llmOverrideService = options.llmOverrideService ?? new ProjectLlmProfileOverrideService(db);
    this.mcpService = options.mcpService ?? new ProjectMcpBindingService(db);
    this.toolOverrideService = options.toolOverrideService ?? new ProjectToolPolicyOverrideService(db);
  }

  forProject(input: { projectId: string; accountId: string }): ProjectEffectiveConfigView {
    const project = this.db
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1)
      .all()[0];

    if (!project) {
      throw new EffectiveConfigServiceError(404, "project_not_found", `Project not found: ${input.projectId}`);
    }

    const llmOverride = this.llmOverrideService.getActive(input);
    const mcpBindings = this.mcpService.listByProject(input);
    const toolOverrides = this.toolOverrideService.listByProject(input);

    return {
      projectId: project.id,
      workspaceId: project.workspaceId,
      llmProfile: viewLlm(llmOverride),
      toolPolicies: {
        overrides: toolOverrides,
      },
      mcp: {
        source: mcpBindings.length > 0 ? "project" : "workspace",
        bindings: mcpBindings,
      },
    };
  }

  forSession(input: { sessionId: string; accountId: string }): SessionEffectiveConfigView {
    const session = this.db
      .select({
        id: sessions.id,
        projectId: sessions.projectId,
      })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .limit(1)
      .all()[0];

    if (!session) {
      throw new EffectiveConfigServiceError(404, "session_not_found", `Session not found: ${input.sessionId}`);
    }
    if (!session.projectId) {
      throw new EffectiveConfigServiceError(
        409,
        "session_project_scope_missing",
        `Session has no Project scope: ${input.sessionId}`,
      );
    }

    const projectView = this.forProject({ projectId: session.projectId, accountId: input.accountId });

    return {
      ...projectView,
      sessionId: input.sessionId,
      sessionOverrides: {
        llmProfile: null,
      },
    };
  }
}

function viewLlm(record: ProjectLlmProfileOverrideRecord | null): EffectiveLlmProfileView {
  if (!record) {
    return { source: "workspace", profileId: null, override: null };
  }
  return {
    source: "project",
    profileId: record.baseProfileId,
    override: record.overrideJson,
  };
}

import { eq } from "drizzle-orm";
import type { ToolCallTransportKind, ToolCallTransportReasonCode } from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { projects, sessions } from "../db/schema.js";
import { parseJsonField } from "../lib/http.js";
import type { LlmInstanceCapabilities } from "../lib/llm-capabilities.js";
import { LlmInstanceService } from "./llm-instance-service.js";
import {
  listToolCallTransportsForPromptMode,
  readToolCallTransportOverride,
  ToolCallTransportResolver,
} from "./chat/tool-call-transport-resolver.js";
import {
  resolvePromptModeDetails,
  type PromptMode,
  type SessionMetadata,
} from "./prompt-assembler.js";
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
import { SessionEffectiveToolPolicyProvider } from "./tooling/shared/session-effective-tool-policy-provider.js";
import {
  readNativePromptBridgeWorkspaceDefault,
  resolveNativePromptBridgeDecision,
  type NativePromptBridgeDecision,
} from "./agent-runtime/native-prompt-bridge.js";

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

export interface EffectiveToolTransportView {
  available: Array<Exclude<ToolCallTransportKind, "none">>;
  selected: ToolCallTransportKind;
  reasonCode: ToolCallTransportReasonCode;
  capabilities: {
    supportsFunctionCall: boolean;
    supportsToolChoice: boolean;
    supportsStreamingToolCall: boolean;
  };
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

/**
 * NG2-BRIDGE：native prompt 主链承载灰度的有效视图。
 *
 * 分层 Workspace 默认（env）→ Project → Session；`source` 标识本次承载决策由哪层决定。
 */
export interface EffectiveNativePromptBridgeView extends NativePromptBridgeDecision {
  source: EffectiveConfigSource;
}

export interface SessionEffectiveConfigView extends ProjectEffectiveConfigView {
  sessionId: string;
  sessionOverrides: {
    llmProfile: EffectiveLlmProfileView | null;
  };
  toolTransport: EffectiveToolTransportView;
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
  private readonly llmInstanceService: LlmInstanceService;
  private readonly toolTransportResolver: ToolCallTransportResolver;
  private readonly sessionToolPolicyProvider: SessionEffectiveToolPolicyProvider;

  constructor(
    private readonly db: AppDb | DbExecutor,
    options: {
      llmOverrideService?: ProjectLlmProfileOverrideService;
      mcpService?: ProjectMcpBindingService;
      toolOverrideService?: ProjectToolPolicyOverrideService;
      llmInstanceService?: LlmInstanceService;
      toolTransportResolver?: ToolCallTransportResolver;
      sessionToolPolicyProvider?: SessionEffectiveToolPolicyProvider;
    } = {},
  ) {
    this.llmOverrideService = options.llmOverrideService ?? new ProjectLlmProfileOverrideService(db);
    this.mcpService = options.mcpService ?? new ProjectMcpBindingService(db);
    this.toolOverrideService = options.toolOverrideService ?? new ProjectToolPolicyOverrideService(db);
    this.llmInstanceService = options.llmInstanceService ?? new LlmInstanceService(db as AppDb);
    this.toolTransportResolver = options.toolTransportResolver ?? new ToolCallTransportResolver();
    this.sessionToolPolicyProvider = options.sessionToolPolicyProvider ?? new SessionEffectiveToolPolicyProvider(db as AppDb);
  }

  /**
   * NG2-BRIDGE（阶段 13）：解析 native prompt 主链承载灰度决策。
   *
   * 分层 Workspace 默认（env `NATIVE_PROMPT_SYSTEM_GRAPH_CARRIER` / `..._SHADOW`）→ Project →
   * Session，后层覆盖前层。缺省退化为 composite + shadow off（与既有行为一致）。
   * 把承载决策设回 composite 即配置级一键回退，不回滚代码。静态方法，不依赖 DB。
   */
  static resolveNativePromptBridge(
    input: {
      project?: Partial<NativePromptBridgeDecision>;
      session?: Partial<NativePromptBridgeDecision>;
      env?: NodeJS.ProcessEnv;
    } = {},
  ): EffectiveNativePromptBridgeView {
    const workspace = readNativePromptBridgeWorkspaceDefault(input.env);
    const decision = resolveNativePromptBridgeDecision({
      workspace,
      project: input.project,
      session: input.session,
    });
    const source: EffectiveConfigSource =
      input.session?.carrier !== undefined
        ? "session"
        : input.project?.carrier !== undefined
          ? "project"
          : "workspace";
    return { ...decision, source };
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

  async forSession(input: { sessionId: string; accountId: string }): Promise<SessionEffectiveConfigView> {
    const session = this.db
      .select({
        id: sessions.id,
        projectId: sessions.projectId,
        promptMode: sessions.promptMode,
        metadataJson: sessions.metadataJson,
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
    const toolTransport = await this.buildSessionToolTransportView({
      sessionId: input.sessionId,
      accountId: input.accountId,
      promptMode: session.promptMode,
      metadataJson: session.metadataJson,
    });

    return {
      ...projectView,
      sessionId: input.sessionId,
      sessionOverrides: {
        llmProfile: null,
      },
      toolTransport,
    };
  }

  private async buildSessionToolTransportView(input: {
    sessionId: string;
    accountId: string;
    promptMode: PromptMode | null;
    metadataJson: string | null;
  }): Promise<EffectiveToolTransportView> {
    const resolvedSlots = await this.llmInstanceService.resolveConfigs(input.accountId, input.sessionId);
    const narratorSlot = resolvedSlots.find((slot) => slot.slot === "narrator");
    const capabilities = narratorSlot?.capabilities ?? defaultEffectiveToolTransportCapabilities();
    const metadata = parseSessionMetadata(input.metadataJson);
    const effectivePromptMode = resolvePromptModeDetails(
      { promptMode: input.promptMode },
      metadata,
    ).effectivePromptMode;
    const toolPolicy = await this.sessionToolPolicyProvider.resolve({
      sessionId: input.sessionId,
      accountId: input.accountId,
    });
    const selection = this.toolTransportResolver.resolve({
      sessionId: input.sessionId,
      promptMode: effectivePromptMode,
      explicitTransport: readToolCallTransportOverride(input.metadataJson),
      toolsEnabled: toolPolicy?.effectivePermissions?.enabled === true,
      capabilities,
    });

    return {
      available: listToolCallTransportsForPromptMode(effectivePromptMode),
      selected: selection.transport,
      reasonCode: selection.reasonCode,
      capabilities: {
        supportsFunctionCall: capabilities.supportsFunctionCall,
        supportsToolChoice: capabilities.supportsToolChoice,
        supportsStreamingToolCall: capabilities.supportsStreamingToolCall,
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

function parseSessionMetadata(raw: string | null): SessionMetadata {
  const metadata = parseJsonField(raw);
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as SessionMetadata
    : {};
}

function defaultEffectiveToolTransportCapabilities(): LlmInstanceCapabilities {
  return {
    supportsFunctionCall: true,
    supportsToolChoice: false,
    supportsStreamingToolCall: false,
    unsupportedGenerationParams: [],
  };
}

import { and, eq, isNull, or } from "drizzle-orm";
import type { ToolCallTransportKind, ToolCallTransportReasonCode } from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  llmProfileBindings,
  llmProfiles,
  mcpServerConfigs,
  projects,
  sessions,
} from "../db/schema.js";
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
import {
  readCompatPromptBridgeWorkspaceDefault,
  resolveCompatPromptBridgeDecision,
  type CompatPromptBridgeDecision,
} from "./agent-runtime/compat-prompt-bridge.js";

/** global scope 绑定使用的固定 scopeId（与 LlmProfileService 一致）。 */
const GLOBAL_LLM_SCOPE_ID = "global";
/** effective config 只解释通配槽位（'*'）的默认绑定，逐 slot 解析仍走 LlmProfileService。 */
const DEFAULT_LLM_INSTANCE_SLOT = "*";

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

export interface EffectiveMcpServerSummary {
  mcpServerId: string;
  name: string;
  transport: "stdio" | "http";
  enabled: boolean;
  toolPrefix: string | null;
}

export interface EffectiveMcpBindingView {
  source: EffectiveConfigSource;
  bindings: ProjectMcpBindingRecord[];
  /**
   * WP-C1：Workspace 默认 MCP 来源（account + workspace 下启用的 MCP server 摘要）。
   * 仅含非敏感标识字段，不含 config / secret，用于让 source: "workspace" 真正有据可查。
   */
  workspaceServers: EffectiveMcpServerSummary[];
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

/**
 * CG11：compat prompt 主链承载灰度的有效视图。
 *
 * 分层 Workspace 默认（env）→ Project → Session；`source` 标识本次承载决策由哪层决定。
 */
export interface EffectiveCompatPromptBridgeView extends CompatPromptBridgeDecision {
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

  /**
   * CG11：解析 compat prompt 主链承载灰度决策。
   *
   * 与 native 同构地分层 Workspace 默认（env `COMPAT_PROMPT_SYSTEM_GRAPH_CARRIER` / `..._SHADOW`）→
   * Project → Session，后层覆盖前层。缺省退化为 prompt_mode + shadow off（与既有行为一致）。
   * 把承载决策设回 prompt_mode 即配置级一键回退，不回滚代码。静态方法，不依赖 DB。
   */
  static resolveCompatPromptBridge(
    input: {
      project?: Partial<CompatPromptBridgeDecision>;
      session?: Partial<CompatPromptBridgeDecision>;
      env?: NodeJS.ProcessEnv;
    } = {},
  ): EffectiveCompatPromptBridgeView {
    const workspace = readCompatPromptBridgeWorkspaceDefault(input.env);
    const decision = resolveCompatPromptBridgeDecision({
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
      llmProfile: this.resolveProjectLlmProfile({
        accountId: input.accountId,
        workspaceId: project.workspaceId,
        projectOverride: llmOverride,
      }),
      toolPolicies: {
        overrides: toolOverrides,
      },
      mcp: {
        source: mcpBindings.length > 0 ? "project" : "workspace",
        bindings: mcpBindings,
        workspaceServers: this.listWorkspaceMcpServers({
          accountId: input.accountId,
          workspaceId: project.workspaceId,
        }),
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
        llmProfile: this.resolveSessionLlmOverride({
          accountId: input.accountId,
          workspaceId: projectView.workspaceId,
          sessionId: input.sessionId,
        }),
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

  /**
   * WP-C1：解析 Project 层 LLM profile 视图。
   *
   * 有 Project override 时来源为 project；否则回退到 Workspace 默认（global binding 的 '*' 槽位），
   * 让 source: "workspace" 真正对应已绑定的默认 profile，而不是恒为 null 的占位。
   */
  private resolveProjectLlmProfile(input: {
    accountId: string;
    workspaceId: string;
    projectOverride: ProjectLlmProfileOverrideRecord | null;
  }): EffectiveLlmProfileView {
    if (input.projectOverride) {
      return {
        source: "project",
        profileId: input.projectOverride.baseProfileId,
        override: input.projectOverride.overrideJson,
      };
    }
    const workspaceDefault = this.resolveBoundLlmProfile({
      accountId: input.accountId,
      workspaceId: input.workspaceId,
      scope: "global",
      scopeId: GLOBAL_LLM_SCOPE_ID,
    });
    return {
      source: "workspace",
      profileId: workspaceDefault?.profileId ?? null,
      override: workspaceDefault?.override ?? null,
    };
  }

  /**
   * WP-C1：解析 Session 层 LLM override 视图。
   *
   * 读取 session scope 的 '*' 槽位绑定；没有会话级绑定时返回 null（沿用 Project / Workspace 层）。
   */
  private resolveSessionLlmOverride(input: {
    accountId: string;
    workspaceId: string;
    sessionId: string;
  }): EffectiveLlmProfileView | null {
    const bound = this.resolveBoundLlmProfile({
      accountId: input.accountId,
      workspaceId: input.workspaceId,
      scope: "session",
      scopeId: input.sessionId,
    });
    if (!bound) {
      return null;
    }
    return { source: "session", profileId: bound.profileId, override: bound.override };
  }

  /**
   * 读取某 scope 下 '*' 槽位的活跃 profile 绑定。
   *
   * 与 LlmProfileService 的 workspace 回退规则保持一致（workspace 命中或 null workspace 的历史行），
   * 但不解密 secret，只取 profileId 与 generation params 作为 override 视图。
   */
  private resolveBoundLlmProfile(input: {
    accountId: string;
    workspaceId: string;
    scope: "global" | "session";
    scopeId: string;
  }): { profileId: string; override: Record<string, unknown> | null } | null {
    const row = this.db
      .select({
        profileId: llmProfileBindings.profileId,
        paramsJson: llmProfileBindings.paramsJson,
      })
      .from(llmProfileBindings)
      .innerJoin(llmProfiles, eq(llmProfileBindings.profileId, llmProfiles.id))
      .where(and(
        eq(llmProfileBindings.scope, input.scope),
        eq(llmProfileBindings.scopeId, input.scopeId),
        eq(llmProfileBindings.instanceSlot, DEFAULT_LLM_INSTANCE_SLOT),
        eq(llmProfileBindings.accountId, input.accountId),
        eq(llmProfiles.accountId, input.accountId),
        eq(llmProfiles.status, "active"),
        or(eq(llmProfileBindings.workspaceId, input.workspaceId), isNull(llmProfileBindings.workspaceId)),
        or(eq(llmProfiles.workspaceId, input.workspaceId), isNull(llmProfiles.workspaceId)),
      ))
      .limit(1)
      .all()[0];
    if (!row) {
      return null;
    }
    return { profileId: row.profileId, override: parseOverrideJson(row.paramsJson) };
  }

  /**
   * WP-C1：列出 Workspace 层启用的 MCP server 摘要（account + workspace，enabled）。
   * 仅返回非敏感标识字段，作为 source: "workspace" 的真实来源。
   */
  private listWorkspaceMcpServers(input: {
    accountId: string;
    workspaceId: string;
  }): EffectiveMcpServerSummary[] {
    return this.db
      .select({
        mcpServerId: mcpServerConfigs.id,
        name: mcpServerConfigs.name,
        transport: mcpServerConfigs.transport,
        enabled: mcpServerConfigs.enabled,
        toolPrefix: mcpServerConfigs.toolPrefix,
      })
      .from(mcpServerConfigs)
      .where(and(
        eq(mcpServerConfigs.accountId, input.accountId),
        eq(mcpServerConfigs.enabled, 1),
        or(eq(mcpServerConfigs.workspaceId, input.workspaceId), isNull(mcpServerConfigs.workspaceId)),
      ))
      .all()
      .map((row) => ({
        mcpServerId: row.mcpServerId,
        name: row.name,
        transport: row.transport,
        enabled: row.enabled === 1,
        toolPrefix: row.toolPrefix ?? null,
      }));
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

/**
 * 把 llm profile binding 的 params_json 解析成 generation params override 视图。
 *
 * 空列（null/空串）或非对象值返回 null，表示该绑定没有 override；
 * 合法 JSON 对象原样作为 Record 返回，供下游合并进 generationParams。
 */
function parseOverrideJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  const parsed = parseJsonField(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
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

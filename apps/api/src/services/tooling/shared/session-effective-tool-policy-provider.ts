import type { InstanceSlot } from "@tavern/core";
import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../../db/client.js";
import { sessions } from "../../../db/schema.js";
import { parseJsonField } from "../../../lib/http.js";
import { ProjectAgentBindingService } from "../../project-agent-binding-service.js";
import { ProjectToolPolicyOverrideService } from "../../project-tool-policy-override-service.js";
import {
  ToolPolicyPresetService,
  type ToolPolicyPresetOverlay,
} from "../../tool-policy-preset-service.js";
import {
  normalizeSessionBaseToolPermissionsRecord,
  resolveEffectiveToolPermissions,
  type ToolPermissionOverlay,
} from "./permission-overlay.js";
import {
  resolveEffectiveToolPolicy,
  resolveToolPolicySelectorFromAgentBinding,
  type EffectiveToolPolicyResolution,
} from "./tool-policy-resolution.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readSelectedAgentBindingId(metadata: Record<string, unknown>): string | null {
  const direct = normalizeNonEmptyString(metadata.agent_binding_id);
  if (direct) {
    return direct;
  }

  const selector = metadata.tool_policy_selector;
  if (!isRecord(selector)) {
    return null;
  }

  return normalizeNonEmptyString(selector.agent_binding_id);
}

/**
 * 工具预设 overlay 覆盖的实例 slot 全集。
 *
 * 预设以「工具名启用集」表达，需折算到会话运行时的每个 slot 白名单，
 * 使得仅预设启用的工具会暴露给 LLM。
 */
const PRESET_OVERLAY_SLOTS: readonly InstanceSlot[] = [
  "narrator",
  "director",
  "verifier",
  "memory",
];

/**
 * 将「工具策略预设 overlay（工具名表达）」折算为运行时权限 overlay。
 *
 * - `enabled`：预设启用任意工具即 true，否则 false（常规聊天预设 → 关闭工具）。
 * - `slotAllowList`：仅当启用工具时下发，把每个 slot 的白名单限制为预设启用集
 *   （与既有 slot 白名单做交集，语义保守）。
 * - `allowIrreversible` / `maxCallsPerTurn`：透传预设的会话级上限。
 */
function mapToolPolicyPresetOverlayToPermissionOverlay(
  overlay: ToolPolicyPresetOverlay,
): ToolPermissionOverlay {
  const enabled = overlay.enabledToolNames.length > 0;

  const permissionOverlay: ToolPermissionOverlay = {
    enabled,
    allowIrreversible: overlay.allowIrreversible,
    ...(overlay.maxCallsPerTurn !== undefined ? { maxCallsPerTurn: overlay.maxCallsPerTurn } : {}),
  };

  if (enabled) {
    const slotAllowList: Partial<Record<InstanceSlot, string[]>> = {};
    for (const slot of PRESET_OVERLAY_SLOTS) {
      slotAllowList[slot] = [...overlay.enabledToolNames];
    }
    permissionOverlay.slotAllowList = slotAllowList;
  }

  return permissionOverlay;
}

export class SessionEffectiveToolPolicyProvider {
  private readonly bindingService: ProjectAgentBindingService;
  private readonly overrideService: ProjectToolPolicyOverrideService;
  private readonly presetService: ToolPolicyPresetService;

  constructor(private readonly db: AppDb) {
    this.bindingService = new ProjectAgentBindingService(db);
    this.overrideService = new ProjectToolPolicyOverrideService(db);
    this.presetService = new ToolPolicyPresetService(db);
  }

  async resolve(input: {
    sessionId: string;
    accountId: string;
  }): Promise<EffectiveToolPolicyResolution | null> {
    const [session] = await this.db
      .select({
        projectId: sessions.projectId,
        workspaceId: sessions.workspaceId,
        metadataJson: sessions.metadataJson,
        toolPresetKey: sessions.toolPresetKey,
      })
      .from(sessions)
      .where(and(
        eq(sessions.id, input.sessionId),
        eq(sessions.accountId, input.accountId),
      ))
      .limit(1);

    if (!session) {
      return null;
    }

    const metadata = isRecord(parseJsonField(session.metadataJson))
      ? parseJsonField(session.metadataJson) as Record<string, unknown>
      : {};
    const sessionBase = normalizeSessionBaseToolPermissionsRecord(metadata.tool_permissions);

    let resolution: EffectiveToolPolicyResolution;
    if (!session.projectId) {
      resolution = resolveEffectiveToolPolicy({ sessionBase });
    } else {
      let selector = null;
      const selectedAgentBindingId = readSelectedAgentBindingId(metadata);
      if (selectedAgentBindingId) {
        try {
          const binding = this.bindingService.resolveEffective({
            id: selectedAgentBindingId,
            accountId: input.accountId,
          });

          if (
            binding.binding.projectId === session.projectId
            && binding.binding.status === "enabled"
          ) {
            selector = resolveToolPolicySelectorFromAgentBinding({
              toolPolicyId: binding.effective.toolPolicyId,
            });
          }
        } catch {
          selector = null;
        }
      }

      resolution = resolveEffectiveToolPolicy({
        sessionBase,
        selector,
        projectOverrides: this.overrideService.listByProject({
          projectId: session.projectId,
          accountId: input.accountId,
        }),
      });
    }

    // SC2-10（批次四）：会话若绑定工具策略预设，则在既有解析之上叠加预设 overlay。
    // 未绑定预设（toolPresetKey 为 NULL）的存量会话完全跳过此步，行为不变。
    const presetKey = normalizeNonEmptyString(session.toolPresetKey);
    if (!presetKey) {
      return resolution;
    }

    return this.applyToolPresetOverlay(resolution, {
      presetKey,
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      accountId: input.accountId,
    });
  }

  /**
   * 将会话绑定的工具策略预设叠加到已解析的工具策略之上。
   *
   * 内置预设的默认值来自代码，即使会话不属于任何项目也可解析（项目级覆盖仅在有项目时生效）。
   * 未知/自定义预设在缺失作用域时解析失败 → 记录未生效层并回退原解析（惰性、安全）。
   */
  private applyToolPresetOverlay(
    resolution: EffectiveToolPolicyResolution,
    input: {
      presetKey: string;
      workspaceId: string | null;
      projectId: string | null;
      accountId: string;
    },
  ): EffectiveToolPolicyResolution {
    let overlay: ToolPolicyPresetOverlay;
    try {
      overlay = this.presetService.resolveOverlay(
        {
          workspaceId: input.workspaceId ?? "",
          projectId: input.projectId ?? "",
          accountId: input.accountId,
        },
        input.presetKey,
      );
    } catch {
      return {
        ...resolution,
        layers: [
          ...resolution.layers,
          {
            kind: "session_tool_preset",
            source: "session_tool_preset",
            policyId: input.presetKey,
            applied: false,
            reason: "selector_not_found",
            unknownFields: [],
          },
        ],
      };
    }

    const permissionOverlay = mapToolPolicyPresetOverlayToPermissionOverlay(overlay);
    const effectivePermissions = resolveEffectiveToolPermissions(
      resolution.effectivePermissions ?? null,
      permissionOverlay,
    );

    return {
      ...resolution,
      effectivePermissions,
      layers: [
        ...resolution.layers,
        {
          kind: "session_tool_preset",
          source: "session_tool_preset",
          policyId: input.presetKey,
          applied: true,
          reason: "applied",
          unknownFields: [],
        },
      ],
    };
  }
}

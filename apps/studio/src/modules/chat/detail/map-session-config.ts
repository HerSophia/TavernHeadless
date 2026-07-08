/**
 * 会话信息面板（SC1-3）视图整形纯函数。
 *
 * 把 `SessionDetail`（主）+ `SessionEffectiveConfigView`（增强）+ `SessionScopeResult`（增强）
 * 整形为扁平、分组、可直接渲染的只读视图模型：基础 / 模型 / 提示词资产 / 角色与用户 / 有效配置 / scope。
 *
 * 约定：
 * - 缺失 / 空字符串统一归一为 `null`（占位标记），由组件映射到 i18n（如“未绑定 / 使用默认”）。
 * - `modelParams` 只做摘要（键数 + 前若干个键名），不展开原始大对象。
 * - `effective` / `scope` 缺省时对应分组返回 `null`（组件降级“暂不可用”）。
 * - 纯函数，不含任何 i18n / 副作用，便于单测。
 */
import type {
  SessionCharacterSyncPolicy,
  SessionDetail,
  SessionEffectiveConfigView,
  SessionScopeResult,
} from "../../../lib/chat";

/** modelParams 只暴露键数与前若干键名，避免撑爆面板。 */
const MAX_PARAM_KEYS = 8;

export type ModelParamsSummary = { count: number; keys: string[] } | null;

export type SessionConfigBasic = {
  title: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  promptMode: string | null;
  deepBinding: boolean | null;
  /** 会话级工具策略预设 key（SC2-10 / #b4-7b）；null = 未指定（沿用原策略）。 */
  toolPresetKey: string | null;
};

export type SessionConfigModel = {
  provider: string | null;
  name: string | null;
  paramsSummary: ModelParamsSummary;
};

export type SessionConfigAssets = {
  presetId: string | null;
  presetVersionId: string | null;
  worldbookProfileId: string | null;
  worldbookVersionId: string | null;
  regexProfileId: string | null;
  regexProfileVersionId: string | null;
};

export type SessionConfigCharacter = {
  name: string | null;
  hasGreeting: boolean | null;
  syncPolicy: SessionCharacterSyncPolicy;
  characterId: string | null;
  versionId: string | null;
};

export type SessionConfigUser = {
  name: string | null;
  userId: string | null;
};

export type SessionConfigIdentity = {
  character: SessionConfigCharacter | null;
  user: SessionConfigUser | null;
};

export type SessionConfigEffective = {
  llmProfileSource: SessionEffectiveConfigView["llmProfile"]["source"];
  llmProfileId: string | null;
  llmProfileOverridden: boolean;
  toolTransportSelected: SessionEffectiveConfigView["toolTransport"]["selected"];
  toolTransportAvailable: SessionEffectiveConfigView["toolTransport"]["available"];
  capabilities: SessionEffectiveConfigView["toolTransport"]["capabilities"];
};

export type SessionConfigScope = {
  workspaceId: string;
  projectId: string;
};

export type SessionConfigView = {
  basic: SessionConfigBasic;
  model: SessionConfigModel;
  assets: SessionConfigAssets;
  identity: SessionConfigIdentity;
  effective: SessionConfigEffective | null;
  scope: SessionConfigScope | null;
};

/** 把缺失 / 空白字符串统一归一为 null（占位标记）。 */
function normalize(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** modelParams 摘要：仅对普通对象产出键数 + 前若干键名；null / 非对象 / 数组返回 null。 */
function summarizeParams(params: unknown): ModelParamsSummary {
  if (params == null || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  const keys = Object.keys(params as Record<string, unknown>);
  return { count: keys.length, keys: keys.slice(0, MAX_PARAM_KEYS) };
}

/**
 * 整形会话详情 + 有效配置（可选）+ scope（可选）为只读分组视图模型。
 * `effective` / `scope` 缺省 → 对应分组为 null（组件降级）。
 */
export function mapSessionConfigView(
  detail: SessionDetail,
  effective?: SessionEffectiveConfigView | null,
  scope?: SessionScopeResult | null,
): SessionConfigView {
  const character = detail.characterBinding;
  const user = detail.userBinding;

  return {
    basic: {
      title: normalize(detail.title),
      status: detail.status,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      promptMode: normalize(detail.promptMode),
      deepBinding: detail.deepBinding ?? null,
      toolPresetKey: normalize(detail.toolPresetKey),
    },
    model: {
      provider: normalize(detail.modelProvider),
      name: normalize(detail.modelName),
      paramsSummary: summarizeParams(detail.modelParams),
    },
    assets: {
      presetId: normalize(detail.presetId),
      presetVersionId: normalize(detail.presetVersionId),
      worldbookProfileId: normalize(detail.worldbookProfileId),
      worldbookVersionId: normalize(detail.worldbookVersionId),
      regexProfileId: normalize(detail.regexProfileId),
      regexProfileVersionId: normalize(detail.regexProfileVersionId),
    },
    identity: {
      character: character
        ? {
            name: normalize(character.snapshotSummary?.name),
            hasGreeting: character.snapshotSummary?.hasGreeting ?? null,
            syncPolicy: character.syncPolicy,
            characterId: normalize(character.characterId),
            versionId: normalize(character.characterVersionId),
          }
        : null,
      user: user
        ? {
            name: normalize(user.snapshotSummary?.name),
            userId: normalize(user.userId),
          }
        : null,
    },
    effective: effective
      ? {
          llmProfileSource: effective.llmProfile.source,
          llmProfileId: normalize(effective.llmProfile.profileId),
          llmProfileOverridden: effective.llmProfile.override != null,
          toolTransportSelected: effective.toolTransport.selected,
          toolTransportAvailable: effective.toolTransport.available,
          capabilities: effective.toolTransport.capabilities,
        }
      : null,
    scope: scope ? { workspaceId: scope.workspaceId, projectId: scope.projectId } : null,
  };
}

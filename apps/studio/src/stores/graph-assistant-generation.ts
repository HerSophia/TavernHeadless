/**
 * 图助手生成参数 store（每回合生成参数 · 前端装配）。
 *
 * 承载图助手「每回合生成参数」中由前端装配的部分：思考（思维链）配置，以及
 * 温度、Top-P、最大输出 token、最大上下文 token 等可选覆盖参数。
 *
 * 设计取舍（见 reasoning 全链路设计 §3.1 / §3.8）：这些参数作为每回合请求参数，
 * 由前端按设置组装下发，不新增后端表；选择在本机持久化（localStorage），
 * 与「主题」「后端连接」的本地偏好范式一致。node / SSR 环境降级为内存态。
 *
 * 思考配置是「思考模式」与「努力级别」两个独立维度，可以共存（见用户反馈）：
 * - 思考模式：自适应（adaptive）/ 手动（manual）。
 * - 努力级别（Effort）：仅自适应下可选，default 表示不附加 effort（纯自适应）；
 *   low~max 表示自适应 + 努力级别。Anthropic Opus 4.6+ 仅支持自适应，自适应可与 effort 共存。
 * - 手动模式：填思考预算 token 数（thinking budget），Anthropic 下走手动思考预算。
 *
 * 这三维最终在 effortForRequest 里合并为一个 reasoning_effort 字符串下发；
 * 后端 core 的 mapParams/applyReasoningEffort 按 provider 解释该字符串：
 * - 纯数字 → thinking.type=enabled + budgetTokens（手动）。
 * - low/medium/high/xhigh/max → thinking.type=adaptive + effort（自适应 + 努力级别）。
 * - "adaptive" 或其他 → thinking.type=adaptive（纯自适应）。
 *
 * 每个可选数值参数都由一个开关（enabled）控制：关闭时不下发（由后端/模型默认值生效），
 * 开启时按设定值下发。
 */
import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";

import type {
  TemporaryConversationGenerationParams,
  TemporaryConversationReasoningEffort,
} from "../lib/temp-conversation";

/**
 * 思考模式：
 * - `adaptive`：自适应，由模型自行决定思考深度（Anthropic Opus 4.6+ 仅支持此模式）。
 * - `manual`：手动，按思考预算 token 数（thinking budget）下发。
 */
export type ReasoningThinkingMode = "adaptive" | "manual";

/**
 * 努力级别（Effort），仅在自适应模式下生效，可与自适应共存：
 * - `default`：不附加 effort（纯自适应，由模型自行决定）。
 * - `low` / `medium` / `high` / `xhigh` / `max`：自适应 + 努力级别
 *   （xhigh 仅 Opus 4.7、max 仅 Opus 4.6）。
 */
export type ReasoningEffortLevel = "default" | "low" | "medium" | "high" | "xhigh" | "max";

/** 可开关的数值参数状态：enabled 关闭时不下发，开启时按 value 下发。 */
export interface ToggleableNumberParam {
  enabled: boolean;
  value: number;
}

const STORAGE_KEY = "studio-graph-assistant-generation-params";
/** 旧版仅持久化推理强度档位的键，用于首次加载迁移。 */
const LEGACY_REASONING_KEY = "studio-graph-assistant-reasoning-effort";

/** Anthropic 手动思考预算的最小 token 数（与 core 约束一致）。 */
const MIN_THINKING_BUDGET =1024;

const VALID_THINKING_MODES: readonly ReasoningThinkingMode[] = ["adaptive", "manual"];
const VALID_EFFORT_LEVELS: readonly ReasoningEffortLevel[] = [
  "default",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** 各参数默认值（开关默认关闭）。 */
const DEFAULTS = {
  // 默认开启思考：从推荐体验出发默认开启。
  reasoningEnabled: true,
  // 默认自适应：Anthropic Opus 4.6+ 仅支持 adaptive。
  reasoningMode: "adaptive" as ReasoningThinkingMode,
  // 默认不附加 effort（纯自适应，最保守）。
  reasoningEffortLevel: "default" as ReasoningEffortLevel,
  // 手动模式默认思考预算。
  reasoningBudgetTokens: 16384,
  temperature: { enabled: false, value: 1 },
  topP: { enabled: false, value: 0.5 },
  maxOutputTokens: {enabled: false, value: 18192 },
  maxContextTokens: { enabled: false, value: 300000 },
};

interface PersistedState {
  reasoningEnabled: boolean;
  reasoningMode: ReasoningThinkingMode;
 reasoningEffortLevel: ReasoningEffortLevel;
  reasoningBudgetTokens: number;
  temperature: ToggleableNumberParam;
  topP: ToggleableNumberParam;
  maxOutputTokens: ToggleableNumberParam;
  maxContextTokens: ToggleableNumberParam;
}

/** 仅在浏览器环境拿到 localStorage；node 测试环境返回 null（持久化降级为 no-op）。 */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function isThinkingMode(value: unknown): value is ReasoningThinkingMode {
  return typeof value === "string" && (VALID_THINKING_MODES as readonly string[]).includes(value);
}

function isEffortLevel(value: unknown): value is ReasoningEffortLevel {
  return typeof value === "string" && (VALID_EFFORT_LEVELS as readonly string[]).includes(value);
}

function isToggleableNumber(value: unknown): value is ToggleableNumberParam {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ToggleableNumberParam).enabled === "boolean" &&
    typeof (value as ToggleableNumberParam).value === "number" &&
    Number.isFinite((value as ToggleableNumberParam).value)
  );
}

/** 思考配置的三维快照。 */
type ReasoningSnapshot = Pick<
  PersistedState,
  "reasoningEnabled" | "reasoningMode" | "reasoningEffortLevel" | "reasoningBudgetTokens"
>;

/**
 * 把旧版单一档位（off/adaptive/low~max/custom）迁移为新版三维结构。
 * custom为纯数字时迁移为手动思考预算，否则退化为纯自适应。
 */
function migrateLegacyMode(mode: string, custom: string): ReasoningSnapshot {
  const base: ReasoningSnapshot = {
    reasoningEnabled: DEFAULTS.reasoningEnabled,
    reasoningMode: DEFAULTS.reasoningMode,
    reasoningEffortLevel: DEFAULTS.reasoningEffortLevel,
    reasoningBudgetTokens: DEFAULTS.reasoningBudgetTokens,
  };
  switch (mode) {
    case "off":
      return { ...base, reasoningEnabled: false };
    case "adaptive":
      return { ...base, reasoningEnabled: true, reasoningMode: "adaptive", reasoningEffortLevel: "default" };
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return {
        ...base,
        reasoningEnabled: true,
        reasoningMode: "adaptive",
   reasoningEffortLevel: mode as ReasoningEffortLevel,
      };
    case "custom": {
      const parsed = Math.floor(Number(custom.trim()));
      if (Number.isFinite(parsed) && parsed >= MIN_THINKING_BUDGET) {
        return { ...base, reasoningEnabled: true, reasoningMode: "manual", reasoningBudgetTokens: parsed };
      }
      return { ...base, reasoningEnabled: true, reasoningMode: "adaptive", reasoningEffortLevel: "default" };
    }
    default:
      return base;
  }
}

function loadPersisted(): PersistedState {
  const fallback: PersistedState = {
    reasoningEnabled: DEFAULTS.reasoningEnabled,
    reasoningMode: DEFAULTS.reasoningMode,
    reasoningEffortLevel: DEFAULTS.reasoningEffortLevel,
    reasoningBudgetTokens: DEFAULTS.reasoningBudgetTokens,
    temperature: { ...DEFAULTS.temperature },
    topP: { ...DEFAULTS.topP },
    maxOutputTokens: { ...DEFAULTS.maxOutputTokens },
    maxContextTokens: { ...DEFAULTS.maxContextTokens },
  };

  const storage = safeStorage();
if (!storage) {
    return fallback;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (typeof parsed.reasoningEnabled === "boolean") {
        // 新版三维结构。
        fallback.reasoningEnabled = parsed.reasoningEnabled;
        if (isThinkingMode(parsed.reasoningMode)) {
          fallback.reasoningMode = parsed.reasoningMode;
        }
        if (isEffortLevel(parsed.reasoningEffortLevel)) {
          fallback.reasoningEffortLevel = parsed.reasoningEffortLevel;
        }
        if (typeof parsed.reasoningBudgetTokens === "number" && Number.isFinite(parsed.reasoningBudgetTokens)) {
          fallback.reasoningBudgetTokens = parsed.reasoningBudgetTokens;
        }
      } else if (typeof parsed.reasoningEffortMode === "string") {
        // 旧版单一档位结构迁移。
        const custom = typeof parsed.customReasoningEffort=== "string" ? parsed.customReasoningEffort : "";
        Object.assign(fallback, migrateLegacyMode(parsed.reasoningEffortMode, custom));
      }

      if (isToggleableNumber(parsed.temperature)) fallback.temperature = parsed.temperature;
   if (isToggleableNumber(parsed.topP)) fallback.topP = parsed.topP;
      if (isToggleableNumber(parsed.maxOutputTokens)) fallback.maxOutputTokens = parsed.maxOutputTokens;
      if (isToggleableNumber(parsed.maxContextTokens)) fallback.maxContextTokens = parsed.maxContextTokens;
      return fallback;
    }

    // 更旧版：仅保存了一个推理强度档位字符串。
    const legacy = storage.getItem(LEGACY_REASONING_KEY);
    if (legacy) {
      Object.assign(fallback, migrateLegacyMode(legacy, ""));
    }
  } catch {
 // 读取或解析失败按默认处理。
  }
  return fallback;
}

export const useGraphAssistantGenerationStore = defineStore("graph-assistant-generation", () => {
  const initial = loadPersisted();

  const reasoningEnabled = ref<boolean>(initial.reasoningEnabled);
  const reasoningMode = ref<ReasoningThinkingMode>(initial.reasoningMode);
  const reasoningEffortLevel = ref<ReasoningEffortLevel>(initial.reasoningEffortLevel);
  const reasoningBudgetTokens = ref<number>(initial.reasoningBudgetTokens);
  const temperature = reactive<ToggleableNumberParam>({ ...initial.temperature });
  const topP = reactive<ToggleableNumberParam>({ ...initial.topP });
  const maxOutputTokens = reactive<ToggleableNumberParam>({ ...initial.maxOutputTokens });
  const maxContextTokens = reactive<ToggleableNumberParam>({ ...initial.maxContextTokens });

  /** 持久化当前完整状态（失败静默降级为内存态）。 */
  function persist(): void {
    const storage = safeStorage();
    if (!storage) {
      return;
    }
    try {
      const snapshot: PersistedState = {
        reasoningEnabled: reasoningEnabled.value,
        reasoningMode: reasoningMode.value,
        reasoningEffortLevel: reasoningEffortLevel.value,
        reasoningBudgetTokens: reasoningBudgetTokens.value,
    temperature: { ...temperature },
        topP: { ...topP },
        maxOutputTokens: { ...maxOutputTokens },
        maxContextTokens: { ...maxContextTokens },
      };
      storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
    // 持久化失败不致命：保留内存态。
    }
  }

  /**
   * 下发给 respond 的 reasoning_effort 字符串（思考模式 + 努力级别合并）：
   * - 思考关闭 → undefined（不传 → 不覆盖，由模型默认决定）。
   * - 手动模式 → 思考预算 token 数（字符串）；预算非法（< 最小值）时不下发。
   * - 自适应 + 努力级别 default → "adaptive"（纯自适应）。
   * - 自适应 + low~max → 该努力级别字符串（core 解释为自适应 + effort）。
   */
  const effortForRequest = computed<TemporaryConversationReasoningEffort | undefined>(() => {
    if (!reasoningEnabled.value) {
      return undefined;
    }
    if (reasoningMode.value === "manual") {
      const budget = Math.floor(reasoningBudgetTokens.value);
      return Number.isFinite(budget) && budget >= MIN_THINKING_BUDGET ? String(budget) : undefined;
    }
    if (reasoningEffortLevel.value === "default") {
      return "adaptive";
    }
return reasoningEffortLevel.value;
  });

  /**
   * 本回合下发的完整生成参数：仅装配启用的字段；全部未启用时返回 undefined（不下发 generation_params）。
   */
  const generationParamsForRequest = computed<TemporaryConversationGenerationParams | undefined>(() => {
    const params: TemporaryConversationGenerationParams = {};
    const effort = effortForRequest.value;
    if (effort !== undefined) {
      params.reasoningEffort = effort;
    }
    if (temperature.enabled) {
      params.temperature = temperature.value;
    }
    if (topP.enabled) {
      params.topP = topP.value;
    }
    if (maxOutputTokens.enabled) {
      params.maxOutputTokens = maxOutputTokens.value;
    }
    if (maxContextTokens.enabled) {
      params.maxContextTokens = maxContextTokens.value;
    }
    return Object.keys(params).length > 0 ? params : undefined;
  });

  /** 切换思考总开关并持久化。 */
  function setReasoningEnabled(value: boolean): void {
    reasoningEnabled.value = value;
    persist();
  }

  /** 设置思考模式（自适应 / 手动）并持久化。 */
  function setReasoningMode(value: ReasoningThinkingMode): void {
    reasoningMode.value = value;
    persist();
  }

  /** 设置努力级别（Effort）并持久化。 */
  function setReasoningEffortLevel(value: ReasoningEffortLevel): void {
    reasoningEffortLevel.value = value;
    persist();
  }

  /** 设置手动思考预算 token 数并持久化（仅在 Number.isFinite 时写入）。 */
  function setReasoningBudgetTokens(value: number): void {
    if (Number.isFinite(value)) {
      reasoningBudgetTokens.value = value;
persist();
    }
  }

  /** 切换某个数值参数的启用开关并持久化。 */
  function setParamEnabled(param: ToggleableNumberParam, enabled: boolean): void {
    param.enabled = enabled;
    persist();
  }

  /**设置某个数值参数的值并持久化（仅在 Number.isFinite 时写入）。 */
  function setParamValue(param: ToggleableNumberParam, value: number): void {
 if (Number.isFinite(value)) {
      param.value = value;
      persist();
    }
  }

  return {
    reasoningEnabled,
    reasoningMode,
    reasoningEffortLevel,
    reasoningBudgetTokens,
    temperature,
    topP,
    maxOutputTokens,
    maxContextTokens,
    effortForRequest,
    generationParamsForRequest,
    setReasoningEnabled,
    setReasoningMode,
    setReasoningEffortLevel,
    setReasoningBudgetTokens,
    setParamEnabled,
    setParamValue,
  };
});

/**
 * 图助手工具调用协议偏好 store（每回合请求级偏好 · 前端装配）。
 *
 * 承载图助手「工具调用协议」三档选择：自动 / 原生 / 文本协议。
 *
 * 设计取舍（见原生 function calling 设计 §4.7）：协议偏好作为每回合请求参数，
 * 由前端按设置随每次发送下发，不新增后端表；选择在本机持久化（localStorage），
 * 与生成参数等本地偏好范式一致。node / SSR 环境降级为内存态。
 *
 * 三档语义：
 * - `auto`（默认）：按所选模型能力自动选——支持原生 function calling 则走原生，否则走文本协议。
 * - `native`：强制原生 function calling；模型不支持时后端安全回退到文本协议，不报错。
 * - `text_protocol`：强制文本协议。
 *
 * 下发约定：偏好为 `auto` 时不下发（后端缺省即 auto），仅在 native / text_protocol 时下发，
 * 与生成参数「仅下发非默认值」的范式一致。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { TemporaryConversationToolTransportPreference } from "../lib/temp-conversation";

/** 工具调用协议偏好三档。 */
export type ToolTransportPreference = TemporaryConversationToolTransportPreference;

const STORAGE_KEY = "studio-graph-assistant-tool-transport-preference";

const VALID_PREFERENCES: readonly ToolTransportPreference[] = ["auto", "native", "text_protocol"];

/** 仅在浏览器环境拿到 localStorage；node 测试环境返回 null（持久化降级为 no-op）。 */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function isPreference(value: unknown): value is ToolTransportPreference {
  return typeof value === "string" && (VALID_PREFERENCES as readonly string[]).includes(value);
}

function loadPersisted(): ToolTransportPreference {
  const storage = safeStorage();
 if (!storage) {
    return "auto";
  }
  try {
   const raw = storage.getItem(STORAGE_KEY);
    if (isPreference(raw)) {
      return raw;
    }
  } catch {
    // 读取失败按默认处理。
  }
  return "auto";
}

export const useGraphAssistantToolTransportStore = defineStore("graph-assistant-tool-transport", () => {
  const preference = ref<ToolTransportPreference>(loadPersisted());

  /** 持久化当前偏好（失败静默降级为内存态）。 */
  function persist(): void {
    const storage = safeStorage();
    if (!storage) {
      return;
    }
    try {
      storage.setItem(STORAGE_KEY, preference.value);
    } catch {
      // 持久化失败不致命：保留内存态。
    }
  }

  /** 设置协议偏好并持久化。 */
  function setPreference(value: ToolTransportPreference): void {
    if (!isPreference(value)) {
      return;
    }
    preference.value = value;
    persist();
  }

  /**
   * 本回合下发的协议偏好：`auto` 时返回 undefined（不下发，后端缺省即 auto），
   * 仅在 native / text_protocol 时下发。
   */
  const preferenceForRequest = computed<ToolTransportPreference | undefined>(() =>
    preference.value === "auto" ? undefined : preference.value,
  );

  return {
    preference,
    preferenceForRequest,
    setPreference,
  };
});

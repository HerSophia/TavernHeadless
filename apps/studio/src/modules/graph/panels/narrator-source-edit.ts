/**
 * NG2-10：承载节点（`narration.narrator`）来源二选一编辑的**纯逻辑**。
 *
 * 从 `NodeInspector.vue` 抽出，便于单测（studio 无 jsdom / @vue/test-utils，遵循本仓
 * 「组件逻辑抽 `.ts` 单测」的既有约定，如 `agent-call-config.ts` / `control-node-config.ts`）。
 *
 * 契约与 NG2-7 一致（`@tavern/core` `agent-source`）：`config.source` 为 `'preset' | 'subgraph'` 二选一，
 * `presetRef` / `subgraphRef` 互斥。本模块只做「读当前来源 / 读引用输入 / 写回引用 / 切换来源并互斥清理」，
 * 不触碰 store 与响应式；输入 config 为 `unknown`，输出为新的 config 对象（不原地修改入参）。
 *
 * 零回归约束（与组件既有行为逐字节一致）：
 * - 缺省来源推断复用 core `resolveNodeGraphAgentSource`；非 `subgraph` 一律归 `preset`。
 * - 仅在**显式切换来源**（`switchNarratorAgentSource`）时才落 `config.source` 并互斥清理另一侧；
 *   单独写 presetRef / subgraphRef（`applyPresetRefToConfig` / `applySubgraphRefToConfig`）不注入 `source`。
 * - 空 id → 删除对应引用（presetRef 缺省回退会话预设）；version 输入为空 → 写 `null`。
 */
import { resolveNodeGraphAgentSource } from "@tavern/core/node-graph";

export type NarratorAgentSource = "preset" | "subgraph";

export interface NarratorPresetRefInputs {
  presetId: string;
  presetVersionId: string;
}

export interface NarratorSubgraphRefInputs {
  graphId: string;
  versionId: string;
}

/** 把任意 config 归一为可写对象（非对象 / 数组 → 空对象），且不原地修改入参。 */
function toConfigObject(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" && !Array.isArray(config)
    ? { ...(config as Record<string, unknown>) }
    : {};
}

/** 读出 narrator 有效来源（缺省推断，复用 core `resolveNodeGraphAgentSource`）；非法枚举 / null 回退 `preset`。 */
export function readNarratorAgentSource(config: unknown): NarratorAgentSource {
  const resolved = resolveNodeGraphAgentSource({
    config: (config ?? undefined) as Record<string, unknown> | undefined,
  });
  return resolved === "subgraph" ? "subgraph" : "preset";
}

/** 从 config 读出 narrator presetRef（presetId / presetVersionId），缺省回退空串。 */
export function readNarratorPresetRefInputs(
  config: unknown,
): NarratorPresetRefInputs {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const presetRef = (config as { presetRef?: unknown }).presetRef;
    if (
      presetRef &&
      typeof presetRef === "object" &&
      !Array.isArray(presetRef)
    ) {
      const pid = (presetRef as { presetId?: unknown }).presetId;
      const vid = (presetRef as { presetVersionId?: unknown }).presetVersionId;
      return {
        presetId: typeof pid === "string" ? pid : "",
        presetVersionId: typeof vid === "string" ? vid : "",
      };
    }
  }
  return { presetId: "", presetVersionId: "" };
}

/** 从 config 读出 narrator subgraphRef（graphId / versionId），缺省回退空串。 */
export function readNarratorSubgraphRefInputs(
  config: unknown,
): NarratorSubgraphRefInputs {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const subgraphRef = (config as { subgraphRef?: unknown }).subgraphRef;
    if (
      subgraphRef &&
      typeof subgraphRef === "object" &&
      !Array.isArray(subgraphRef)
    ) {
      const gid = (subgraphRef as { graphId?: unknown }).graphId;
      const vid = (subgraphRef as { versionId?: unknown }).versionId;
      return {
        graphId: typeof gid === "string" ? gid : "",
        versionId: typeof vid === "string" ? vid : "",
      };
    }
  }
  return { graphId: "", versionId: "" };
}

/** 把 presetId / presetVersionId 输入写入一个新 config（空 presetId 删 presetRef 回退会话预设；version 空写 null）。 */
export function applyPresetRefToConfig(
  config: unknown,
  inputs: NarratorPresetRefInputs,
): Record<string, unknown> {
  const next = toConfigObject(config);
  const pid = inputs.presetId.trim();
  if (pid.length === 0) {
    delete next.presetRef;
  } else {
    const vid = inputs.presetVersionId.trim();
    next.presetRef =
      vid.length === 0
        ? { presetId: pid, presetVersionId: null }
        : { presetId: pid, presetVersionId: vid };
  }
  return next;
}

/** 把 graphId / versionId 输入写入一个新 config（空 graphId 删 subgraphRef；version 空写 null）。 */
export function applySubgraphRefToConfig(
  config: unknown,
  inputs: NarratorSubgraphRefInputs,
): Record<string, unknown> {
  const next = toConfigObject(config);
  const gid = inputs.graphId.trim();
  if (gid.length === 0) {
    delete next.subgraphRef;
  } else {
    const vid = inputs.versionId.trim();
    next.subgraphRef =
      vid.length === 0
        ? { graphId: gid, versionId: null }
        : { graphId: gid, versionId: vid };
  }
  return next;
}

/**
 * 显式切换承载来源：置 `config.source`，清除另一侧引用（互斥），并写回同侧引用。返回新 config。
 *
 * 只在用户主动切换时落 `source`；既有无 `source` 的 narrator 不会因单独编辑引用被注入 `source`。
 */
export function switchNarratorAgentSource(
  config: unknown,
  source: NarratorAgentSource,
  inputs: {
    preset: NarratorPresetRefInputs;
    subgraph: NarratorSubgraphRefInputs;
  },
): Record<string, unknown> {
  const next = toConfigObject(config);
  next.source = source;
  if (source === "subgraph") {
    delete next.presetRef;
    return applySubgraphRefToConfig(next, inputs.subgraph);
  }
  delete next.subgraphRef;
  return applyPresetRefToConfig(next, inputs.preset);
}

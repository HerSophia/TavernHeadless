/**
 * 把角色槽位的「实例配置解析（listResolved）」与「Profile 绑定解析（runtime）」合并为只读视图行
 * （LLM10 / 阶段 B，纯函数可单测）。
 *
 * LI11 命名坑修复（批次 11）：Profile（模型档案）取自 **profile binding**（`runtime`，含 `profileId` /
 * `presetName` / 有效 `modelId`），**不再**把实例配置的 `presetId`（提示词预设覆盖）当成 Profile id。
 * 实例侧 `resolved` 只贡献 `source` / `enabled` / `modelIdOverride` / `params`。
 *
 * 固定输出 4 个角色槽位（narrator/director/verifier/memory），缺失则以 default 兜底。
 */
import {
  LLM_INSTANCE_SLOTS,
  type LlmInstanceSlot,
  type LlmResolvedInstanceSlot,
} from "../../../lib/models/instances";
import type { LlmProfile, LlmRuntimeSlot } from "../../../lib/models/profiles";

export interface ResolvedSlotView {
  slot: Exclude<LlmInstanceSlot, "*">;
  source: LlmResolvedInstanceSlot["source"];
  scope: LlmResolvedInstanceSlot["scope"];
  /** Profile 绑定来源（env / global_profile / session_profile）；无绑定为 null。 */
  profileSource: LlmRuntimeSlot["source"] | null;
  profileId: string | null;
  profileName: string | null;
  modelId: string | null;
  enabled: boolean;
  temperature: number | null;
  maxOutputTokens: number | null;
}

export function mapResolvedSlots(
  resolved: LlmResolvedInstanceSlot[],
  runtime: LlmRuntimeSlot[],
  profiles: LlmProfile[],
): ResolvedSlotView[] {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const resolvedByName = new Map(resolved.map((slot) => [slot.slot, slot]));
  const runtimeByName = new Map(runtime.map((slot) => [slot.slot, slot]));

  return LLM_INSTANCE_SLOTS.map((slot) => {
    const instance = resolvedByName.get(slot);
    const binding = runtimeByName.get(slot);
    // Profile 走 binding：优先 runtime 自带的 presetName，回退到 profiles 列表查名。
    const profileId = binding?.profileId ?? null;
    const profileName =
      binding?.presetName ?? (profileId ? profileById.get(profileId)?.presetName ?? null : null);
    return {
      slot,
      source: instance?.source ?? "default",
      scope: instance?.scope ?? null,
      profileSource: binding?.source ?? null,
      profileId,
      profileName,
      // 有效模型：实例级 model_id_override 优先，否则取 Profile 绑定解析出的 modelId。
      modelId: instance?.modelIdOverride ?? binding?.modelId ?? null,
      enabled: instance?.enabled ?? false,
      temperature: instance?.params?.temperature ?? null,
      maxOutputTokens: instance?.params?.max_output_tokens ?? null,
    };
  });
}

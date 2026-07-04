/**
 * Step 级重试的判定与副作用收集纯函数（框架无关，无 DOM / i18n 依赖）。
 *
 * 「从第 N 个 step 重试」的语义是：丢弃第 N 步及其之后的工具往返，保留前 N-1 步已成功
 * 的工具结果，让模型从第 N 步重新生成。为保证可回放，重试起点那一步必须是不带写副作用
 * 的工具步（sideEffectLevel === "none"）；起点之前若已经产生写类副作用（如落库、外部调用），
 * 这些副作用不会被回滚，需要提前收集出来提示用户。
 *
 * 本模块只做判定与摘要收集，不发请求、不改状态；后端仍会做同款硬校验，这里是接入方
 * 做「按钮是否可点」「提示哪些副作用不可回滚」的前置依据。
 */

import type { FloorStep, FloorToolStep } from "./types.js";

/** 无写副作用的工具步 sideEffectLevel 取值。 */
const NONE_SIDE_EFFECT_LEVEL = "none";

/** 起点之前不可回滚的写类副作用摘要条目。 */
export type IrreversibleSideEffectSummary = {
  /** 在 step 序列中的位置（从 0 起）。 */
  index: number;
  /** 工具执行的稳定标识。 */
  executionId: string;
  toolName: string;
  /** 触发判定的副作用级别（非 "none"，通常是 "sandbox" / "irreversible"）。 */
  sideEffectLevel: string;
  startedAt: number;
};

/** 判断给定步是否为工具步（类型守卫）。 */
function isToolStep(step: FloorStep): step is FloorToolStep {
  return step.kind === "tool";
}

/**
 * 判断能否从该步开始重试。
 *
 * 仅当该步是工具步、且不带写副作用（sideEffectLevel === "none"）时返回 true。
 * 回答步、叙述步，以及带 sandbox / irreversible 副作用的工具步都不可作为重试起点。
 *
 * @param step - 待判定的 step 视图模型
 * @returns 可作为重试起点返回 true，否则 false
 */
export function canRetryFromStep(step: FloorStep): boolean {
  return isToolStep(step) && step.sideEffectLevel === NONE_SIDE_EFFECT_LEVEL;
}

/**
 * 收集重试起点之前已产生、不会回滚的写类副作用摘要。
 *
 * 只扫描下标严格小于 fromIndex 的工具步；命中 sideEffectLevel 非 "none"（也非空）的
 * 工具步即计入。返回的顺序与 steps 中的出现顺序一致。用于在发起step 级重试前提示用户
 * 「这些操作已经发生且无法撤销」。
 *
 * @param steps - 完整 step 序列
 * @param fromIndex - 重试起点在 step 序列中的下标（从 0 起）；起点自身不计入
 * @returns 起点之前的不可回滚副作用摘要列表；无则返回空数组
 */
export function collectIrreversibleSideEffectsBefore(
  steps: readonly FloorStep[],
  fromIndex: number,
): IrreversibleSideEffectSummary[] {
  const summaries: IrreversibleSideEffectSummary[] = [];
  for (const step of steps) {
    if (!isToolStep(step)) {
    continue;
    }
    if (step.index >= fromIndex) {
      continue;
    }
       const level = step.sideEffectLevel;
    if (!level || level === NONE_SIDE_EFFECT_LEVEL) {
      continue;
    }
    summaries.push({
      index: step.index,
      executionId: step.executionId,
      toolName: step.toolName,
      sideEffectLevel: level,
      startedAt: step.startedAt,
    });
  }
  return summaries;
}

/**
 * 收集重试起点及其之后（将被丢弃重新生成的范围）已产生、不会回滚的写类副作用摘要。
 *
 * 与 `collectIrreversibleSideEffectsBefore` 方向相反：后者看起点之前（保留复用的部分），
 * 本函数看起点及其之后（下标 >= fromIndex，即重试时会被丢弃并重跑的那些步）。这些工具
 * 已经真实执行过（写了文件 / 改了图 / 调了外部接口），但它们的记录将被丢弃；重新生成时模型
 * 可能再做一遍（重复副作用），也可能不再做（遗留一次无对话记录的外部改动）。因此需在发起
 * 重试前弹框告知用户，由其决定是否继续。
 *
 * @param steps - 完整 step序列
 * @param fromIndex - 重试起点在 step 序列中的下标（从 0 起）；起点自身也在丢弃范围内（但它已由 canRetryFromStep 保证无写副作用）
 * @returns 起点及之后的不可回滚副作用摘要列表；无则返回空数组
 */
export function collectIrreversibleSideEffectsFrom(
  steps: readonly FloorStep[],
  fromIndex: number,
): IrreversibleSideEffectSummary[] {
  const summaries: IrreversibleSideEffectSummary[] = [];
  for (const step of steps) {
    if (!isToolStep(step)) {
      continue;
    }
    if (step.index< fromIndex) {
      continue;
    }
    const level = step.sideEffectLevel;
    if (!level || level === NONE_SIDE_EFFECT_LEVEL) {
      continue;
    }
    summaries.push({
      index: step.index,
      executionId: step.executionId,
      toolName: step.toolName,
      sideEffectLevel: level,
      startedAt: step.startedAt,
    });
  }
  return summaries;
}

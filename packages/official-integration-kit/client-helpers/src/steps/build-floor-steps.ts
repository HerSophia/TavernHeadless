/**
 * 楼层 Step 视图聚合（图助手 Step 一等化展示）。
 *
 * 把一个 floor 的工具执行记录与最终回答消息归并成「按真实时序排列」的有序 step 序列：
 * 工具步用 startedAt、回答步用消息 createdAt 作为统一的时序主排序键，再交叉归并。
 * 这样四种位置都能按真实顺序呈现：
 * - 仅工具（无回答步）；
 * - 工具在正文前（工具 startedAt < 回答 createdAt）；
 * - 工具在正文中间（回答1 createdAt < 工具 startedAt < 回答2 createdAt）；
 * - 工具在正文之后（回答 createdAt < 工具 startedAt）。
 *
 * 当前 native 多步循环只把末步可见正文落库为一条助手消息、且工具都先于最终回答完成，
 * 因此实际呈现为「工具在前、回答在后」；但归并不再写死该顺序，未来中间步若产出独立正文，
 * 时序键会自然把它排到正确位置。
 *
 * 提供两层入口：
 * - `buildFloorSteps`：最小输入接口，历史与流式两路共用，框架无关、便于单测。
 * - `buildFloorStepsFromTranscriptFloor`：适配 SDK transcript floor类型，供历史楼层直接使用。
 */
import type { TemporaryConversationTranscriptFloor } from "@tavern/sdk";

import type {
  BuildFloorStepsInput,
  FloorAnswerStep,
  FloorNarrationStep,
  FloorStep,
  FloorToolStep,
} from "./types.js";

/** 视为「回答步」的消息 role。user 消息不进 step 序列（由楼层视图单独展示）。 */
const ANSWER_ROLES = new Set(["assistant", "narrator"]);

/**
 * 把工具步与回答步按真实时序归并为有序 step 序列。
 *
 * 主排序键：工具步取 startedAt，回答步 / 叙述步取 createdAt（毫秒时间戳）。
 * 同一时刻时按组排序：叙述步（0）→工具步（1）→回答步（2），使中间叙述排在
 * 其发起的工具组之前；再同则工具按 startedAt、回答按 seq、叙述按 stepIndex 稳定排列。
 * index 在归并后统一从 0 赋值。
 */
export function buildFloorSteps(input: BuildFloorStepsInput): FloorStep[] {
  type Pending = {
    /** 主排序键：真实时间轴位置（工具用 startedAt，回答用 createdAt）。 */
    sortKey: number;
    /** 同刻分组：工具（0）排在回答（1）之前。 */
    group: number;
    /** 同组稳定次序：工具按 startedAt，回答按 seq。 */
    sub: number;
    build:
      | Omit<FloorToolStep, "index">
      | Omit<FloorAnswerStep, "index">
      | Omit<FloorNarrationStep, "index">;
  };

  const pending: Pending[] = [];

  for (const exec of input.toolExecutions) {
    pending.push({
      sortKey: exec.startedAt,
      group: 1,
      sub: exec.startedAt,
      build: {
        kind: "tool" as const,
        executionId: exec.executionId,
        toolName: exec.toolName,
       status: exec.status,
        args: exec.args,
        result: exec.result,
        sideEffectLevel: exec.sideEffectLevel ?? null,
        commitOutcome: exec.commitOutcome ?? null,
        errorMessage: exec.errorMessage ?? null,
        durationMs: exec.durationMs ?? null,
        startedAt: exec.startedAt,
          finishedAt: exec.finishedAt ?? null,
      attemptNo: exec.attemptNo ?? null,
        generationStepNo: exec.generationStepNo ?? null,
      },
    });
  }

  for (const answer of input.answers) {
    pending.push({
      sortKey: answer.createdAt,
      group: 2,
      sub: answer.seq,
      build: {
        kind: "answer" as const,
        id: answer.id,
        role: answer.role,
        content: answer.content,
      },
    });
  }

  for (const narration of input.narrations ?? []) {
    pending.push({
      sortKey: narration.createdAt,
      group: 0,
      sub: narration.stepIndex,
      build: {
        kind: "narration" as const,
        stepIndex: narration.stepIndex,
        content: narration.content,
        createdAt: narration.createdAt,
      },
    });
  }

  pending.sort((a, b) => a.sortKey - b.sortKey || a.group - b.group || a.sub - b.sub);

  return pending.map((item, index) => ({ ...item.build, index }) as FloorStep);
}

/**
 * 从 SDK transcript floor 归并 step 序列（历史楼层）。
 *
 * 工具步取 `floor.toolExecutions`；回答步取该 floor 全部 active page 里
 * role 为 assistant / narrator 且未隐藏的消息，并带上各自的 createdAt 用于时序归并。
 */
export function buildFloorStepsFromTranscriptFloor(
  floor: TemporaryConversationTranscriptFloor,
):FloorStep[] {
  const answers = floor.pages
    .filter((page) => page.isActive)
    .flatMap((page) => page.messages)
    .filter((message) => ANSWER_ROLES.has(message.role) && !message.isHidden)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      seq: message.seq,
    }));

  return buildFloorSteps({
    toolExecutions: floor.toolExecutions.map((exec) => ({
      executionId: exec.id,
      toolName: exec.toolName,
      status: exec.status,
      args: exec.args,
      result: exec.result,
      sideEffectLevel: exec.sideEffectLevel,
      commitOutcome: exec.commitOutcome,
      errorMessage: exec.errorMessage,
      durationMs: exec.durationMs,
      startedAt: exec.startedAt,
      finishedAt: exec.finishedAt,
      attemptNo: exec.attemptNo,
      generationStepNo: exec.generationStepNo,
    })),
    answers,
    narrations: floor.stepNarrations.map((narration) => ({
      stepIndex: narration.stepIndex,
      content: narration.text,
      createdAt: narration.createdAt,
    })),
  });
}

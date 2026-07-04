/**
 * 楼层 Step 段分组（图助手 Step 一等化展示）。
 *
 * 把已按真实时序归并好的 step 序列再聚成「段」，供渲染层按段顺序逐段呈现：
 * - 连续的工具步合并为一个「工具段」（一个可折叠分组）；
 * - 每个回答步单独成为一个「回答段」。
 *
 * 段顺序严格沿用输入 step 顺序，因此工具在正文中的位置完全由数据时序决定，
 * 渲染层不再写死「工具一定在正文前 / 后」。框架无关、无 DOM / i18n 依赖。
 */
import type { FloorAnswerStep, FloorNarrationStep, FloorStep, FloorToolStep } from "./types.js";

/**
 * 渲染段：工具段（连续工具步）、叙述段（单条中间叙述）或回答段（单条回答）。
 *
 *叙述段与回答段都是正文，渲染层可同样用 markdown 呈现，只是叙述是中间动作预告。
 */
export type FloorStepSegment =
  | { kind: "tools"; key: string; steps: FloorToolStep[] }
  | { kind: "narration"; key: string; step: FloorNarrationStep }
  | { kind: "answer"; key: string; step: FloorAnswerStep };

/**
 * 把 step 序列按出现顺序聚成段。
 *
 * 连续工具步并入同一个工具段；遇到回答步则结束当前工具段并新建回答段。
 * key取段内首个 step 的稳定标识，便于列表渲染做 key 绑定。
 */
export function groupFloorStepsIntoSegments(steps: readonly FloorStep[]): FloorStepSegment[] {
 const segments: FloorStepSegment[] = [];
  for (const step of steps) {
    if (step.kind === "tool") {
      const last = segments[segments.length - 1];
      if (last && last.kind === "tools") {
        last.steps.push(step);
      } else {
        segments.push({ kind: "tools", key: `tools-${step.index}`, steps: [step] });
      }
    } else if (step.kind === "narration") {
      segments.push({ kind: "narration", key: `narration-${step.index}`, step });
    } else {
      segments.push({ kind: "answer", key: `answer-${step.id}`, step });
    }
  }
  return segments;
}

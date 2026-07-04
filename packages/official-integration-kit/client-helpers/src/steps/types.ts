/**
 * 楼层 Step 视图模型类型（图助手 Step 一等化展示）。
 *
 * Step 是「一次 LLM 往返」的语义边界，天然跨多条 message 与多条工具执行记录，
 * 因此它不进 floor→page→message 持久化层级，只在视图层做聚合。一个 floor 内的
 * step 序列由「工具步」与「回答步」按时间顺序归并而成：工具步来自 tool_execution_record，
 * 回答步来自最终的 assistant / narrator 消息。
 *
 * 本模块框架无关、无 DOM / i18n 依赖，便于单测与多接入方复用。
 */

/** 工具步：对应一次工具执行。 */
export type FloorToolStep = {
  kind: "tool";
  /** 在 step 序列中的位置（从 0 起），供 step 级重试等场景定位。 */
  index: number;
  /** 工具执行的稳定标识（executionId）。 */
  executionId: string;
  toolName: string;
  status: string;
  /** 工具入参（已解析；调用方按需做摘要展示）。 */
  args: unknown;
  /** 工具结果（已解析；脱敏时可能为 null）。 */
  result: unknown;
  sideEffectLevel: string | null;
  commitOutcome: string | null;
  errorMessage: string | null;
  /** 耗时（毫秒）；进行中或缺失时为 null。 */
  durationMs: number | null;
  startedAt: number;
  finishedAt: number | null;
  attemptNo: number | null;
  /**
   * 该工具执行所属的 LLM 生成步号（1-based，来自 tool_execution_record.generation_step_no）。
   * step 级重试用它把「视图 step 序列位置」换算成后端要的生成步号；旧数据或拿不到时为 null。
   */
  generationStepNo: number | null;
};

/** 回答步：对应最终落库的助手回复消息。 */
export type FloorAnswerStep = {
  kind: "answer";
  /** 在 step 序列中的位置（从 0 起）。 */
  index: number;
  /** 消息 id。 */
  id: string;
  /** 消息 role（assistant / narrator）。 */
  role: string;
  content: string;
};

/**
 * 叙述步：native 多步循环里「触发工具的那一步」的可见文本（中间叙述）。
 *
 * 与回答步同样是正文，渲染层可同款 markdown 呈现；区别在于它是模型调用工具前的
 * 动作预告，不是最终结论。不落入 message 正文、不进 prompt，来自旁路持久化。
 */
export type FloorNarrationStep = {
  kind: "narration";
  /** 在 step 序列中的位置（从 0起）。 */
  index: number;
  /** 来源的生成步序（1-based）。 */
  stepIndex: number;
  content: string;
  /** 该步生成完成时刻（毫秒），作时序排序键。 */
  createdAt: number;
};

export type FloorStep = FloorToolStep | FloorAnswerStep | FloorNarrationStep;

/** 归并输入：单个工具执行（最小字段，历史与流式两路共用）。 */
export type FloorStepToolInput = {
  executionId: string;
  toolName: string;
  status: string;
  args: unknown;
  result: unknown;
  sideEffectLevel?: string | null;
  commitOutcome?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  startedAt: number;
 finishedAt?: number | null;
  attemptNo?: number | null;
  /** LLM 生成步号（1-based）；缺省视为 null。 */
  generationStepNo?: number | null;
};

/** 归并输入：单条回答消息（最小字段）。 */
export type FloorStepAnswerInput = {
  id: string;
  role: string;
  content: string;
/**
   * 消息创建时间戳（毫秒）。与工具步的 startedAt 统一成为时序主排序键，
   * 以支持「仅工具 / 工具在前 / 工具在中间 / 工具在后」四种位置按真实顺序交叉。
   */
  createdAt: number;
  /** 同一时刻多条回答的稳定次序（page 内 seq）。 */
  seq: number;
};

/** 归并输入：单条中间叙述（最小字段）。 */
export type FloorStepNarrationInput = {
  /** 来源的生成步序（1-based）。 */
  stepIndex: number;
  content: string;
  /** 该步生成完成时刻（毫秒），与工具 startedAt、回答 createdAt 统一作时序键。 */
  createdAt: number;
};

/** 归并输入：一个 floor 的工具步、回答步与中间叙述原料。 */
export type BuildFloorStepsInput = {
 toolExecutions: readonly FloorStepToolInput[];
  answers: readonly FloorStepAnswerInput[];
  /** 中间叙述（native 多步）；缺省视为无。 */
  narrations?: readonly FloorStepNarrationInput[];
};

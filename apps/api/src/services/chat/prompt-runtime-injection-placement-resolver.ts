import {
  PROMPT_RUNTIME_INJECTION_PLACEMENTS,
  type PromptRuntimeInjectionAnchor,
  type PromptRuntimeInjectionPlacement,
  type PromptRuntimeInjectionPlacementParams,
  type PromptRuntimeInjectionPlacementResolverInput,
  type PromptRuntimeInjectionPlacementResolverOutput,
  type PromptRuntimeInjectionPromptMode,
} from "../prompt-runtime-injection-types.js";

/**
 * 内部分类键。
 *
 * 对段级位置，它直接作为 PromptIR section 锚点键复用既有落点逻辑。
 * 对 I3 高级位置，它仅作为分组与排序兜底键，真实落点由 anchor 决定。
 */
export const INTERNAL_PLACEMENT_KEYS: Record<PromptRuntimeInjectionPlacement, string> = {
  before_system_prompt: "system_prompt.before",
  after_system_prompt: "system_prompt.after",
  before_character: "character.before",
  after_character: "character.after",
  before_persona: "persona.before",
  after_persona: "persona.after",
  before_worldbook: "worldbook.before",
  after_worldbook: "worldbook.after",
  before_memory: "memory.before",
  after_memory: "memory.after",
  before_examples: "examples.before",
  after_examples: "examples.after",
  before_history: "history.before",
  after_history: "history.after",
  before_current_user_input: "current_user_input.before",
  after_current_user_input: "current_user_input.after",
  before_output_instruction: "output_instruction.before",
  before_assistant_prefill: "assistant_prefill.before",
  // I3 楼层相对位置
 before_floor: "floor.before",
  after_floor: "floor.after",
  before_floor_from_end: "floor_from_end.before",
  after_floor_from_end: "floor_from_end.after",
  // I3 世界书细分位置
  worldbook_depth: "worldbook.depth",
  worldbook_before: "worldbook.inner_before",
  worldbook_after: "worldbook.inner_after",
  worldbook_author_note_top: "worldbook.author_note_top",
  // I3 native 专属位置
  before_contributor_block: "contributor_block.before",
  after_contributor_block: "contributor_block.after",
};

const I1_SECTION_PLACEMENTS: readonly PromptRuntimeInjectionPlacement[] = [
  "before_system_prompt",
  "after_system_prompt",
  "before_character",
  "after_character",
  "before_persona",
  "after_persona",
  "before_worldbook",
  "after_worldbook",
  "before_memory",
  "after_memory",
  "before_examples",
  "after_examples",
  "before_history",
  "after_history",
  "before_current_user_input",
  "after_current_user_input",
  "before_output_instruction",
  "before_assistant_prefill",
];

const FLOOR_PLACEMENTS: readonly PromptRuntimeInjectionPlacement[] = [
  "before_floor",
  "after_floor",
  "before_floor_from_end",
  "after_floor_from_end",
];

const WORLDBOOK_DETAIL_PLACEMENTS: readonly PromptRuntimeInjectionPlacement[] = [
  "worldbook_depth",
  "worldbook_before",
  "worldbook_after",
  "worldbook_author_note_top",
];

const NATIVE_CONTRIBUTOR_BLOCK_PLACEMENTS: readonly PromptRuntimeInjectionPlacement[] = [
  "before_contributor_block",
  "after_contributor_block",
];

const PROMPT_RUNTIME_INJECTION_PLACEMENTS_BY_MODE: Record<
  PromptRuntimeInjectionPromptMode,
  readonly PromptRuntimeInjectionPlacement[]
> = {
  // compat_strict：通用结构位置 + 楼层位置（世界书细分与 native contributor block 不开放）
  compat_strict: [...I1_SECTION_PLACEMENTS, ...FLOOR_PLACEMENTS],
  // compat_plus：再加世界书细分位置（native contributor block 仍不开放）
  compat_plus: [...I1_SECTION_PLACEMENTS, ...FLOOR_PLACEMENTS, ...WORLDBOOK_DETAIL_PLACEMENTS],
  // native：全部开放
  native: [
    ...I1_SECTION_PLACEMENTS,
    ...FLOOR_PLACEMENTS,
    ...WORLDBOOK_DETAIL_PLACEMENTS,
    ...NATIVE_CONTRIBUTOR_BLOCK_PLACEMENTS,
  ],
};

function isKnownPlacement(value: string): value is PromptRuntimeInjectionPlacement {
  return (PROMPT_RUNTIME_INJECTION_PLACEMENTS as readonly string[]).includes(value);
}

export function listPromptRuntimeInjectionPlacementsForMode(
  promptMode: PromptRuntimeInjectionPromptMode,
): readonly PromptRuntimeInjectionPlacement[] {
  return PROMPT_RUNTIME_INJECTION_PLACEMENTS_BY_MODE[promptMode];
}

export function isPromptRuntimeInjectionPlacementAvailableInMode(
  placement: PromptRuntimeInjectionPlacement,
  promptMode: PromptRuntimeInjectionPromptMode,
): boolean {
  return listPromptRuntimeInjectionPlacementsForMode(promptMode).includes(placement);
}

function isNonNegativeInteger(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * 把已知 placement 构造为锚点。
 *
 * 需要参数的 placement 在此前已经过参数完整性 / 合法性校验，因此这里读取参数是安全的。
 */
function buildAnchor(
  placement: PromptRuntimeInjectionPlacement,
  params: PromptRuntimeInjectionPlacementParams | undefined,
): PromptRuntimeInjectionAnchor {
  switch (placement) {
    case "before_floor":
      return { kind: "floor_by_no", floorNo: params!.floorNo!, edge: "before" };
    case "after_floor":
      return { kind: "floor_by_no", floorNo: params!.floorNo!, edge: "after" };
    case "before_floor_from_end":
      return { kind: "floor_from_end", offset: params!.offset!, edge: "before" };
    case "after_floor_from_end":
      return { kind: "floor_from_end", offset: params!.offset!, edge: "after" };
    case "worldbook_depth":
      return {kind: "worldbook_depth", depth: params!.depth! };
    case "worldbook_before":
      return { kind: "worldbook_edge", edge: "before" };
case "worldbook_after":
      return { kind: "worldbook_edge", edge: "after" };
    case "worldbook_author_note_top":
      return { kind: "worldbook_author_note_top" };
    case "before_contributor_block":
      return { kind: "contributor_block", edge: "before" };
    case "after_contributor_block":
      return { kind: "contributor_block", edge: "after" };
    default:
      return { kind: "section", internalKey: INTERNAL_PLACEMENT_KEYS[placement] };
  }
}

/**
 * 校验需要参数的 placement 的参数完整性与合法性。
 *
 * 返回 undefined 表示通过；否则返回 not-applied 原因。
 * 不需要参数的 placement 永远返回 undefined（多余参数被忽略，不报错）。
 */
function validatePlacementParams(
  placement: PromptRuntimeInjectionPlacement,
  params: PromptRuntimeInjectionPlacementParams | undefined,
): "missing_placement_params" | "invalid_placement_params" | undefined {
  switch (placement) {
    case "before_floor":
    case "after_floor": {
      if (params?.floorNo === undefined) {
     return "missing_placement_params";
      }
      return isNonNegativeInteger(params.floorNo) ? undefined : "invalid_placement_params";
    }
case "before_floor_from_end":
    case "after_floor_from_end": {
      if (params?.offset === undefined) {
        return "missing_placement_params";
      }
      return isNonNegativeInteger(params.offset) ? undefined : "invalid_placement_params";
    }
    case "worldbook_depth": {
      if (params?.depth === undefined) {
        return "missing_placement_params";
      }
      return isNonNegativeInteger(params.depth) ? undefined : "invalid_placement_params";
    }
    default:
      return undefined;
  }
}

export class PromptRuntimeInjectionPlacementResolver {
  resolve(
    input: PromptRuntimeInjectionPlacementResolverInput,
  ): PromptRuntimeInjectionPlacementResolverOutput {
    if (!isKnownPlacement(input.placement)) {
      return {
        resolved: false,
        reason: "unknown_placement",
      };
    }

    if (!isPromptRuntimeInjectionPlacementAvailableInMode(input.placement, input.promptMode)) {
      return {
        resolved: false,
        reason: "placement_not_available_in_mode",
      };
    }

    const paramsReason = validatePlacementParams(input.placement, input.placementParams);
    if (paramsReason) {
      return {
        resolved: false,
        reason: paramsReason,
       // 即便参数不合法，也回显 internalKey 便于 trace 中识别请求位置。
        internalKey: INTERNAL_PLACEMENT_KEYS[input.placement],
      };
    }

    return {
      resolved: true,
      internalKey: INTERNAL_PLACEMENT_KEYS[input.placement],
      anchor: buildAnchor(input.placement, input.placementParams),
    };
  }
}

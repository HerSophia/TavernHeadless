import { describe, expect, it } from "vitest";

import {
type PromptRuntimeInjectionPlacement,
  type PromptRuntimeInjectionPromptMode,
} from "../../prompt-runtime-injection-types.js";
import {
  INTERNAL_PLACEMENT_KEYS,
  PromptRuntimeInjectionPlacementResolver,
} from "../../chat/prompt-runtime-injection-placement-resolver.js";

// I1 通用结构位置在三种 mode 下全部开放。
const I1_SECTION_PLACEMENTS: PromptRuntimeInjectionPlacement[] = [
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

describe("PromptRuntimeInjectionPlacementResolver", () => {
  it("resolves every I1 section placement in every prompt mode with a section anchor", () => {
    const resolver = new PromptRuntimeInjectionPlacementResolver();

    for (const placement of I1_SECTION_PLACEMENTS) {
      for (const promptMode of ["compat_strict", "compat_plus", "native"] as const) {
        expect(resolver.resolve({ placement, promptMode })).toEqual({
          resolved: true,
          internalKey: INTERNAL_PLACEMENT_KEYS[placement],
          anchor: { kind: "section", internalKey: INTERNAL_PLACEMENT_KEYS[placement] },
        });
      }
    }
  });

  it("rejects unknown placements with a stable reason", () => {
    const resolver = new PromptRuntimeInjectionPlacementResolver();

    expect(resolver.resolve({
      placement: "after_assistant_prefill",
      promptMode: "compat_plus",
    })).toEqual({
      resolved: false,
      reason: "unknown_placement",
    });
  });

  it("resolves floor placements in all modes when params are valid", () => {
    const resolver = new PromptRuntimeInjectionPlacementResolver();

    for (const promptMode of ["compat_strict", "compat_plus", "native"] as const) {
      expect(resolver.resolve({ placement: "before_floor", promptMode, placementParams: { floorNo: 3 } })).toEqual({
        resolved: true,
        internalKey: "floor.before",
        anchor: { kind: "floor_by_no", floorNo: 3, edge: "before" },
      });
      expect(resolver.resolve({ placement: "after_floor_from_end", promptMode, placementParams: { offset: 0 } })).toEqual({
        resolved: true,
        internalKey: "floor_from_end.after",
        anchor: { kind: "floor_from_end", offset: 0, edge: "after" },
      });
    }
  });

  it("reports missing or invalid floor params", () => {
    const resolver = new PromptRuntimeInjectionPlacementResolver();

    expect(resolver.resolve({ placement: "before_floor", promptMode: "native" })).toEqual({
      resolved: false,
      reason: "missing_placement_params",
      internalKey: "floor.before",
    });
    expect(resolver.resolve({
      placement: "before_floor",
      promptMode: "native",
      placementParams: { floorNo: -1 },
    })).toEqual({
      resolved: false,
      reason: "invalid_placement_params",
      internalKey: "floor.before",
    });
    expect(resolver.resolve({
      placement: "before_floor_from_end",
      promptMode: "native",
      placementParams: { offset: 1.5 },
    })).toEqual({
      resolved: false,
      reason: "invalid_placement_params",
      internalKey: "floor_from_end.before",
    });
  });

  it("opens worldbook detail placements only in compat_plus and native", () => {
    const resolver = new PromptRuntimeInjectionPlacementResolver();

    expect(resolver.resolve({ placement: "worldbook_depth", promptMode: "compat_plus", placementParams: { depth: 2 } })).toEqual({
      resolved: true,
      internalKey: "worldbook.depth",
      anchor: { kind: "worldbook_depth", depth: 2 },
    });
    expect(resolver.resolve({ placement: "worldbook_before", promptMode: "native" })).toEqual({
      resolved: true,
      internalKey: "worldbook.inner_before",
      anchor: { kind: "worldbook_edge", edge: "before" },
    });
    expect(resolver.resolve({ placement: "worldbook_author_note_top", promptMode: "native" })).toEqual({
      resolved: true,
      internalKey: "worldbook.author_note_top",
      anchor: { kind: "worldbook_author_note_top" },
    });

    expect(resolver.resolve({ placement: "worldbook_before", promptMode: "compat_strict" })).toEqual({
      resolved: false,
      reason: "placement_not_available_in_mode",
    });
  });

  it("reports missing or invalid worldbook depth", () => {
    const resolver = new PromptRuntimeInjectionPlacementResolver();

    expect(resolver.resolve({ placement: "worldbook_depth", promptMode: "native" })).toEqual({
      resolved: false,
      reason: "missing_placement_params",
      internalKey: "worldbook.depth",
    });
    expect(resolver.resolve({
      placement: "worldbook_depth",
      promptMode: "native",
      placementParams: { depth: -2 },
    })).toEqual({
      resolved: false,
      reason: "invalid_placement_params",
      internalKey: "worldbook.depth",
    });
  });

  it("opens contributor block placements only in native", () => {
    const resolver = new PromptRuntimeInjectionPlacementResolver();

    expect(resolver.resolve({ placement: "before_contributor_block", promptMode: "native" })).toEqual({
      resolved: true,
      internalKey: "contributor_block.before",
      anchor: { kind: "contributor_block", edge: "before" },
    });

    for(const promptMode of ["compat_strict", "compat_plus"] as const satisfies PromptRuntimeInjectionPromptMode[]) {
      expect(resolver.resolve({ placement: "after_contributor_block", promptMode })).toEqual({
        resolved: false,
        reason: "placement_not_available_in_mode",
      });
    }
  });
});

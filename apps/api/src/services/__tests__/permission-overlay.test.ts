import { describe, expect, it } from "vitest";

import {
  mapSessionBaseToolPermissionsRecordToCorePermissions,
  mergeSessionBaseToolPermissionsPatch,
  normalizeSessionBaseToolPermissionsRecord,
  resolveEffectiveToolPermissions,
} from "../tooling/shared/permission-overlay.js";

describe("permission-overlay", () => {
  it("normalizes session base permission records and preserves explicit empty slot arrays", () => {
    expect(normalizeSessionBaseToolPermissionsRecord({
      enabled: true,
      slot_allow_list: {
        narrator: [],
        director: ["search", "search", 1],
      },
      slot_deny_list: {
        memory: ["delete"],
      },
    })).toEqual({
      enabled: true,
      slot_allow_list: {
        narrator: [],
        director: ["search"],
      },
      slot_deny_list: {
        memory: ["delete"],
      },
    });
  });

  it("maps session base snake_case permissions to core camelCase fields", () => {
    expect(mapSessionBaseToolPermissionsRecordToCorePermissions({
      allow_irreversible: true,
      enabled: false,
      max_calls_per_turn: 4,
      max_steps_per_generation: 2,
      slot_allow_list: {
        narrator: ["search"],
      },
      slot_deny_list: {
        memory: ["delete"],
      },
    })).toEqual({
      allowIrreversible: true,
      enabled: false,
      maxCallsPerTurn: 4,
      maxStepsPerGeneration: 2,
      slotAllowList: {
        narrator: ["search"],
      },
      slotDenyList: {
        memory: ["delete"],
      },
    });
  });

  it("merges session base PATCH payloads at slot key level", () => {
    expect(mergeSessionBaseToolPermissionsPatch(
      {
        enabled: true,
        slot_allow_list: {
          narrator: ["search"],
        },
        slot_deny_list: {
          memory: ["delete"],
        },
      },
      {
        max_calls_per_turn: 5,
        slot_allow_list: {
          director: ["browse"],
        },
        slot_deny_list: {
          memory: [],
        },
      },
    )).toEqual({
      enabled: true,
      max_calls_per_turn: 5,
      slot_allow_list: {
        narrator: ["search"],
        director: ["browse"],
      },
      slot_deny_list: {
        memory: [],
      },
    });
  });

  it("resolves effective permissions conservatively when overlay is present", () => {
    expect(resolveEffectiveToolPermissions(
      {
        enabled: true,
        allowIrreversible: true,
        maxCallsPerTurn: 10,
        maxStepsPerGeneration: 8,
        slotAllowList: {
          narrator: ["search", "browse"],
          director: ["review"],
        },
        slotDenyList: {
          narrator: ["delete"],
        },
      },
      {
        allowIrreversible: false,
        maxCallsPerTurn: 4,
        slotAllowList: {
          narrator: ["browse", "lookup"],
        },
        slotDenyList: {
          narrator: ["archive"],
        },
      },
    )).toEqual({
      enabled: true,
      allowIrreversible: false,
      maxCallsPerTurn: 4,
      maxStepsPerGeneration: 8,
      slotAllowList: {
        narrator: ["browse"],
        director: ["review"],
      },
      slotDenyList: {
        narrator: ["delete", "archive"],
      },
    });
  });
});

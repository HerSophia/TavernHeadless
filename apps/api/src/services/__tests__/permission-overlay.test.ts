import { describe, expect, it } from "vitest";

import {
  mapSessionBaseToolPermissionsRecordToCorePermissions,
  mapSessionBaseToolPermissionsRecordToOverlay,
  mergeSessionBaseToolPermissionsPatch,
  normalizeSessionBaseToolPermissionsRecord,
  resolveEffectiveToolPermissions,
} from "../tooling/shared/permission-overlay.js";
import {
  collectUnknownToolPolicyOverrideFields,
  resolveEffectiveToolPolicy,
} from "../tooling/shared/tool-policy-resolution.js";

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

  it("maps session base snake_case permissions to overlay shape even when enabled is absent", () => {
    expect(mapSessionBaseToolPermissionsRecordToOverlay({
      max_calls_per_turn: 4,
      allow_irreversible: false,
    })).toEqual({
      maxCallsPerTurn: 4,
      allowIrreversible: false,
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

  it("collects unknown project tool policy override fields without dropping the known subset", () => {
    expect(collectUnknownToolPolicyOverrideFields({
      enabled: true,
      timeout_ms: 1500,
      unknown_flag: true,
      slot_allow_list: {
        narrator: ["search"],
      },
    })).toEqual(["timeout_ms", "unknown_flag"]);
  });

  it("does not auto-apply project tool policy without an explicit selector", () => {
    const resolution = resolveEffectiveToolPolicy({
      sessionBase: {
        enabled: true,
        max_calls_per_turn: 8,
      },
      projectOverrides: [
        {
          id: "pto_1",
          workspaceId: "ws_1",
          projectId: "proj_1",
          accountId: "acc_1",
          basePolicyId: "policy_alpha",
          overrideJson: {
            max_calls_per_turn: 2,
          },
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    expect(resolution.effectivePermissions).toEqual({
      enabled: true,
      maxCallsPerTurn: 8,
    });
    expect(resolution.layers[1]).toMatchObject({
      kind: "project_policy_overlay",
      applied: false,
      reason: "selector_missing",
    });
  });

  it("applies only the selected active project tool policy overlay", () => {
    const resolution = resolveEffectiveToolPolicy({
      sessionBase: {
        enabled: true,
        max_calls_per_turn: 8,
        allow_irreversible: true,
      },
      selector: {
        source: "agent_binding",
        policyId: "policy_alpha",
      },
      projectOverrides: [
        {
          id: "pto_1",
          workspaceId: "ws_1",
          projectId: "proj_1",
          accountId: "acc_1",
          basePolicyId: "policy_alpha",
          overrideJson: {
            max_calls_per_turn: 2,
            allow_irreversible: false,
            future_flag: true,
          },
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "pto_2",
          workspaceId: "ws_1",
          projectId: "proj_1",
          accountId: "acc_1",
          basePolicyId: "policy_beta",
          overrideJson: {
            max_calls_per_turn: 1,
          },
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    expect(resolution.effectivePermissions).toEqual({
      enabled: true,
      maxCallsPerTurn: 2,
      allowIrreversible: false,
    });
    expect(resolution.layers[1]).toMatchObject({
      kind: "project_policy_overlay",
      policyId: "policy_alpha",
      applied: true,
      reason: "applied",
      unknownFields: ["future_flag"],
    });
  });
});

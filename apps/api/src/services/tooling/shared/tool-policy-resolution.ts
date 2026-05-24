import type { ToolPermissions } from "@tavern/core";

import type { ProjectAgentBindingRecord } from "../../project-agent-binding-service.js";
import type { ProjectToolPolicyOverrideRecord } from "../../project-tool-policy-override-service.js";
import {
  mapSessionBaseToolPermissionsRecordToOverlay,
  resolveEffectiveToolPermissions,
  type SessionBaseToolPermissionsRecord,
  type ToolPermissionOverlay,
} from "./permission-overlay.js";

export type EffectiveToolPolicySelectorSource = "agent_binding";

export interface EffectiveToolPolicySelector {
  source: EffectiveToolPolicySelectorSource;
  policyId: string;
}

export interface ToolPolicyResolutionLayerTrace {
  kind: "session_base" | "project_policy_overlay" | "request_overlay";
  source: "session_metadata" | "project_policy_override" | "request_overlay";
  policyId?: string;
  applied: boolean;
  reason:
    | "applied"
    | "no_data"
    | "selector_missing"
    | "selector_not_found"
    | "selector_archived"
    | "empty_overlay"
    | "not_provided";
  unknownFields: string[];
}

export interface EffectiveToolPolicyResolution {
  selector: EffectiveToolPolicySelector | null;
  sessionBase: ToolPermissionOverlay | null;
  selectedProjectOverlay: ToolPermissionOverlay | null;
  requestOverlay: ToolPermissionOverlay | null;
  effectivePermissions: ToolPermissions | undefined;
  layers: ToolPolicyResolutionLayerTrace[];
}

const KNOWN_TOOL_POLICY_OVERRIDE_KEYS = new Set([
  "enabled",
  "max_calls_per_turn",
  "max_steps_per_generation",
  "allow_irreversible",
  "slot_allow_list",
  "slot_deny_list",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function collectUnknownToolPolicyOverrideFields(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.keys(value)
    .filter((key) => !KNOWN_TOOL_POLICY_OVERRIDE_KEYS.has(key))
    .sort();
}

export function resolveToolPolicySelectorFromAgentBinding(
  binding: Pick<ProjectAgentBindingRecord, "toolPolicyId"> | null | undefined,
): EffectiveToolPolicySelector | null {
  const policyId = binding?.toolPolicyId?.trim();
  if (!policyId) {
    return null;
  }

  return {
    source: "agent_binding",
    policyId,
  };
}

export function resolveToolPermissionOverlayFromProjectOverride(
  override: Pick<ProjectToolPolicyOverrideRecord, "overrideJson"> | null | undefined,
): ToolPermissionOverlay | null {
  const overlay = mapSessionBaseToolPermissionsRecordToOverlay(override?.overrideJson);
  if (!overlay || Object.keys(overlay).length === 0) {
    return null;
  }

  return overlay;
}

export function resolveEffectiveToolPolicy(input: {
  sessionBase?: SessionBaseToolPermissionsRecord | null;
  projectOverrides?: readonly ProjectToolPolicyOverrideRecord[];
  selector?: EffectiveToolPolicySelector | null;
  requestOverlay?: ToolPermissionOverlay | null;
}): EffectiveToolPolicyResolution {
  const sessionBase = mapSessionBaseToolPermissionsRecordToOverlay(input.sessionBase) ?? null;
  const projectOverrides = input.projectOverrides ?? [];
  const selector = input.selector ?? null;
  const requestOverlay = input.requestOverlay ?? null;
  const layers: ToolPolicyResolutionLayerTrace[] = [];

  layers.push({
    kind: "session_base",
    source: "session_metadata",
    applied: Boolean(sessionBase && Object.keys(sessionBase).length > 0),
    reason: sessionBase && Object.keys(sessionBase).length > 0 ? "applied" : "no_data",
    unknownFields: [],
  });

  let selectedProjectOverlay: ToolPermissionOverlay | null = null;

  if (!selector) {
    layers.push({
      kind: "project_policy_overlay",
      source: "project_policy_override",
      applied: false,
      reason: "selector_missing",
      unknownFields: [],
    });
  } else {
    const matchedOverride = projectOverrides.find((entry) => entry.basePolicyId === selector.policyId) ?? null;
    if (!matchedOverride) {
      layers.push({
        kind: "project_policy_overlay",
        source: "project_policy_override",
        policyId: selector.policyId,
        applied: false,
        reason: "selector_not_found",
        unknownFields: [],
      });
    } else if (matchedOverride.status !== "active") {
      layers.push({
        kind: "project_policy_overlay",
        source: "project_policy_override",
        policyId: matchedOverride.basePolicyId,
        applied: false,
        reason: "selector_archived",
        unknownFields: collectUnknownToolPolicyOverrideFields(matchedOverride.overrideJson),
      });
    } else {
      selectedProjectOverlay = resolveToolPermissionOverlayFromProjectOverride(matchedOverride);
      layers.push({
        kind: "project_policy_overlay",
        source: "project_policy_override",
        policyId: matchedOverride.basePolicyId,
        applied: Boolean(selectedProjectOverlay),
        reason: selectedProjectOverlay ? "applied" : "empty_overlay",
        unknownFields: collectUnknownToolPolicyOverrideFields(matchedOverride.overrideJson),
      });
    }
  }

  layers.push({
    kind: "request_overlay",
    source: "request_overlay",
    applied: Boolean(requestOverlay && Object.keys(requestOverlay).length > 0),
    reason: requestOverlay && Object.keys(requestOverlay).length > 0 ? "applied" : "not_provided",
    unknownFields: [],
  });

  const basePermissions = sessionBase?.enabled !== undefined
    ? {
        enabled: sessionBase.enabled,
        ...(sessionBase.maxCallsPerTurn !== undefined ? { maxCallsPerTurn: sessionBase.maxCallsPerTurn } : {}),
        ...(sessionBase.maxStepsPerGeneration !== undefined
          ? { maxStepsPerGeneration: sessionBase.maxStepsPerGeneration }
          : {}),
        ...(sessionBase.allowIrreversible !== undefined
          ? { allowIrreversible: sessionBase.allowIrreversible }
          : {}),
        ...(sessionBase.slotAllowList !== undefined ? { slotAllowList: sessionBase.slotAllowList } : {}),
        ...(sessionBase.slotDenyList !== undefined ? { slotDenyList: sessionBase.slotDenyList } : {}),
      }
    : null;

  const permissionsAfterProject = resolveEffectiveToolPermissions(basePermissions, selectedProjectOverlay);
  const effectivePermissions = resolveEffectiveToolPermissions(permissionsAfterProject, requestOverlay);

  return {
    selector,
    sessionBase,
    selectedProjectOverlay,
    requestOverlay,
    effectivePermissions,
    layers,
  };
}

export const AGENT_CALL_MEDIUM_KINDS = [
  "single_call",
  "temporary_conversation",
  "background_job",
] as const;

export type AgentCallMediumKind = (typeof AGENT_CALL_MEDIUM_KINDS)[number];

export const AGENT_CALL_DELIVERY_TARGETS = [
  "return_inline",
  "page_staged_write",
  "derived_output",
  "project_inbox",
  "session_state_proposal",
  "prompt_runtime_injection",
  "client_data",
  "plugin_data",
] as const;

export type AgentCallDeliveryTarget = (typeof AGENT_CALL_DELIVERY_TARGETS)[number];

export const AGENT_CALL_PURPOSES = ["agent_private", "agent_assist", "draft", "research"] as const;
export type AgentCallPurpose = (typeof AGENT_CALL_PURPOSES)[number];

export const AGENT_CALL_VISIBILITIES = ["internal", "client_visible"] as const;
export type AgentCallVisibility = (typeof AGENT_CALL_VISIBILITIES)[number];

export const AGENT_CALL_RETENTION_POLICIES = ["delete_on_finalize", "ttl", "keep_for_debug"] as const;
export type AgentCallRetentionPolicy = (typeof AGENT_CALL_RETENTION_POLICIES)[number];

export interface AgentCallConfigFormState {
  mediumKind: AgentCallMediumKind;
  deliveryTarget: AgentCallDeliveryTarget;
  purpose: AgentCallPurpose | "";
  visibility: AgentCallVisibility | "";
  retentionPolicy: AgentCallRetentionPolicy | "";
  agentBindingId: string;
  triggerReason: string;
  targetPageId: string;
  sourceOutputPageId: string;
  reason: string;
  derivedOutputProjectId: string;
  derivedOutputDomain: string;
  projectInboxProjectId: string;
  projectInboxType: string;
  projectInboxTitle: string;
  sessionStateProposalSessionId: string;
  sessionStateProposalSummary: string;
  sessionStateProposalNamespace: string;
  sessionStateProposalSlot: string;
  promptRuntimeInjectionTargetSessionId: string;
  promptRuntimeInjectionTargetBranchId: string;
  promptRuntimeInjectionTitle: string;
  promptRuntimeInjectionContent: string;
  promptRuntimeInjectionPlacement: string;
}

const DEFAULT_AGENT_CALL_CONFIG_FORM_STATE: AgentCallConfigFormState = {
  mediumKind: "single_call",
  deliveryTarget: "return_inline",
  purpose: "",
  visibility: "",
  retentionPolicy: "",
  agentBindingId: "",
  triggerReason: "",
  targetPageId: "",
  sourceOutputPageId: "",
  reason: "",
  derivedOutputProjectId: "",
  derivedOutputDomain: "",
  projectInboxProjectId: "",
  projectInboxType: "",
  projectInboxTitle: "",
  sessionStateProposalSessionId: "",
  sessionStateProposalSummary: "",
  sessionStateProposalNamespace: "",
  sessionStateProposalSlot: "",
  promptRuntimeInjectionTargetSessionId: "",
  promptRuntimeInjectionTargetBranchId: "",
  promptRuntimeInjectionTitle: "",
  promptRuntimeInjectionContent: "",
  promptRuntimeInjectionPlacement: "after_history",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return { ...asRecord(value) };
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function oneOf<T extends readonly string[]>(value: unknown, candidates: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (candidates as readonly string[]).includes(value) ? value as T[number] : fallback;
}

function optionalOneOf<T extends readonly string[]>(value: unknown, candidates: T): T[number] | "" {
  return typeof value === "string" && (candidates as readonly string[]).includes(value) ? value as T[number] : "";
}

function assignOptionalString(target: Record<string, unknown>, key: string, value: string): void {
  const normalized = value.trim();
  if (normalized.length === 0) {
    delete target[key];
    return;
  }
  target[key] = normalized;
}

function assignOptionalRawString(target: Record<string, unknown>, key: string, value: string): void {
  if (value.length === 0) {
    delete target[key];
    return;
  }
  target[key] = value;
}

function assignOptionalEnum(target: Record<string, unknown>, key: string, value: string): void {
  if (value.length === 0) {
    delete target[key];
    return;
  }
  target[key] = value;
}

function cleanupNested(target: Record<string, unknown>, key: string, value: Record<string, unknown>): void {
  if (Object.keys(value).length === 0) {
    delete target[key];
    return;
  }
  target[key] = value;
}

export function readAgentCallConfigFormState(config: unknown): AgentCallConfigFormState {
  const root = asRecord(config);
  const medium = asRecord(root.medium);
  const request = asRecord(root.temporaryConversationRequest);
  const derivedOutput = asRecord(request.derivedOutput);
  const projectInbox = asRecord(request.projectInbox);
  const sessionStateProposal = asRecord(request.sessionStateProposal);
  const promptRuntimeInjection = asRecord(request.promptRuntimeInjection);

  return {
    ...DEFAULT_AGENT_CALL_CONFIG_FORM_STATE,
    mediumKind: oneOf(medium.kind, AGENT_CALL_MEDIUM_KINDS, "single_call"),
    deliveryTarget: oneOf(medium.deliveryTarget, AGENT_CALL_DELIVERY_TARGETS, "return_inline"),
    purpose: optionalOneOf(medium.purpose, AGENT_CALL_PURPOSES),
    visibility: optionalOneOf(medium.visibility, AGENT_CALL_VISIBILITIES),
    retentionPolicy: optionalOneOf(medium.retentionPolicy, AGENT_CALL_RETENTION_POLICIES),
    agentBindingId: stringField(root, "agentBindingId"),
    triggerReason: stringField(root, "triggerReason"),
    targetPageId: stringField(request, "targetPageId"),
    sourceOutputPageId: stringField(request, "sourceOutputPageId"),
    reason: stringField(request, "reason"),
    derivedOutputProjectId: stringField(derivedOutput, "projectId"),
    derivedOutputDomain: stringField(derivedOutput, "domain"),
    projectInboxProjectId: stringField(projectInbox, "projectId"),
    projectInboxType: stringField(projectInbox, "type"),
    projectInboxTitle: stringField(projectInbox, "title"),
    sessionStateProposalSessionId: stringField(sessionStateProposal, "sessionId"),
    sessionStateProposalSummary: stringField(sessionStateProposal, "summary"),
    sessionStateProposalNamespace: stringField(sessionStateProposal, "namespace"),
    sessionStateProposalSlot: stringField(sessionStateProposal, "slot"),
    promptRuntimeInjectionTargetSessionId: stringField(promptRuntimeInjection, "targetSessionId"),
    promptRuntimeInjectionTargetBranchId: stringField(promptRuntimeInjection, "targetBranchId"),
    promptRuntimeInjectionTitle: stringField(promptRuntimeInjection, "title"),
    promptRuntimeInjectionContent: stringField(promptRuntimeInjection, "content"),
    promptRuntimeInjectionPlacement: stringField(promptRuntimeInjection, "placement") || "after_history",
  };
}

export function writeAgentCallConfigFormState(
  config: unknown,
  state: AgentCallConfigFormState,
): Record<string, unknown> {
  const next = cloneRecord(config);
  const medium = cloneRecord(next.medium);
  medium.kind = state.mediumKind;
  medium.deliveryTarget = state.deliveryTarget;
  assignOptionalEnum(medium, "purpose", state.purpose);
  assignOptionalEnum(medium, "visibility", state.visibility);
  assignOptionalEnum(medium, "retentionPolicy", state.retentionPolicy);
  next.medium = medium;

  if (state.mediumKind === "background_job") {
    assignOptionalString(next, "agentBindingId", state.agentBindingId);
    assignOptionalString(next, "triggerReason", state.triggerReason);
  }

  const request = cloneRecord(next.temporaryConversationRequest);

  switch (state.deliveryTarget) {
    case "page_staged_write":
      assignOptionalString(request, "targetPageId", state.targetPageId);
      assignOptionalString(request, "sourceOutputPageId", state.sourceOutputPageId);
      assignOptionalRawString(request, "reason", state.reason);
      break;

    case "derived_output": {
      const derivedOutput = cloneRecord(request.derivedOutput);
      assignOptionalString(derivedOutput, "projectId", state.derivedOutputProjectId);
      assignOptionalString(derivedOutput, "domain", state.derivedOutputDomain);
      cleanupNested(request, "derivedOutput", derivedOutput);
      break;
    }

    case "project_inbox": {
      const projectInbox = cloneRecord(request.projectInbox);
      assignOptionalString(projectInbox, "projectId", state.projectInboxProjectId);
      assignOptionalString(projectInbox, "type", state.projectInboxType);
      assignOptionalRawString(projectInbox, "title", state.projectInboxTitle);
      cleanupNested(request, "projectInbox", projectInbox);
      break;
    }

    case "session_state_proposal": {
      const sessionStateProposal = cloneRecord(request.sessionStateProposal);
      assignOptionalString(sessionStateProposal, "sessionId", state.sessionStateProposalSessionId);
      assignOptionalRawString(sessionStateProposal, "summary", state.sessionStateProposalSummary);
      assignOptionalString(sessionStateProposal, "namespace", state.sessionStateProposalNamespace);
      assignOptionalString(sessionStateProposal, "slot", state.sessionStateProposalSlot);
      cleanupNested(request, "sessionStateProposal", sessionStateProposal);
      break;
    }

    case "prompt_runtime_injection": {
      const promptRuntimeInjection = cloneRecord(request.promptRuntimeInjection);
      assignOptionalString(promptRuntimeInjection, "targetSessionId", state.promptRuntimeInjectionTargetSessionId);
      assignOptionalString(promptRuntimeInjection, "targetBranchId", state.promptRuntimeInjectionTargetBranchId);
      assignOptionalRawString(promptRuntimeInjection, "title", state.promptRuntimeInjectionTitle);
      assignOptionalRawString(promptRuntimeInjection, "content", state.promptRuntimeInjectionContent);
      assignOptionalString(promptRuntimeInjection, "placement", state.promptRuntimeInjectionPlacement);
      cleanupNested(request, "promptRuntimeInjection", promptRuntimeInjection);
      break;
    }

    default:
      break;
  }

  if (Object.keys(request).length === 0) {
    delete next.temporaryConversationRequest;
  } else {
    next.temporaryConversationRequest = request;
  }

  return next;
}

export function isAgentCallPersistentDeliveryTarget(target: AgentCallDeliveryTarget): boolean {
  return target !== "return_inline" && target !== "client_data" && target !== "plugin_data";
}

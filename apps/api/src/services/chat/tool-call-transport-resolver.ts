import type { ToolCallTransportKind, ToolCallTransportSelection } from "@tavern/core";

import type { LlmInstanceCapabilities } from "../../lib/llm-capabilities.js";
import { parseJsonField } from "../../lib/http.js";

export interface ToolCallTransportResolveInput {
  sessionId: string;
  branchId?: string;
  promptMode: "compat_strict" | "compat_plus" | "native";
  explicitTransport?: ToolCallTransportKind;
  toolsEnabled: boolean;
  capabilities?: LlmInstanceCapabilities;
}

const TOOL_CALL_TRANSPORTS_BY_PROMPT_MODE = {
  compat_strict: ["native_function_call", "text_protocol"],
  compat_plus: ["native_function_call", "text_protocol"],
  native: ["native_function_call", "text_protocol"],
} as const satisfies Record<
  ToolCallTransportResolveInput["promptMode"],
  readonly Exclude<ToolCallTransportKind, "none">[]
>;

export function listToolCallTransportsForPromptMode(
  promptMode: ToolCallTransportResolveInput["promptMode"],
): Array<Exclude<ToolCallTransportKind, "none">> {
  return [...TOOL_CALL_TRANSPORTS_BY_PROMPT_MODE[promptMode]];
}

export function isToolCallTransportAllowedInPromptMode(
  promptMode: ToolCallTransportResolveInput["promptMode"],
  transport: ToolCallTransportKind,
): boolean {
  return transport !== "none" && TOOL_CALL_TRANSPORTS_BY_PROMPT_MODE[promptMode].includes(transport);
}

type PromptModeTransportAvailabilityResolver = (
  promptMode: ToolCallTransportResolveInput["promptMode"],
  transport: ToolCallTransportKind,
) => boolean;

export function normalizeToolCallTransportKind(value: unknown): ToolCallTransportKind | undefined {
  return value === "native_function_call"
    || value === "text_protocol"
    || value === "none"
    ? value
    : undefined;
}

export function readToolCallTransportOverride(metadataJson: string | null): ToolCallTransportKind | undefined {
  const metadata = parseJsonField(metadataJson) as Record<string, unknown> | null;
  if (!metadata || Array.isArray(metadata)) {
    return undefined;
  }

  return normalizeToolCallTransportKind(
    metadata.tool_transport_override
    ?? metadata.toolTransportOverride
    ?? metadata.tool_transport
    ?? metadata.toolTransport,
  );
}

export class ToolCallTransportResolver {
  constructor(
    private readonly isTransportAllowedInPromptMode: PromptModeTransportAvailabilityResolver =
      isToolCallTransportAllowedInPromptMode,
  ) {}

  resolve(input: ToolCallTransportResolveInput): ToolCallTransportSelection {
    if (!input.toolsEnabled) {
      return {
        transport: "none",
        reasonCode: "tools_disabled",
        reasonDetail: "No callable tools are enabled for the current turn.",
      };
    }

    if (input.explicitTransport) {
      if (!this.isTransportAllowedInPromptMode(input.promptMode, input.explicitTransport)) {
        return {
          transport: "none",
          reasonCode: "override_rejected_by_mode",
          reasonDetail: `Tool transport '${input.explicitTransport}' is not allowed in prompt mode '${input.promptMode}'.`,
        };
      }

      return {
        transport: input.explicitTransport,
        reasonCode: "explicit_override",
        reasonDetail: `Tool transport was explicitly overridden to '${input.explicitTransport}'.`,
      };
    }

    const selection = input.capabilities?.supportsFunctionCall === false
      ? {
          transport: "text_protocol" as const,
          reasonCode: "instance_not_supports_function_call" as const,
          reasonDetail: "The resolved narrator instance declared native function call support as false.",
        }
      : {
          transport: "native_function_call" as const,
          reasonCode: "default_native_function_call" as const,
          reasonDetail: "Using the default native function call transport.",
        };

    if (!this.isTransportAllowedInPromptMode(input.promptMode, selection.transport)) {
      return {
        transport: "none",
        reasonCode: "mode_disallows_transport",
        reasonDetail: `Tool transport '${selection.transport}' is not allowed in prompt mode '${input.promptMode}'.`,
      };
    }

    return selection;
  }
}

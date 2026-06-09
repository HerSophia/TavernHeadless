import type { ToolCallTransportKind, ToolCallTransportSelection } from "@tavern/core";

import { parseJsonField } from "../../lib/http.js";

export interface ToolCallTransportResolveInput {
  sessionId: string;
  branchId?: string;
  promptMode: "compat_strict" | "compat_plus" | "native";
  explicitTransport?: ToolCallTransportKind;
  toolsEnabled: boolean;
  llmInstanceSupportsFunctionCall?: boolean;
}

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
  resolve(input: ToolCallTransportResolveInput): ToolCallTransportSelection {
    if (!input.toolsEnabled) {
      return {
        transport: "none",
        reasonCode: "tools_disabled",
        reasonDetail: "No callable tools are enabled for the current turn.",
      };
    }

    if (input.explicitTransport) {
      return {
        transport: input.explicitTransport,
        reasonCode: "explicit_override",
        reasonDetail: `Tool transport was explicitly overridden to '${input.explicitTransport}'.`,
      };
    }

    if (input.llmInstanceSupportsFunctionCall === false) {
      return {
        transport: "text_protocol",
        reasonCode: "instance_not_supports_function_call",
        reasonDetail: "The resolved narrator instance declared native function call support as false.",
      };
    }

    return {
      transport: "native_function_call",
      reasonCode: "default_native_function_call",
      reasonDetail: "Using the default native function call transport.",
    };
  }
}

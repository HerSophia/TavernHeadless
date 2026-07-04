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

/**
 * 图助手用户可选的工具调用协议偏好（每回合请求级，见原生 function calling 设计 §4.7）。
 *
 * - `auto`：默认。按 provider 能力自动选——能力支持原生则 native，否则 text_protocol。
 * - `native`：用户显式要求原生 function calling；provider 明确不支持时安全回退 text_protocol。
 * - `text_protocol`：用户显式要求文本协议。
 */
export type ToolTransportPreference = "auto" | "native" | "text_protocol";

/** 把任意输入归一化为合法的工具调用协议偏好；非法 / 缺省视为 `auto`。 */
export function normalizeToolTransportPreference(value: unknown): ToolTransportPreference {
  return value === "native" || value === "text_protocol" ? value : "auto";
}

/**
 *把图助手协议偏好落到具体 transport override（见设计 §4.6 / §4.7）。
 *
 * - `auto`：`supportsFunctionCall === false` → text_protocol，否则 native。
 * - `native`：强制 native；但 provider 明确不支持（`=== false`）时安全回退 text_protocol，不报错。
 * - `text_protocol`：强制 text_protocol。
 *
 * 返回选定 transport 与是否发生 native→text_protocol 的安全回退（`nativeFellBack`），
 * 供调用方做可观测记录；回退本身不抛错（设计 §4.7.1）。
 */
export function resolveGraphAssistantToolTransport(
  preference: ToolTransportPreference,
  supportsFunctionCall: boolean | undefined,
): { transport: Exclude<ToolCallTransportKind, "none">; nativeFellBack: boolean } {
  if (preference === "text_protocol") {
   return { transport: "text_protocol", nativeFellBack: false };
  }
  if (preference === "native") {
    if (supportsFunctionCall === false) {
      return { transport: "text_protocol", nativeFellBack: true };
    }
    return { transport: "native_function_call", nativeFellBack: false };
  }
  return {
    transport: supportsFunctionCall === false ? "text_protocol" : "native_function_call",
    nativeFellBack: false,
  };
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

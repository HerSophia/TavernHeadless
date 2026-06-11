export type LlmInstanceSlot = "*" | "narrator" | "director" | "verifier" | "memory";

export type LlmProvider = "anthropic" | "deepseek" | "google" | "openai" | "openai-compatible" | "xai";

export type LlmProfileStatus = "active" | "deleted" | "disabled";

export type LlmGenerationParams = {
  frequency_penalty?: number | null;
  max_context_tokens?: number | null;
  max_output_tokens?: number | null;
  max_retries?: number | null;
  presence_penalty?: number | null;
  reasoning_effort?: "low" | "medium" | "high" | null;
  stop_sequences?: string[] | null;
  stream?: boolean | null;
  temperature?: number | null;
  timeout_ms?: number | null;
  top_k?: number | null;
  top_p?: number | null;
};

export type LlmInstanceCapabilities = {
  supportsFunctionCall: boolean;
  supportsToolChoice: boolean;
  supportsStreamingToolCall: boolean;
  unsupportedGenerationParams: string[];
};

export type LlmInstanceScope = "global" | "session";

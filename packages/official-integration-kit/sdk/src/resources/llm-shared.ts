export type LlmInstanceSlot = "*" | "narrator" | "director" | "verifier" | "memory";

export type LlmProvider = "anthropic" | "deepseek" | "google" | "openai" | "openai-compatible" | "xai";

export type LlmProfileStatus = "active" | "deleted" | "disabled";

export type LlmGenerationParams = {
  frequency_penalty?: number;
  max_context_tokens?: number;
  max_output_tokens?: number;
  max_retries?: number;
  presence_penalty?: number;
  stream?: boolean;
  temperature?: number;
  timeout_ms?: number;
  top_k?: number;
  top_p?: number;
};

export type LlmInstanceScope = "global" | "session";

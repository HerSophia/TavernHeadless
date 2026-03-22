/**
 * LLM Provider Discovery & Test helpers.
 *
 * Extracted from llm-profiles.ts to reduce file size (F011).
 */

import { z } from "zod";

// ── Provider schema (re-declared to avoid circular import) ──

const providerValues = ["openai", "anthropic", "google", "deepseek", "xai", "openai-compatible"] as const;
type ProviderValue = (typeof providerValues)[number];

// ── Types ─────────────────────────────────────────────

export type RuntimeParamsResponse = {
  max_context_tokens?: number;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  timeout_ms?: number;
  max_retries?: number;
  reasoning_effort?: "low" | "medium" | "high";
};

export type RuntimeSlotResponse = {
  model_id: string;
  params: RuntimeParamsResponse | null;
  preset_name: string | null;
  profile_id: string | null;
  provider: string;
  scope: "global" | "session" | null;
  slot: "*" | "narrator" | "director" | "verifier" | "memory";
  source: "env" | "global_profile" | "session_profile";
};

export type DiscoveredModelResponse = {
  id: string;
  label: string;
};

export type TestedModelResponse = {
  request_text: string;
  response_text: string;
};

// ── Error classes ─────────────────────────────────────

export class LlmModelDiscoveryError extends Error {
  readonly code: "model_discovery_failed" | "model_discovery_invalid_response";
  readonly statusCode: number;

  constructor(
    code: "model_discovery_failed" | "model_discovery_invalid_response",
    message: string,
    statusCode = 502,
  ) {
    super(message);
    this.name = "LlmModelDiscoveryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class LlmModelTestError extends Error {
  readonly code: "model_test_failed" | "model_test_invalid_response";
  readonly statusCode: number;
  readonly upstreamStatus?: number;

  constructor(
    code: "model_test_failed" | "model_test_invalid_response",
    message: string,
    statusCode = 502,
    upstreamStatus?: number,
  ) {
    super(message);
    this.name = "LlmModelTestError";
    this.code = code;
    this.statusCode = statusCode;
    this.upstreamStatus = upstreamStatus;
  }
}

// ── Public API ────────────────────────────────────────

export async function discoverModels(input: {
  apiKey: string;
  baseUrl?: string;
  provider: ProviderValue;
}): Promise<DiscoveredModelResponse[]> {
  const request = buildProviderModelRequest(input);

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "GET",
      headers: request.headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new LlmModelDiscoveryError("model_discovery_failed", "Model discovery request failed");
  }

  if (!response.ok) {
    throw new LlmModelDiscoveryError(
      "model_discovery_failed",
      `Model discovery request failed with status ${response.status}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LlmModelDiscoveryError("model_discovery_invalid_response", "Model discovery response is not valid JSON");
  }

  return parseDiscoveredModels(payload);
}

export async function testProviderModelWithHello(input: {
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  provider: ProviderValue;
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<TestedModelResponse> {
  const strategies = buildProviderHelloProbeStrategies(input.provider);
  let lastError: LlmModelTestError | null = null;

  for (let index = 0; index < strategies.length; index += 1) {
    const strategy = strategies[index]!;
    const attempt = await attemptProviderHelloProbe(input, strategy);
    if (attempt.ok) {
      return attempt.value;
    }

    lastError = attempt.error;
    const hasNextStrategy = index < strategies.length - 1;
    if (!hasNextStrategy || !shouldRetryModelTestWithFallback(input.provider, attempt.error)) {
      throw attempt.error;
    }
  }

  throw lastError ?? new LlmModelTestError("model_test_failed", "Model test request failed");
}

// ── Internal helpers ──────────────────────────────────

const PROVIDER_DEFAULT_BASE_URLS: Record<ProviderValue, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  deepseek: "https://api.deepseek.com/v1",
  xai: "https://api.x.ai/v1",
  "openai-compatible": process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
};

type HelloProbeStrategy =
  | { kind: "provider-native" }
  | { kind: "chat-completions"; stream: boolean }
  | { kind: "responses"; stream: boolean };

function buildProviderHelloProbeStrategies(provider: ProviderValue): HelloProbeStrategy[] {
  if (!isOpenAICompatibleProvider(provider)) {
    return [{ kind: "provider-native" }];
  }

  return [
    { kind: "chat-completions", stream: false },
    { kind: "chat-completions", stream: true },
    { kind: "responses", stream: false },
    { kind: "responses", stream: true },
  ];
}

function buildProviderModelRequest(input: {
  apiKey: string;
  baseUrl?: string;
  provider: ProviderValue;
}): { headers: Record<string, string>; url: string } {
  if (input.provider === "anthropic") {
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? PROVIDER_DEFAULT_BASE_URLS.anthropic);
    return {
      url: buildProviderUrl(baseUrl, "models"),
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      },
    };
  }

  if (input.provider === "google") {
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? PROVIDER_DEFAULT_BASE_URLS.google);
    const requestUrl = new URL(buildProviderUrl(baseUrl, "models"));
    requestUrl.searchParams.set("key", input.apiKey);
    return {
      url: requestUrl.toString(),
      headers: {
        "x-goog-api-key": input.apiKey,
      },
    };
  }

  const defaultBaseUrl = PROVIDER_DEFAULT_BASE_URLS[input.provider];
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? defaultBaseUrl);
  return {
    url: buildProviderUrl(baseUrl, "models"),
    headers: {
      authorization: `Bearer ${input.apiKey}`,
    },
  };
}

async function attemptProviderHelloProbe(
  input: {
    apiKey: string;
    baseUrl?: string;
    modelId: string;
    provider: ProviderValue;
    reasoningEffort?: "low" | "medium" | "high";
  },
  strategy: HelloProbeStrategy,
): Promise<{ ok: true; value: TestedModelResponse } | { ok: false; error: LlmModelTestError }> {
  try {
    return {
      ok: true,
      value: await executeProviderHelloProbe(input, strategy),
    };
  } catch (error) {
    if (error instanceof LlmModelTestError) {
      return {
        ok: false,
        error,
      };
    }

    throw error;
  }
}

async function executeProviderHelloProbe(
  input: {
    apiKey: string;
    baseUrl?: string;
    modelId: string;
    provider: ProviderValue;
    reasoningEffort?: "low" | "medium" | "high";
  },
  strategy: HelloProbeStrategy,
): Promise<TestedModelResponse> {
  const request = buildProviderHelloRequest(input, strategy);
  const streamRequested = strategy.kind !== "provider-native" && strategy.stream;

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new LlmModelTestError("model_test_failed", "Model test request failed");
  }

  if (!response.ok) {
    throw new LlmModelTestError(
      "model_test_failed",
      `Model test request failed with status ${response.status}`,
      502,
      response.status,
    );
  }

  const contentType = response.headers.get("content-type");
  let rawText: string;
  try {
    rawText = await response.text();
  } catch {
    throw new LlmModelTestError("model_test_invalid_response", "Model test response body could not be read");
  }

  const responseText = parseTestedModelResponseBody(input.provider, rawText, contentType, streamRequested);
  return {
    request_text: "Hello",
    response_text: responseText,
  };
}

function shouldRetryModelTestWithFallback(
  provider: ProviderValue,
  error: LlmModelTestError,
): boolean {
  if (!isOpenAICompatibleProvider(provider)) {
    return false;
  }

  if (error.code === "model_test_invalid_response") {
    return true;
  }

  if (error.code !== "model_test_failed") {
    return false;
  }

  if (error.upstreamStatus === undefined) {
    return false;
  }

  return error.upstreamStatus === 400
    || error.upstreamStatus === 405
    || error.upstreamStatus === 415
    || error.upstreamStatus === 422
    || error.upstreamStatus >= 500;
}

function isOpenAICompatibleProvider(provider: ProviderValue): boolean {
  return provider === "openai"
    || provider === "deepseek"
    || provider === "xai"
    || provider === "openai-compatible";
}

function buildProviderHelloRequest(input: {
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  provider: ProviderValue;
  reasoningEffort?: "low" | "medium" | "high";
}, strategy: HelloProbeStrategy): { body: Record<string, unknown>; headers: Record<string, string>; url: string } {
  if (input.provider === "anthropic") {
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? PROVIDER_DEFAULT_BASE_URLS.anthropic);
    return {
      url: buildProviderUrl(baseUrl, "messages"),
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: input.modelId,
        max_tokens: 64,
        messages: [{ role: "user", content: "Hello" }],
      },
    };
  }

  if (input.provider === "google") {
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? PROVIDER_DEFAULT_BASE_URLS.google);
    const normalizedModelId = input.modelId.replace(/^models\//, "");
    const requestUrl = new URL(buildProviderUrl(baseUrl, `models/${normalizedModelId}:generateContent`));
    requestUrl.searchParams.set("key", input.apiKey);
    return {
      url: requestUrl.toString(),
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: {
        contents: [
          {
            role: "user",
            parts: [{ text: "Hello" }],
          },
        ],
      },
    };
  }

  const defaultBaseUrl = PROVIDER_DEFAULT_BASE_URLS[input.provider];
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? defaultBaseUrl);

  if (strategy.kind === "responses") {
    return {
      url: buildProviderUrl(baseUrl, "responses"),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: {
        model: input.modelId,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Hello" }],
          },
        ],
        max_output_tokens: 64,
        ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
        ...(strategy.stream ? { stream: true } : {}),
      },
    };
  }

  return {
    url: buildProviderUrl(baseUrl, "chat/completions"),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`,
    },
    body: {
      model: input.modelId,
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 64,
      temperature: 0,
      ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
      ...(strategy.kind === "chat-completions" && strategy.stream ? { stream: true } : {}),
    },
  };
}

function parseTestedModelResponseBody(
  provider: ProviderValue,
  rawText: string,
  contentType: string | null,
  streamRequested: boolean,
): string {
  const shouldTryStream = streamRequested || Boolean(contentType?.includes("text/event-stream"));
  if (shouldTryStream) {
    const streamedText = parseStreamedTestedModelResponse(provider, rawText);
    if (streamedText) {
      return streamedText;
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new LlmModelTestError("model_test_invalid_response", "Model test response is not valid JSON");
  }

  return parseTestedModelResponse(provider, payload);
}

function parseStreamedTestedModelResponse(
  provider: ProviderValue,
  rawText: string,
): string | null {
  if (!isOpenAICompatibleProvider(provider)) {
    return null;
  }

  return extractOpenAICompatibleStreamText(rawText);
}

function extractOpenAICompatibleStreamText(rawText: string): string | null {
  const chunks: string[] = [];

  for (const payloadText of extractSseDataPayloads(rawText)) {
    if (payloadText === "[DONE]") {
      continue;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      continue;
    }

    if (!payload || typeof payload !== "object") {
      continue;
    }

    const chunkText = extractOpenAICompatibleStreamChunk(payload as Record<string, unknown>);
    if (chunkText) {
      chunks.push(chunkText);
    }
  }

  const text = chunks.join("").trim();
  return text || null;
}

function extractSseDataPayloads(rawText: string): string[] {
  const payloads: string[] = [];
  let current: string[] = [];

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.length === 0) {
      if (current.length > 0) {
        payloads.push(current.join("\n"));
        current = [];
      }
      continue;
    }

    if (line.startsWith("data:")) {
      current.push(line.slice(5).trimStart());
    }
  }

  if (current.length > 0) {
    payloads.push(current.join("\n"));
  }

  return payloads;
}

function parseTestedModelResponse(provider: ProviderValue, payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new LlmModelTestError("model_test_invalid_response", "Model test response payload is invalid");
  }

  const record = payload as Record<string, unknown>;
  if (provider === "anthropic") {
    const text = extractAnthropicText(record);
    if (!text) {
      throw new LlmModelTestError("model_test_invalid_response", "Model test response missing anthropic text content");
    }

    return text;
  }

  if (provider === "google") {
    const text = extractGoogleText(record);
    if (!text) {
      throw new LlmModelTestError("model_test_invalid_response", "Model test response missing google text content");
    }

    return text;
  }

  const text = extractOpenAICompatibleText(record);
  if (!text) {
    throw new LlmModelTestError("model_test_invalid_response", "Model test response missing completion content");
  }

  return text;
}

function extractOpenAICompatibleText(payload: Record<string, unknown>): string | null {
  if (Array.isArray(payload.choices) && payload.choices.length > 0) {
    const first = payload.choices[0];
    if (!first || typeof first !== "object") {
      return null;
    }

    const message = (first as Record<string, unknown>).message;
    if (!message || typeof message !== "object") {
      return null;
    }

    const content = (message as Record<string, unknown>).content;
    if (typeof content === "string") {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }

          const value = (part as Record<string, unknown>).text;
          return typeof value === "string" ? value : "";
        })
        .join("")
        .trim();

      return text || null;
    }
  }

  const outputText = extractResponseOutputText(payload);
  if (outputText) {
    return outputText;
  }

  return null;
}

function extractOpenAICompatibleStreamChunk(payload: Record<string, unknown>): string {
  if (typeof payload.delta === "string") {
    return payload.delta;
  }

  if (Array.isArray(payload.choices)) {
    return payload.choices
      .map((choice) => {
        if (!choice || typeof choice !== "object") {
          return "";
        }

        const record = choice as Record<string, unknown>;
        const delta = record.delta;
        if (delta && typeof delta === "object") {
          const deltaText = extractTextContent((delta as Record<string, unknown>).content);
          if (deltaText) {
            return deltaText;
          }
        }

        const message = record.message;
        if (message && typeof message === "object") {
          const messageText = extractTextContent((message as Record<string, unknown>).content);
          if (messageText) {
            return messageText;
          }
        }

        return typeof record.text === "string" ? record.text : "";
      })
      .join("");
  }

  const outputText = extractResponseOutputText(payload);
  return outputText ?? "";
}

function extractResponseOutputText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string") {
    const outputText = payload.output_text.trim();
    return outputText || null;
  }

  if (!Array.isArray(payload.output)) {
    return null;
  }

  const text = payload.output
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      return extractTextContent((item as Record<string, unknown>).content) ?? "";
    })
    .join("")
    .trim();

  return text || null;
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") {
        return record.text;
      }

      return typeof record.delta === "string" ? record.delta : "";
    })
    .join("");

  return text || null;
}

function extractAnthropicText(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.content)) {
    return null;
  }

  const text = payload.content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const entry = part as Record<string, unknown>;
      return typeof entry.text === "string" ? entry.text : "";
    })
    .join("")
    .trim();

  return text || null;
}

function extractGoogleText(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    return null;
  }

  const first = payload.candidates[0];
  if (!first || typeof first !== "object") {
    return null;
  }

  const content = (first as Record<string, unknown>).content;
  if (!content || typeof content !== "object") {
    return null;
  }

  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) {
    return null;
  }

  const text = parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const entry = part as Record<string, unknown>;
      return typeof entry.text === "string" ? entry.text : "";
    })
    .join("")
    .trim();

  return text || null;
}

function parseDiscoveredModels(payload: unknown): DiscoveredModelResponse[] {
  if (!payload || typeof payload !== "object") {
    throw new LlmModelDiscoveryError("model_discovery_invalid_response", "Model discovery response payload is invalid");
  }

  const rowList = extractModelRows(payload as Record<string, unknown>);
  const models = rowList
    .map((row) => toDiscoveredModel(row))
    .filter((row): row is DiscoveredModelResponse => row !== null);

  const unique = new Map<string, DiscoveredModelResponse>();
  for (const model of models) {
    if (!unique.has(model.id)) {
      unique.set(model.id, model);
    }
  }

  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function extractModelRows(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(payload.data)) {
    return payload.data.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  }

  if (Array.isArray(payload.models)) {
    return payload.models.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  }

  throw new LlmModelDiscoveryError("model_discovery_invalid_response", "Model discovery response does not contain model list");
}

function toDiscoveredModel(row: Record<string, unknown>): DiscoveredModelResponse | null {
  const rawId =
    typeof row.id === "string"
      ? row.id
      : typeof row.name === "string"
        ? row.name
        : null;

  if (!rawId) {
    return null;
  }

  const id = rawId.replace(/^models\//, "").trim();
  if (!id) {
    return null;
  }

  const rawLabel =
    typeof row.display_name === "string"
      ? row.display_name
      : typeof row.displayName === "string"
        ? row.displayName
        : typeof row.name === "string"
          ? row.name
          : typeof row.id === "string"
            ? row.id
            : id;

  return {
    id,
    label: rawLabel.replace(/^models\//, ""),
  };
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildProviderUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ""), baseUrl).toString();
}

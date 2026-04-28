import { describe, expect, it } from "vitest";

import { NativePipelineError } from "@tavern/core";

import { findNativePipelineError } from "../src/lib/native-pipeline-error";
import { ChatServiceError } from "../src/services/chat/chat-service";

function createNativePipelineError(): NativePipelineError {
  return new NativePipelineError({
    nodeName: "template",
    inputSummary: {
      systemPromptLength: 42,
      chatHistoryCount: 2,
      worldbookEntryCount: 1,
      hasVariables: true,
      hasMemorySummary: false,
      maxTokens: 4096,
      reservedForReply: 512,
    },
    stateSummary: {
      sectionCount: 1,
      sectionNames: ["nativeSystem"],
      messageCount: 2,
      executedNodes: ["template"],
    },
    cause: new Error("template render failed"),
  });
}

describe("findNativePipelineError", () => {
  it("returns the error when input is NativePipelineError", () => {
    const nativeError = createNativePipelineError();

    expect(findNativePipelineError(nativeError)).toBe(nativeError);
  });

  it("unwraps NativePipelineError from error cause chain", () => {
    const nativeError = createNativePipelineError();
    const wrapped = new ChatServiceError("orchestration_failed", "Prompt assembly failed", nativeError);

    expect(findNativePipelineError(wrapped)).toBe(nativeError);
  });

  it("returns null for cyclic error causes without hanging", () => {
    const cyclic = new Error("cyclic") as Error & { cause?: unknown };
    cyclic.cause = cyclic;

    expect(findNativePipelineError(cyclic)).toBeNull();
  });
});

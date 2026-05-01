import { describe, expect, it } from "vitest";

import {
  buildPromptRuntimeMemoryTrace,
  resolveMemoryRuntimeMode,
  resolveMemoryWritePolicy,
} from "../../memory/shared/index.js";

describe("memory runtime shared helpers", () => {
  it("resolves runtime mode from memory store availability and async ingest flag", () => {
    expect(resolveMemoryRuntimeMode({
      memoryStoreEnabled: false,
      enableAsyncMemoryIngest: true,
    })).toBe("disabled");

    expect(resolveMemoryRuntimeMode({
      memoryStoreEnabled: true,
      enableAsyncMemoryIngest: false,
    })).toBe("legacy_sync");

    expect(resolveMemoryRuntimeMode({
      memoryStoreEnabled: true,
      enableAsyncMemoryIngest: true,
    })).toBe("async_primary");
  });

  it("derives requested and effective write policy from turn config and runtime mode", () => {
    expect(resolveMemoryWritePolicy({
      memoryStoreEnabled: true,
      enableAsyncMemoryIngest: true,
      config: { enableMemoryConsolidation: true },
    })).toEqual({
      runtimeMode: "async_primary",
      requestedWrite: true,
      effectiveWrite: true,
    });

    expect(resolveMemoryWritePolicy({
      memoryStoreEnabled: false,
      enableAsyncMemoryIngest: true,
      config: { enableMemoryConsolidation: true },
    })).toEqual({
      runtimeMode: "disabled",
      requestedWrite: true,
      effectiveWrite: false,
    });

    expect(resolveMemoryWritePolicy({
      memoryStoreEnabled: true,
      enableAsyncMemoryIngest: false,
      config: { enableMemoryConsolidation: false },
    })).toEqual({
      runtimeMode: "legacy_sync",
      requestedWrite: false,
      effectiveWrite: false,
    });
  });

  it("projects prompt runtime memory trace from summary injection and write policy", () => {
    expect(buildPromptRuntimeMemoryTrace({
      summaryInjected: true,
      memoryTrace: {
        runtimeMode: "legacy_sync",
        requestedWrite: true,
        effectiveWrite: true,
      },
    })).toEqual({
      summaryInjected: true,
      runtimeMode: "legacy_sync",
      requestedWrite: true,
      effectiveWrite: true,
    });
  });
});

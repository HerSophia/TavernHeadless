import type { TurnConfig } from "@tavern/core";

export type MemoryRuntimeMode = "disabled" | "legacy_sync" | "async_primary";

export interface MemoryWritePolicyTrace {
  runtimeMode: MemoryRuntimeMode;
  requestedWrite: boolean;
  effectiveWrite: boolean;
}

export function resolveMemoryRuntimeMode(args: {
  memoryStoreEnabled: boolean;
  enableAsyncMemoryIngest: boolean;
}): MemoryRuntimeMode {
  if (!args.memoryStoreEnabled) {
    return "disabled";
  }

  return args.enableAsyncMemoryIngest ? "async_primary" : "legacy_sync";
}

export function resolveRequestedMemoryWrite(
  config?: Pick<TurnConfig, "enableMemoryConsolidation">,
): boolean {
  return config?.enableMemoryConsolidation === true;
}

export function resolveMemoryWritePolicy(args: {
  memoryStoreEnabled: boolean;
  enableAsyncMemoryIngest: boolean;
  config?: Pick<TurnConfig, "enableMemoryConsolidation">;
}): MemoryWritePolicyTrace {
  const runtimeMode = resolveMemoryRuntimeMode({
    memoryStoreEnabled: args.memoryStoreEnabled,
    enableAsyncMemoryIngest: args.enableAsyncMemoryIngest,
  });
  const requestedWrite = resolveRequestedMemoryWrite(args.config);

  return {
    runtimeMode,
    requestedWrite,
    effectiveWrite: runtimeMode !== "disabled" && requestedWrite,
  };
}

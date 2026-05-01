import type {
  PromptRuntimeGovernanceView as PromptRuntimeGovernanceViewModel,
  PromptRuntimeSourceMap,
} from "./control-service.js";

export type PromptRuntimeExplainSnapshotVersion = 1 | 2 | 3;

interface PromptRuntimeExplainSourceMapEnvelopeV2 {
  sourceMap: PromptRuntimeSourceMap;
  governance: PromptRuntimeGovernanceViewModel | null;
}

export function normalizePromptRuntimeExplainSnapshotVersion(
  value: number | null | undefined,
): PromptRuntimeExplainSnapshotVersion {
  return value === 3 ? 3 : value === 2 ? 2 : 1;
}

export function serializePromptRuntimeExplainSourceMapEnvelope(args: {
  snapshotVersion: PromptRuntimeExplainSnapshotVersion;
  sourceMap: PromptRuntimeSourceMap;
  governance?: PromptRuntimeGovernanceViewModel | null;
}): string {
  if (args.snapshotVersion >= 2) {
    return JSON.stringify({
      sourceMap: args.sourceMap,
      governance: args.governance ?? null,
    } satisfies PromptRuntimeExplainSourceMapEnvelopeV2);
  }

  return JSON.stringify(args.sourceMap);
}

export function parsePromptRuntimeExplainSourceMapEnvelope(args: {
  snapshotVersion: number | null | undefined;
  sourceMapJson: string | null | undefined;
}): {
  snapshotVersion: PromptRuntimeExplainSnapshotVersion;
  sourceMap: PromptRuntimeSourceMap;
  governance: PromptRuntimeGovernanceViewModel | null;
} {
  const snapshotVersion = normalizePromptRuntimeExplainSnapshotVersion(args.snapshotVersion);
  if (!args.sourceMapJson) {
    return {
      snapshotVersion,
      sourceMap: {},
      governance: null,
    };
  }

  try {
    const parsed = JSON.parse(args.sourceMapJson) as unknown;
    if (
      snapshotVersion >= 2
      && parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && Object.prototype.hasOwnProperty.call(parsed, "sourceMap")
    ) {
      const envelope = parsed as Partial<PromptRuntimeExplainSourceMapEnvelopeV2>;
      return {
        snapshotVersion,
        sourceMap: envelope.sourceMap && typeof envelope.sourceMap === "object" && !Array.isArray(envelope.sourceMap)
          ? envelope.sourceMap
          : {},
        governance: envelope.governance && typeof envelope.governance === "object" && !Array.isArray(envelope.governance)
          ? envelope.governance as PromptRuntimeGovernanceViewModel
          : null,
      };
    }

    return {
      snapshotVersion,
      sourceMap: parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as PromptRuntimeSourceMap
        : {},
      governance: null,
    };
  } catch {
    return {
      snapshotVersion,
      sourceMap: {},
      governance: null,
    };
  }
}

import type {
  PromptRuntimeGovernanceView as PromptRuntimeGovernanceViewModel,
  PromptRuntimeSourceMap,
} from "./control-service.js";
import type { PromptRuntimeHistoryNormalizationSummary } from "../chat/conversation-history-normalizer.js";

export type PromptRuntimeExplainSnapshotVersion = 1 | 2 | 3 | 4;

interface PromptRuntimeExplainSourceMapEnvelopeV2 {
  sourceMap: PromptRuntimeSourceMap;
  governance: PromptRuntimeGovernanceViewModel | null;
}

interface PromptRuntimeExplainSourceMapEnvelopeV4 extends PromptRuntimeExplainSourceMapEnvelopeV2 {
  historyNormalization: PromptRuntimeHistoryNormalizationSummary | null;
}

export function normalizePromptRuntimeExplainSnapshotVersion(
  value: number | null | undefined,
): PromptRuntimeExplainSnapshotVersion {
  return value === 4 ? 4 : value === 3 ? 3 : value === 2 ? 2 : 1;
}

export function serializePromptRuntimeExplainSourceMapEnvelope(args: {
  snapshotVersion: PromptRuntimeExplainSnapshotVersion;
  sourceMap: PromptRuntimeSourceMap;
  governance?: PromptRuntimeGovernanceViewModel | null;
  historyNormalization?: PromptRuntimeHistoryNormalizationSummary;
}): string {
  if (args.snapshotVersion >= 4) {
    return JSON.stringify({
      sourceMap: args.sourceMap,
      governance: args.governance ?? null,
      historyNormalization: args.historyNormalization ?? null,
    } satisfies PromptRuntimeExplainSourceMapEnvelopeV4);
  }

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
  historyNormalization: PromptRuntimeHistoryNormalizationSummary | null;
} {
  const snapshotVersion = normalizePromptRuntimeExplainSnapshotVersion(args.snapshotVersion);
  if (!args.sourceMapJson) {
    return {
      snapshotVersion,
      sourceMap: {},
      governance: null,
      historyNormalization: null,
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
      const envelope = parsed as Partial<PromptRuntimeExplainSourceMapEnvelopeV4>;
      return {
        snapshotVersion,
        sourceMap: envelope.sourceMap && typeof envelope.sourceMap === "object" && !Array.isArray(envelope.sourceMap)
          ? envelope.sourceMap
          : {},
        governance: envelope.governance && typeof envelope.governance === "object" && !Array.isArray(envelope.governance)
          ? envelope.governance as PromptRuntimeGovernanceViewModel
          : null,
        historyNormalization: snapshotVersion >= 4 && envelope.historyNormalization && typeof envelope.historyNormalization === "object" && !Array.isArray(envelope.historyNormalization)
          ? envelope.historyNormalization as PromptRuntimeHistoryNormalizationSummary
          : null,
      };
    }

    return {
      snapshotVersion,
      sourceMap: parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as PromptRuntimeSourceMap
        : {},
      governance: null,
      historyNormalization: null,
    };
  } catch {
    return {
      snapshotVersion,
      sourceMap: {},
      governance: null,
      historyNormalization: null,
    };
  }
}

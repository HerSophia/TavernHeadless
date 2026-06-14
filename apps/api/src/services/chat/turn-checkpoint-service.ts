import { createHash } from "node:crypto";

import type {
  TurnAttemptFingerprint,
  TurnAttemptIdentity,
  TurnCheckpointManifest,
  TurnCheckpointManifestItem,
} from "./turn-attempt-types.js";

export interface TurnAttemptFingerprintInput {
  userInputDigest: string;
  promptMode: string;
  promptPolicyDigest?: string;
  promptPolicy?: unknown;
  promptAssetDigest?: string;
  promptAssets?: unknown;
  generationParamsDigest?: string;
  generationParams?: unknown;
  clientInjectionDigest?: string;
  clientInjections?: unknown;
  firstPartyStateDigest?: string;
  firstPartyState?: unknown;
  memoryHeadDigest?: string;
  memoryHead?: unknown;
  worldbookDigest?: string;
  worldbook?: unknown;
}

export interface CheckpointReuseClassification {
  reused: TurnCheckpointManifestItem[];
  rerun: TurnCheckpointManifestItem[];
  invalidationReasons: string[];
}

const FINGERPRINT_KEYS: Array<keyof TurnAttemptFingerprint> = [
  "userInputDigest",
  "promptMode",
  "promptPolicyDigest",
  "promptAssetDigest",
  "generationParamsDigest",
  "clientInjectionDigest",
  "firstPartyStateDigest",
  "memoryHeadDigest",
  "worldbookDigest",
];

/**
 * 构造 R2 的轻量 attempt fingerprint。
 */
export function buildTurnAttemptFingerprint(input: TurnAttemptFingerprintInput): TurnAttemptFingerprint {
  return {
    userInputDigest: input.userInputDigest,
    promptMode: input.promptMode,
    promptPolicyDigest: input.promptPolicyDigest ?? digestUnknown(input.promptPolicy ?? null),
    promptAssetDigest: input.promptAssetDigest ?? digestUnknown(input.promptAssets ?? null),
    generationParamsDigest: input.generationParamsDigest ?? digestUnknown(input.generationParams ?? null),
    clientInjectionDigest: input.clientInjectionDigest ?? digestUnknown(input.clientInjections ?? []),
    ...(input.firstPartyStateDigest || input.firstPartyState !== undefined
      ? { firstPartyStateDigest: input.firstPartyStateDigest ?? digestUnknown(input.firstPartyState ?? null) }
      : {}),
    ...(input.memoryHeadDigest || input.memoryHead !== undefined
      ? { memoryHeadDigest: input.memoryHeadDigest ?? digestUnknown(input.memoryHead ?? null) }
      : {}),
    ...(input.worldbookDigest || input.worldbook !== undefined
      ? { worldbookDigest: input.worldbookDigest ?? digestUnknown(input.worldbook ?? null) }
      : {}),
  };
}

/**
 * 比较前后 fingerprint，并说明哪些内容可复用、哪些内容必须重跑。
 */
export function classifyCheckpointReuse(input: {
  previous?: TurnAttemptFingerprint;
  current: TurnAttemptFingerprint;
}): CheckpointReuseClassification {
  if (!input.previous) {
    return {
      reused: [],
      rerun: FINGERPRINT_KEYS.map((key) => ({
        key,
        scope: scopeForFingerprintKey(key),
        reason: "no_previous_checkpoint",
      })),
      invalidationReasons: ["no_previous_checkpoint"],
    };
  }

  const reused: TurnCheckpointManifestItem[] = [];
  const rerun: TurnCheckpointManifestItem[] = [];
  const invalidationReasons: string[] = [];

  for (const key of FINGERPRINT_KEYS) {
    const previousValue = input.previous[key];
    const currentValue = input.current[key];
    if (previousValue === currentValue) {
      reused.push({
        key,
        scope: scopeForFingerprintKey(key),
        reason: "fingerprint_unchanged",
      });
      continue;
    }

    const reason = `${key}_changed`;
    rerun.push({
      key,
      scope: scopeForFingerprintKey(key),
      reason,
    });
    invalidationReasons.push(reason);
  }

  return { reused, rerun, invalidationReasons };
}

/**
 * 构造 R2 的最小 checkpoint manifest。
 */
export function buildTurnCheckpointManifest(input: {
  attempt: TurnAttemptIdentity;
  fingerprint: TurnAttemptFingerprint;
  previousFingerprint?: TurnAttemptFingerprint;
}): TurnCheckpointManifest {
  const classified = classifyCheckpointReuse({
    previous: input.previousFingerprint,
    current: input.fingerprint,
  });

  return {
    attempt: input.attempt,
    fingerprint: input.fingerprint,
    reused: classified.reused,
    rerun: classified.rerun,
    invalidationReasons: classified.invalidationReasons,
  };
}

function scopeForFingerprintKey(key: keyof TurnAttemptFingerprint): "floor" | "page" | "attempt" {
  switch (key) {
    case "userInputDigest":
    case "firstPartyStateDigest":
    case "memoryHeadDigest":
    case "worldbookDigest":
      return "floor";
    case "promptMode":
    case "promptPolicyDigest":
    case "promptAssetDigest":
    case "generationParamsDigest":
    case "clientInjectionDigest":
      return "attempt";
  }
}

function digestUnknown(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

import { describe, expect, it } from "vitest";

import {
  buildTurnAttemptFingerprint,
  buildTurnCheckpointManifest,
  classifyCheckpointReuse,
} from "../turn-checkpoint-service.js";
import type { TurnAttemptIdentity } from "../turn-attempt-types.js";

const attempt: TurnAttemptIdentity = {
  sessionId: "session-1",
  branchId: "main",
  floorId: "floor-1",
  runId: "run-1",
  runType: "respond",
  attemptNo: 1,
  replayMode: "full_floor_context",
  candidateOutputPageId: "page-1",
  candidateAssistantMessageId: "msg-1",
};

describe("turn-checkpoint-service", () => {
  it("对对象键顺序生成稳定 fingerprint", () => {
    const first = buildTurnAttemptFingerprint({
      userInputDigest: "input",
      promptMode: "native",
      promptPolicy: { b: 2, a: 1 },
      promptAssets: { preset: "p1" },
      generationParams: { temperature: 0.7 },
      clientInjections: [],
    });
    const second = buildTurnAttemptFingerprint({
      userInputDigest: "input",
      promptMode: "native",
      promptPolicy: { a: 1, b: 2 },
      promptAssets: { preset: "p1" },
      generationParams: { temperature: 0.7 },
      clientInjections: [],
    });

    expect(second).toEqual(first);
  });

  it("没有 previous checkpoint 时要求全部重跑", () => {
    const fingerprint = buildTurnAttemptFingerprint({
      userInputDigest: "input",
      promptMode: "native",
      promptPolicyDigest: "policy",
      promptAssetDigest: "asset",
      generationParamsDigest: "params",
      clientInjectionDigest: "injection",
    });

    const classified = classifyCheckpointReuse({ current: fingerprint });

    expect(classified.reused).toHaveLength(0);
    expect(classified.rerun.length).toBeGreaterThan(0);
    expect(classified.invalidationReasons).toContain("no_previous_checkpoint");
  });

  it("fingerprint 变化时记录 invalidation reason", () => {
    const previous = buildTurnAttemptFingerprint({
      userInputDigest: "input",
      promptMode: "native",
      promptPolicyDigest: "policy-a",
      promptAssetDigest: "asset",
      generationParamsDigest: "params",
      clientInjectionDigest: "injection",
    });
    const current = { ...previous, promptPolicyDigest: "policy-b" };

    const manifest = buildTurnCheckpointManifest({ attempt, fingerprint: current, previousFingerprint: previous });

    expect(manifest.rerun).toContainEqual({
      key: "promptPolicyDigest",
      scope: "attempt",
      reason: "promptPolicyDigest_changed",
    });
    expect(manifest.invalidationReasons).toContain("promptPolicyDigest_changed");
  });
});

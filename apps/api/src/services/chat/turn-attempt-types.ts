import type { FloorRunType } from "@tavern/core";

/**
 * R2 支持的聊天主链入口模式。
 */
export type TurnAttemptMode = "respond" | "regenerate" | "retry_floor" | "edit_and_regenerate";

/**
 * R2 的内部重试模式。
 */
export type TurnReplayMode =
  | "response_only"
  | "with_director"
  | "with_context_refresh"
  | "full_floor_context";

/**
 * 一次候选生成的身份。
 *
 * 它不是正史，只用于把 pre_response、response、post_response、commit 连接到同一个候选 attempt。
 */
export interface TurnAttemptIdentity {
  sessionId: string;
  branchId: string;
  floorId: string;
  runId: string;
  runType: FloorRunType;
  attemptNo: number;
  replayMode: TurnReplayMode;
  inputPageId?: string;
  sourceFloorId?: string;
  sourceOutputPageId?: string;
  candidateOutputPageId: string;
  candidateAssistantMessageId: string;
}

/**
 * 一次 attempt 的轻量 fingerprint。
 *
 * R2 只用它解释复用与重跑原因，不把它当作完整 checkpoint 持久化数据源。
 */
export interface TurnAttemptFingerprint {
  userInputDigest: string;
  promptMode: string;
  promptPolicyDigest: string;
  promptAssetDigest: string;
  generationParamsDigest: string;
  clientInjectionDigest: string;
  firstPartyStateDigest?: string;
  memoryHeadDigest?: string;
  worldbookDigest?: string;
}

/**
 * checkpoint manifest 的复用或重跑条目。
 */
export interface TurnCheckpointManifestItem {
  key: string;
  scope: "floor" | "page" | "attempt";
  reason: string;
}

/**
 * R2 的最小 checkpoint manifest。
 */
export interface TurnCheckpointManifest {
  attempt: TurnAttemptIdentity;
  fingerprint: TurnAttemptFingerprint;
  reused: TurnCheckpointManifestItem[];
  rerun: TurnCheckpointManifestItem[];
  invalidationReasons: string[];
}

/**
 * attempt 被判定为 stale 的原因。
 */
export type TurnAttemptStaleReason =
  | "source_page_missing"
  | "source_page_scope_mismatch"
  | "source_page_not_output"
  | "source_page_not_active"
  | "source_floor_superseded"
  | "attempt_not_current";

/**
 * attempt 被后续 attempt 取代的原因。
 */
export type TurnAttemptSupersedeReason =
  | "newer_attempt_started"
  | "run_reinitialized"
  | "floor_replaced";

/**
 * 从 floor_run_state 中读取到的当前 run 身份摘要。
 */
export interface TurnAttemptCurrentSnapshot {
  floorId: string;
  runId: string;
  runType: FloorRunType;
  attemptNo: number;
  status: "running" | "completed" | "failed" | "cancelled";
}

/**
 * 回合 trace 归一化映射（B10 阶段 8，纯函数、可单测）。
 *
 * 把抽屉聚合的多源原始数据（floor run 快照 + promptRuntime 历史 explain 的 governance/result/
 * limitations + 会话 promptMode）归一为四个只读分区：
 * - **承载路径 carrier**：由会话 `promptMode` 推断（`native`→system_graph / `compat_*`→composite），
 *   未知则标 unknown；前端只读后端语义，不自造运行概念。
 * - **floor 阶段进度 phases**：5 个公开阶段 `preparing→generating→verifying→committing→post_processing`，
 *   依 run.publicPhase + run.status 标 done/active/pending。
 * - **CommitGate 决策**：由 verifier 状态映射（passed→allow / warned→warn / blocked→block / skipped / pending）。
 * - **agentic trace**：governance 贡献者（保留/裁剪/置顶）、摘要、token 用量、错误、limitations（受限裁剪提示）。
 *
 * 输入为「已归一的纯数据」（SDK 适配在 `use-turn-trace` 完成），故本函数与 SDK 类型解耦，便于单测。
 */

export const PUBLIC_PHASES = [
  "preparing",
  "generating",
  "verifying",
  "committing",
  "post_processing",
] as const;

export type PublicPhase = (typeof PUBLIC_PHASES)[number];

export type CarrierKind = "composite" | "system_graph" | "unknown";

export type CommitDecision = "allow" | "warn" | "block" | "skipped" | "pending" | "unknown";

export interface VerifierIssue {
  description: string;
  severity: "warning" | "error";
}

export interface RawVerifier {
  status: string;
  issues?: VerifierIssue[] | null;
  suggestion?: string | null;
}

export interface RawGovernanceEntry {
  sourceKind: string;
  sections?: string[];
  tokenCount?: number;
  retainedTokenCount?: number;
  prunedTokenCount?: number;
  pinned?: boolean | null;
}

export interface RawTurnTrace {
  floorId: string;
  floorNo?: number | null;
  state?: string | null;
  /** 会话级 prompt 模式，用于推断承载路径。 */
  promptMode?: string | null;
  publicPhase?: PublicPhase | null;
  runStatus?: string | null;
  runType?: string | null;
  error?: { code: string; message: string } | null;
  verifier?: RawVerifier | null;
  governance?: RawGovernanceEntry[] | null;
  summaries?: string[] | null;
  limitations?: string[] | null;
  tokenUsage?: { input: number; output: number; total: number } | null;
  /** 富数据（governance/result）不可得或被裁剪。 */
  restricted?: boolean;
}

export interface CarrierInfo {
  kind: CarrierKind;
  source: "detected" | "unknown";
}

export interface PhaseStep {
  phase: PublicPhase;
  state: "done" | "active" | "pending";
}

export interface CommitGateView {
  decision: CommitDecision;
  status: string;
  issues: VerifierIssue[];
  suggestion: string | null;
}

export interface GovernanceContributor {
  sourceKind: string;
  sections: string[];
  tokenCount: number;
  retainedTokenCount: number;
  prunedTokenCount: number;
  pinned: boolean;
}

export interface AgenticTraceView {
  governance: GovernanceContributor[];
  summaries: string[];
  limitations: string[];
  tokenUsage: { input: number; output: number; total: number } | null;
  error: { code: string; message: string } | null;
}

export interface TurnTraceView {
  floorId: string;
  floorNo: number | null;
  floorState: string | null;
  runStatus: string | null;
  runType: string | null;
  carrier: CarrierInfo;
  phases: PhaseStep[];
  commitGate: CommitGateView;
  agentic: AgenticTraceView;
  restricted: boolean;
}

function buildCarrier(promptMode: string | null | undefined): CarrierInfo {
  if (promptMode === "native") {
    return { kind: "system_graph", source: "detected" };
  }
  if (promptMode === "compat_strict" || promptMode === "compat_plus") {
    return { kind: "composite", source: "detected" };
  }
  return { kind: "unknown", source: "unknown" };
}

function buildPhases(
  publicPhase: PublicPhase | null | undefined,
  runStatus: string | null | undefined,
): PhaseStep[] {
  if (!publicPhase) {
    return PUBLIC_PHASES.map((phase) => ({ phase, state: "pending" }));
  }
  const completed = runStatus === "completed";
  const index = PUBLIC_PHASES.indexOf(publicPhase);
  return PUBLIC_PHASES.map((phase, i) => {
    if (completed || i < index) {
      return { phase, state: "done" };
    }
    if (i === index) {
      return { phase, state: "active" };
    }
    return { phase, state: "pending" };
  });
}

function verifierDecision(status: string): CommitDecision {
  switch (status) {
    case "passed":
      return "allow";
    case "warned":
      return "warn";
    case "blocked":
      return "block";
    case "skipped":
      return "skipped";
    case "pending":
      return "pending";
    default:
      return "unknown";
  }
}

function buildCommitGate(verifier: RawVerifier | null | undefined): CommitGateView {
  if (!verifier) {
    return { decision: "unknown", status: "none", issues: [], suggestion: null };
  }
  return {
    decision: verifierDecision(verifier.status),
    status: verifier.status,
    issues: verifier.issues ?? [],
    suggestion: verifier.suggestion ?? null,
  };
}

function buildGovernance(entries: RawGovernanceEntry[] | null | undefined): GovernanceContributor[] {
  if (!entries) {
    return [];
  }
  return entries.map((entry) => ({
    sourceKind: entry.sourceKind,
    sections: entry.sections ?? [],
    tokenCount: entry.tokenCount ?? 0,
    retainedTokenCount: entry.retainedTokenCount ?? 0,
    prunedTokenCount: entry.prunedTokenCount ?? 0,
    pinned: entry.pinned === true,
  }));
}

/** 归一一条回合的多源 trace 为只读视图。 */
export function mapTurnTrace(raw: RawTurnTrace): TurnTraceView {
  return {
    floorId: raw.floorId,
    floorNo: raw.floorNo ?? null,
    floorState: raw.state ?? null,
    runStatus: raw.runStatus ?? null,
    runType: raw.runType ?? null,
    carrier: buildCarrier(raw.promptMode),
    phases: buildPhases(raw.publicPhase, raw.runStatus),
    commitGate: buildCommitGate(raw.verifier),
    agentic: {
      governance: buildGovernance(raw.governance),
      summaries: raw.summaries ?? [],
      limitations: raw.limitations ?? [],
      tokenUsage: raw.tokenUsage ?? null,
      error: raw.error ?? null,
    },
    restricted: raw.restricted === true,
  };
}

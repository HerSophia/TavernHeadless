import type {
  NodeGraphCheckpointPolicy,
  NodeGraphNodeScope,
  NodeGraphPhase,
  NodeGraphRetryPolicy,
} from './types.js';

const PRE_RESPONSE_PHASES: ReadonlySet<NodeGraphPhase> = new Set<NodeGraphPhase>([
  'floor_prepare',
  'pre_response',
]);

/** 该 phase 是否处于 response barrier 之前（可归属 FloorRun）。 */
export function isNodeGraphPreResponsePhase(phase: NodeGraphPhase): boolean {
  return PRE_RESPONSE_PHASES.has(phase);
}

export interface NodeGraphCheckpointEligibilityInput {
  phase: NodeGraphPhase;
  scope?: NodeGraphNodeScope;
  retryPolicy?: NodeGraphRetryPolicy;
  checkpointPolicy?: NodeGraphCheckpointPolicy;
}

/**
 * NG2-CORE：节点是否进入 floor 级持久 checkpoint（B9-DESIGN 3.3）。
 *
 * 纯 opt-in、纯节点配置驱动，保证确定性：
 * - 必须在 response barrier 之前（floor_prepare / pre_response）。
 * - `checkpointPolicy = rerun_on_regen` 或 `retryPolicy ∈ {always_rerun_per_page, never_reuse}` → 不复用。
 * - 显式 `scope ∈ {floor_stable, pre_response_deterministic}` → 资格通过。
 * - 显式 `scope ∈ {pre_response_stochastic, page_volatile}` → 不复用（含随机性）。
 * - scope 缺省时，只有 `retryPolicy ∈ {reuse_if_inputs_same, rerun_if_upstream_changed}` 才 opt-in。
 */
export function isNodeFloorCheckpointEligible(input: NodeGraphCheckpointEligibilityInput): boolean {
  if (!isNodeGraphPreResponsePhase(input.phase)) {
    return false;
  }
  if (input.checkpointPolicy === 'rerun_on_regen') {
    return false;
  }
  if (input.retryPolicy === 'always_rerun_per_page' || input.retryPolicy === 'never_reuse') {
    return false;
  }
  if (input.scope === 'floor_stable' || input.scope === 'pre_response_deterministic') {
    return true;
  }
  if (input.scope === 'pre_response_stochastic' || input.scope === 'page_volatile') {
    return false;
  }
  return input.retryPolicy === 'reuse_if_inputs_same' || input.retryPolicy === 'rerun_if_upstream_changed';
}

export type NodeGraphCheckpointReuseDecision = 'reuse' | 'miss';

export type NodeGraphCheckpointReuseReason =
  | 'input_hash_match'
  | 'not_eligible'
  | 'no_checkpoint'
  | 'input_hash_changed'
  | 'config_hash_changed'
  | 'manual_refresh';

export interface NodeGraphCheckpointReuseResult {
  decision: NodeGraphCheckpointReuseDecision;
  reason: NodeGraphCheckpointReuseReason;
}

export interface NodeGraphCheckpointReuseInput {
  eligible: boolean;
  checkpointPolicy?: NodeGraphCheckpointPolicy;
  /** 本次是否对该节点请求人工刷新（manual_refresh 策略下强制 miss）。 */
  manualRefresh?: boolean;
  /** 已存在的 floor checkpoint（同一 floor + graph version + node）。 */
  checkpoint?: { inputHash: string; configHash: string } | null;
  currentInputHash: string;
  currentConfigHash: string;
}

/**
 * NG2-CORE：判定一次 PageRun 是否可复用 floor checkpoint，并给出可解释 reason。
 *
 * reuse 命中要求 input_hash 与 config_hash 同时一致（graph version 由 checkpoint 主键收口）。
 */
export function classifyNodeGraphCheckpointReuse(
  input: NodeGraphCheckpointReuseInput,
): NodeGraphCheckpointReuseResult {
  if (!input.eligible) {
    return { decision: 'miss', reason: 'not_eligible' };
  }
  if (input.checkpointPolicy === 'manual_refresh' && input.manualRefresh) {
    return { decision: 'miss', reason: 'manual_refresh' };
  }
  if (!input.checkpoint) {
    return { decision: 'miss', reason: 'no_checkpoint' };
  }
  if (input.checkpoint.inputHash !== input.currentInputHash) {
    return { decision: 'miss', reason: 'input_hash_changed' };
  }
  if (input.checkpoint.configHash !== input.currentConfigHash) {
    return { decision: 'miss', reason: 'config_hash_changed' };
  }
  return { decision: 'reuse', reason: 'input_hash_match' };
}

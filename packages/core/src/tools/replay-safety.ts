import type {
  ExecutedToolCallRecord,
  ToolExecutionLifecycleState,
  ToolExecutionProviderType,
  ToolExecutionStatus,
  ToolProviderCompensationMode,
  ToolReplaySafety,
  ToolReplaySafetyEvaluation,
  ToolSideEffectLevel,
} from './types.js';

export interface ToolReplaySafetyInput {
  providerId?: string;
  providerType?: ToolExecutionProviderType;
  toolName?: string;
  sideEffectLevel?: ToolSideEffectLevel;
  status?: ToolExecutionStatus;
  lifecycleState?: ToolExecutionLifecycleState;
}

export function resolveToolProviderCompensationMode(input: {
  providerId?: string;
  providerType?: ToolExecutionProviderType;
  toolName?: string;
  sideEffectLevel?: ToolSideEffectLevel;
}): ToolProviderCompensationMode {
  if (
    input.sideEffectLevel === 'sandbox'
    && input.providerId === 'builtin'
    && input.toolName === 'set_variable'
  ) {
    return 'compensable';
  }

  return 'non_compensable';
}

export function evaluateToolReplaySafety(input: ToolReplaySafetyInput): ToolReplaySafetyEvaluation {
  const providerCompensationMode = resolveToolProviderCompensationMode(input);

  if (input.status === 'queued') {
    return {
      replaySafety: 'uncertain',
      providerCompensationMode,
      reason: 'deferred_execution_queued',
    };
  }

  if (input.lifecycleState === 'opened' || input.status === 'running') {
    return {
      replaySafety: 'uncertain',
      providerCompensationMode,
      reason: 'unfinished_execution',
    };
  }

  if (input.status === 'denied' || input.status === 'blocked') {
    return {
      replaySafety: 'safe',
      providerCompensationMode,
      reason: 'no_provider_side_effect',
    };
  }

  if (input.status === 'uncertain') {
    return {
      replaySafety: 'uncertain',
      providerCompensationMode,
      reason: 'uncertain_execution_outcome',
    };
  }

  switch (input.sideEffectLevel) {
    case 'none':
      return {
        replaySafety: 'safe',
        providerCompensationMode,
        reason: 'no_side_effect',
      };
    case 'sandbox':
      return {
        replaySafety: providerCompensationMode === 'compensable'
          ? 'safe'
          : 'confirm_on_replay',
        providerCompensationMode,
        reason: providerCompensationMode === 'compensable'
          ? 'compensable_sandbox'
          : 'non_compensable_sandbox',
      };
    case 'irreversible':
      return {
        replaySafety: 'never_auto_replay',
        providerCompensationMode,
        reason: 'irreversible_side_effect',
      };
    default:
      return {
        replaySafety: 'uncertain',
        providerCompensationMode,
        reason: 'missing_side_effect_level',
      };
  }
}

export function evaluateExecutedToolCallReplaySafety(
  record: Pick<ExecutedToolCallRecord, 'providerId' | 'providerType' | 'toolName' | 'sideEffectLevel' | 'status' | 'lifecycleState'>,
): ToolReplaySafetyEvaluation {
  return evaluateToolReplaySafety({
    providerId: record.providerId,
    providerType: record.providerType,
    toolName: record.toolName,
    sideEffectLevel: record.sideEffectLevel,
    status: record.status,
    lifecycleState: record.lifecycleState,
  });
}

export function isAutoReplaySafe(replaySafety: ToolReplaySafety): boolean {
  return replaySafety === 'safe';
}

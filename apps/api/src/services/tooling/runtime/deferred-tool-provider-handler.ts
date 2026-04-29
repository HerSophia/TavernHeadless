import type {
  RuntimeToolEnvelope,
  ToolCallResult,
  ToolDefinition,
} from "@tavern/core";

/**
 * Runtime catalog entry plus provider identity used by deferred runtime handlers.
 */
export interface RuntimeToolDescriptor<TProviderPayload = unknown> {
  providerId: RuntimeToolEnvelope["providerId"];
  providerType: RuntimeToolEnvelope["providerType"];
  tool: ToolDefinition;
  providerPayload?: TProviderPayload;
}

/**
 * Input used when a provider handler prepares a runtime tool for deferred dispatch.
 */
export interface DeferredToolExecutionInput<TProviderPayload = unknown> {
  descriptor: RuntimeToolDescriptor<TProviderPayload>;
}

/**
 * Result of provider-specific deferred preparation.
 */
export interface DeferredPreparationResult {
  tool: ToolDefinition;
}

/**
 * Final provider result for a deferred job execution.
 */
export type DeferredExecutionResult = ToolCallResult;

/**
 * Optional provider-specific recovery result.
 */
export interface DeferredRecoveryResult {
  handled: boolean;
  result?: ToolCallResult;
}

/**
 * Targets that can be matched by a deferred provider handler.
 */
export type DeferredHandlerTarget<TProviderPayload = unknown> =
  | RuntimeToolEnvelope<TProviderPayload>
  | RuntimeToolDescriptor<TProviderPayload>;

/**
 * Provider-generic deferred runtime contract.
 */
export interface DeferredToolProviderHandler<TProviderPayload = unknown> {
  readonly providerType?: RuntimeToolEnvelope["providerType"];
  canHandle(target: DeferredHandlerTarget<TProviderPayload>): boolean;
  prepareDeferredExecution(
    input: DeferredToolExecutionInput<TProviderPayload>,
  ): DeferredPreparationResult;
  executeDeferredJob(
    job: RuntimeToolEnvelope<TProviderPayload>,
  ): Promise<DeferredExecutionResult>;
  recoverDeferredJob?(
    job: RuntimeToolEnvelope<TProviderPayload>,
  ): DeferredRecoveryResult | Promise<DeferredRecoveryResult>;
}

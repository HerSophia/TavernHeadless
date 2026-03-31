import type { MutationApplyPhase, RuntimeMutationEnvelope } from "./runtime-mutation-types.js"

export class RuntimeMutationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "RuntimeMutationError"
  }
}

export class RuntimeMutationApplierNotFoundError extends RuntimeMutationError {
  constructor(public readonly kind: string) {
    super(`Runtime mutation applier not registered: ${kind}`)
    this.name = "RuntimeMutationApplierNotFoundError"
  }
}

export class RuntimeMutationInvalidPhaseError extends RuntimeMutationError {
  constructor(args: {
    mutationId: string
    kind: string
    actualPhase: MutationApplyPhase
    expectedPhases: readonly MutationApplyPhase[]
    operation: string
  }) {
    super(
      `Cannot ${args.operation} runtime mutation '${args.kind}' (${args.mutationId}) while phase is '${args.actualPhase}'. Expected: ${args.expectedPhases.join(", ")}`,
    )
    this.name = "RuntimeMutationInvalidPhaseError"
  }
}

export class RuntimeMutationAsyncBridgeUnavailableError extends RuntimeMutationError {
  constructor(public readonly kind: string) {
    super(`Runtime mutation async bridge is not configured for mutation kind '${kind}'`)
    this.name = "RuntimeMutationAsyncBridgeUnavailableError"
  }
}

export class RuntimeMutationBatchAlreadyAppliedError extends RuntimeMutationError {
  constructor() {
    super("Runtime mutation batch has already been applied")
    this.name = "RuntimeMutationBatchAlreadyAppliedError"
  }
}

export class RuntimeMutationBatchApplyError extends RuntimeMutationError {
  constructor(
    public readonly envelope: Pick<RuntimeMutationEnvelope, "id" | "kind">,
    options?: ErrorOptions,
  ) {
    super(
      `Failed to apply runtime mutation '${envelope.kind}' (${envelope.id}) inside batch`,
      options,
    )
    this.name = "RuntimeMutationBatchApplyError"
  }
}

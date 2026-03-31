import { RuntimeMutationApplierNotFoundError } from "./runtime-mutation-errors.js"
import type { RuntimeMutationApplier } from "./runtime-mutation-types.js"

export class MutationApplierRegistry {
  private readonly appliers = new Map<string, RuntimeMutationApplier<any, any>>()

  register<TPayload, TResult>(kind: string, applier: RuntimeMutationApplier<TPayload, TResult>): void {
    if (this.appliers.has(kind)) {
      throw new Error(`Runtime mutation applier already registered: ${kind}`)
    }

    this.appliers.set(kind, applier as RuntimeMutationApplier<any, any>)
  }

  find<TPayload, TResult>(kind: string): RuntimeMutationApplier<TPayload, TResult> | undefined {
    return this.appliers.get(kind) as RuntimeMutationApplier<TPayload, TResult> | undefined
  }

  get<TPayload, TResult>(kind: string): RuntimeMutationApplier<TPayload, TResult> {
    const applier = this.find<TPayload, TResult>(kind)
    if (!applier) {
      throw new RuntimeMutationApplierNotFoundError(kind)
    }

    return applier
  }

  listKinds(): string[] {
    return [...this.appliers.keys()]
  }
}

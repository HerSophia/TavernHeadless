import type { CoreEventBus } from "@tavern/core"

import type { AppDb } from "../db/client.js"
import { ConfigMutationApplier, registerConfigMutationAppliers } from "./config-mutation-applier.js"
import { MutationApplierRegistry } from "./mutation-applier-registry.js"
import { createMutationRuntime, type MutationRuntimeOptions } from "./mutation-runtime.js"
import { ResourceMutationApplier, registerResourceMutationAppliers } from "./resource-mutation-applier.js"
import type { MutationAsyncBridge } from "./runtime-mutation-types.js"
import { VariableMutationApplier, registerVariableMutationAppliers } from "./variable-mutation-applier.js"

export interface DefaultMutationRuntimeRegistryOptions {
  masterKey?: string
}

export interface DefaultMutationRuntimeOptions extends DefaultMutationRuntimeRegistryOptions {
  eventBus?: CoreEventBus
  now?: () => number
  asyncBridge?: MutationAsyncBridge
  registry?: MutationApplierRegistry
}

export interface DefaultMutationRuntimeComponents {
  registry: MutationApplierRegistry
  runtime: ReturnType<typeof createMutationRuntime>
}

export function createDefaultMutationApplierRegistry(
  options: DefaultMutationRuntimeRegistryOptions = {},
): MutationApplierRegistry {
  const registry = new MutationApplierRegistry()
  registerVariableMutationAppliers(registry, new VariableMutationApplier())
  registerConfigMutationAppliers(registry, new ConfigMutationApplier({
    masterKey: options.masterKey,
  }))
  registerResourceMutationAppliers(registry, new ResourceMutationApplier())
  return registry
}

export function createDefaultMutationRuntimeComponents(
  db: AppDb,
  options: DefaultMutationRuntimeOptions = {},
): DefaultMutationRuntimeComponents {
  const registry = options.registry ?? createDefaultMutationApplierRegistry({
    masterKey: options.masterKey,
  })

  return {
    registry,
    runtime: createMutationRuntime(db, {
      registry,
      eventBus: options.eventBus,
      now: options.now,
      asyncBridge: options.asyncBridge,
    } satisfies MutationRuntimeOptions),
  }
}

export function createDefaultMutationRuntime(
  db: AppDb,
  options: DefaultMutationRuntimeOptions = {},
) {
  return createDefaultMutationRuntimeComponents(db, options).runtime
}

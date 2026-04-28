import type {
  SessionStateNamespace,
  SessionStateSlotCapabilities,
  SessionStateSlotDefinition,
  SessionStateSlotPublicExposure,
} from "./session-state-types.js";
import { SESSION_STATE_NAMESPACE_GAME_STATE } from "./session-state-types.js";

export class SessionStateSlotRegistry {
  private readonly definitions = new Map<string, SessionStateSlotDefinition>();

  register(definition: SessionStateSlotDefinition): SessionStateSlotDefinition {
    const key = toRegistryKey(definition.namespace, definition.slot);
    this.definitions.set(key, { ...definition });
    return definition;
  }

  get(namespace: SessionStateNamespace, slot: string): SessionStateSlotDefinition | null {
    return this.definitions.get(toRegistryKey(namespace, slot)) ?? null;
  }

  require(namespace: SessionStateNamespace, slot: string): SessionStateSlotDefinition {
    const definition = this.get(namespace, slot);
    if (!definition) {
      throw new Error(`Session state slot '${namespace}/${slot}' is not registered`);
    }
    return definition;
  }

  list(namespace?: SessionStateNamespace): SessionStateSlotDefinition[] {
    const all = [...this.definitions.values()];
    return namespace ? all.filter((definition) => definition.namespace === namespace) : all;
  }

  listPublic(namespace?: SessionStateNamespace): SessionStateSlotDefinition[] {
    return this.list(namespace).filter((definition) => definition.publicExposure.exposureLifecycle === "public_stable");
  }
}

export function createDefaultSessionStateSlotRegistry(): SessionStateSlotRegistry {
  const registry = new SessionStateSlotRegistry();

  registry.register({
    namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
    slot: "world",
    visibilityMode: "fork_on_branch",
    defaultWriteMode: "commit_bound",
    defaultReplaySafety: "safe",
    schemaVersion: 1,
    sizeBudgetBytes: 512 * 1024,
    publicExposure: createBuiltInPublicExposure(),
  });

  registry.register({
    namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
    slot: "scene",
    visibilityMode: "fork_on_branch",
    defaultWriteMode: "commit_bound",
    defaultReplaySafety: "safe",
    schemaVersion: 1,
    sizeBudgetBytes: 256 * 1024,
    publicExposure: createBuiltInPublicExposure(),
  });

  registry.register({
    namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
    slot: "inventory",
    visibilityMode: "fork_on_branch",
    defaultWriteMode: "commit_bound",
    defaultReplaySafety: "safe",
    schemaVersion: 1,
    sizeBudgetBytes: 256 * 1024,
    publicExposure: createBuiltInInternalExposure(),
  });

  registry.register({
    namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
    slot: "combat",
    visibilityMode: "fork_on_branch",
    defaultWriteMode: "commit_bound",
    defaultReplaySafety: "safe",
    schemaVersion: 1,
    sizeBudgetBytes: 256 * 1024,
    publicExposure: createBuiltInInternalExposure(),
  });

  return registry;
}

function toRegistryKey(namespace: SessionStateNamespace, slot: string): string {
  return `${namespace}::${slot}`;
}

function createBuiltInPublicExposure(): SessionStateSlotPublicExposure {
  return {
    ownerKind: "built_in",
    exposureLifecycle: "public_stable",
    capabilities: createReadOnlyCapabilities(true),
  };
}

function createBuiltInInternalExposure(): SessionStateSlotPublicExposure {
  return {
    ownerKind: "built_in",
    exposureLifecycle: "internal_only",
    capabilities: createReadOnlyCapabilities(false),
  };
}

function createReadOnlyCapabilities(clientReadable: boolean): SessionStateSlotCapabilities {
  return {
    clientReadable,
    clientWritable: false,
    allowedWriteModes: [],
    supportsSnapshot: true,
    supportsDiff: true,
  };
}

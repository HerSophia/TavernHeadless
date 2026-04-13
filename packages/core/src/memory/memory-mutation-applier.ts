import {
  parseBranchMemoryScopeId,
  type MemoryScope,
} from '@tavern/shared';

import type { CoreEventMap } from '../events/index.js';
import type {
  MemoryEdge,
  MemoryItem,
  MemoryConsolidationOutput,
  MemoryCompactionOutput,
  MemoryIngestOutput,
  MemoryQuery,
} from './types.js';
import {
  MemoryScopeResolver,
  type MemoryScopeResolutionContext,
} from './memory-scope-resolver.js';

type MaybePromise<T> = T | Promise<T>;

type MemoryUpdatePatch = Partial<
  Pick<MemoryItem, 'content' | 'factKey' | 'importance' | 'confidence' | 'status' | 'lifecycleStatus'>
>;

type MemoryCreateInput = Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>;
type MemoryEdgeCreateInput = Omit<MemoryEdge, 'id' | 'createdAt'>;

type MemoryMutationEventName =
  | 'memory.created'
  | 'memory.updated'
  | 'memory.deprecated'
  | 'memory.consolidated';

export type MemoryMutationEvent = {
  [K in MemoryMutationEventName]: {
    name: K;
    payload: CoreEventMap[K];
  };
}[MemoryMutationEventName];

export interface MemoryMutationCounts {
  created: number;
  updated: number;
  deprecated: number;
}

export interface MemorySummaryMutationResult extends MemoryMutationCounts {
  items: MemoryItem[];
}

export interface MemoryMutationStore {
  findById(id: string): MaybePromise<MemoryItem | null>;
  findMany(query: MemoryQuery): MaybePromise<MemoryItem[]>;
  create(item: MemoryCreateInput): MaybePromise<MemoryItem>;
  update(id: string, patch: MemoryUpdatePatch): MaybePromise<MemoryItem | null>;
  deprecate(id: string): MaybePromise<MemoryItem | null>;
  createEdge(edge: MemoryEdgeCreateInput): MaybePromise<MemoryEdge>;
}

export interface SummaryIngestionArgs {
  summaries: string[];
  defaultScope: MemoryScope;
  defaultScopeId: string;
  context?: MemoryScopeResolutionContext;
  sourceFloorId?: string;
  sourceMessageId?: string;
  source: CoreEventMap['memory.created']['source'];
  importance?: number;
  confidence?: number;
  status?: MemoryItem['status'];
}

export interface ConsolidationApplyArgs {
  output: MemoryConsolidationOutput;
  defaultScope: MemoryScope;
  defaultScopeId: string;
  context?: MemoryScopeResolutionContext;
  sourceFloorId: string;
  sourceMessageId?: string;
}

export interface IngestApplyArgs {
  output: MemoryIngestOutput;
  defaultScope: MemoryScope;
  defaultScopeId: string;
  context?: MemoryScopeResolutionContext;
  sourceFloorId: string;
  sourceFloorNo?: number;
  sourceMessageId?: string;
  sourceJobId?: string;
}

export interface CompactionApplyArgs {
  output: MemoryCompactionOutput;
  sourceMicroIds: string[];
  defaultScope: MemoryScope;
  defaultScopeId: string;
  context?: MemoryScopeResolutionContext;
  sourceFloorId?: string;
  sourceJobId?: string;
}

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<T>).then === 'function';
}

function thenMaybe<T, R>(
  value: MaybePromise<T>,
  onFulfilled: (value: T) => MaybePromise<R>,
): MaybePromise<R> {
  return isPromiseLike(value) ? value.then(onFulfilled) : onFulfilled(value);
}

function forEachSerial<T>(
  items: readonly T[],
  iteratee: (item: T, index: number) => MaybePromise<void>,
): MaybePromise<void> {
  let chain: Promise<void> | undefined;

  items.forEach((item, index) => {
    if (chain) {
      chain = chain.then(() => iteratee(item, index)).then(() => undefined);
      return;
    }

    const result = iteratee(item, index);
    if (isPromiseLike(result)) {
      chain = result.then(() => undefined);
    }
  });

  return chain ?? undefined;
}

function normalizeFactKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveFactAddKey(
  fact: MemoryConsolidationOutput['factsAdd'][number],
): string | undefined {
  return normalizeFactKey(fact.factKey ?? fact.key);
}

function toFactContent(factKey: string | undefined, value: string): string {
  return factKey ? `${factKey}: ${value}` : value;
}

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function compareFactItemsForConflictResolution(
  a: MemoryItem,
  b: MemoryItem,
  preferredIds: Set<string>,
): number {
  const aPreferred = preferredIds.has(a.id);
  const bPreferred = preferredIds.has(b.id);
  if (aPreferred !== bPreferred) {
    return aPreferred ? -1 : 1;
  }

  if (a.updatedAt !== b.updatedAt) {
    return b.updatedAt - a.updatedAt;
  }

  if (a.importance !== b.importance) {
    return b.importance - a.importance;
  }

  if (a.createdAt !== b.createdAt) {
    return b.createdAt - a.createdAt;
  }

  return b.id.localeCompare(a.id);
}

type MemoryMutationEventContextPayload = Pick<
  CoreEventMap['memory.created'],
  'sessionId' | 'scope' | 'scopeId' | 'floorId' | 'sourceJobId'
>;

function resolveMemoryEventSessionId(
  scope: MemoryScope,
  scopeId: string,
  context: MemoryScopeResolutionContext | undefined,
): string | undefined {
  if (scope === 'chat') {
    return scopeId;
  }

  if (scope === 'branch') {
    return parseBranchMemoryScopeId(scopeId)?.sessionId
      ?? normalizeScopeValue(context?.sessionId)
      ?? undefined;
  }

  return normalizeScopeValue(context?.sessionId) ?? undefined;
}

function buildMemoryEventContextPayload(args: {
  scope: MemoryScope;
  scopeId: string;
  context?: MemoryScopeResolutionContext;
  floorId?: string;
  sourceJobId?: string;
}): MemoryMutationEventContextPayload {
  return {
    sessionId: resolveMemoryEventSessionId(args.scope, args.scopeId, args.context),
    scope: args.scope,
    scopeId: args.scopeId,
    ...(args.floorId ? { floorId: args.floorId } : {}),
    ...(args.sourceJobId ? { sourceJobId: args.sourceJobId } : {}),
  };
}

function buildResolutionContext(
  scope: MemoryScope,
  scopeId: string,
  context: MemoryScopeResolutionContext | undefined,
  sourceFloorId?: string,
): MemoryScopeResolutionContext {
  const branchScopeRef = scope === 'branch' ? parseBranchMemoryScopeId(scopeId) : null;
  return {
    accountId: context?.accountId,
    sessionId: context?.sessionId
      ?? (scope === 'chat' ? scopeId : branchScopeRef?.sessionId),
    branchId: context?.branchId ?? branchScopeRef?.branchId,
    floorId: context?.floorId ?? sourceFloorId ?? (scope === 'floor' ? scopeId : undefined),
  };
}

function normalizeScopeValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function scopeBucketKey(scope: MemoryScope, scopeId: string): string {
  return `${scope}\u001f${scopeId}`;
}

function resolveEffectiveCompactionSourceIds(
  requestedSourceIds: string[],
  outputSourceIds: string[],
): string[] {
  const requestedSet = new Set(requestedSourceIds);
  const normalizedOutput = outputSourceIds.filter((id) => requestedSet.has(id));
  if (normalizedOutput.length > 0) {
    return [...new Set(normalizedOutput)];
  }

  return [...new Set(requestedSourceIds)];
}

export class MemoryMutationApplier {
  constructor(
    private readonly store: MemoryMutationStore,
    private readonly scopeResolver = new MemoryScopeResolver(),
    private readonly onEvent?: (event: MemoryMutationEvent) => MaybePromise<void>,
  ) {}

  ingestSummaries(args: SummaryIngestionArgs): MaybePromise<MemorySummaryMutationResult> {
    const createdItems: MemoryItem[] = [];
    const resolutionContext = buildResolutionContext(
      args.defaultScope,
      args.defaultScopeId,
      args.context,
      args.sourceFloorId,
    );
    const resolvedScope = this.scopeResolver.resolveRef(
      args.defaultScope,
      resolutionContext,
      args.defaultScopeId,
    );

    const execution = forEachSerial(args.summaries, (summary) => {
      const trimmed = summary.trim();
      if (!trimmed) {
        return undefined;
      }

      return thenMaybe(
        this.store.create({
          scope: resolvedScope.scope,
          scopeId: resolvedScope.scopeId,
          type: 'summary',
          content: trimmed,
          importance: args.importance ?? 0.5,
          confidence: args.confidence ?? 1.0,
          tokenCountEstimate: estimateTokenCount(trimmed),
          sourceFloorId: args.sourceFloorId,
          sourceMessageId: args.sourceMessageId,
          status: args.status ?? 'active',
        }),
        (item) => {
          createdItems.push(item);
          const eventContext = buildMemoryEventContextPayload({
            scope: item.scope,
            scopeId: item.scopeId,
            context: args.context,
            floorId: args.sourceFloorId,
          });
          return this.emit('memory.created', {
            ...eventContext,
            item,
            source: args.source,
          });
        },
      );
    });

    return thenMaybe(execution, () => ({
      items: createdItems,
      created: createdItems.length,
      updated: 0,
      deprecated: 0,
    }));
  }

  applyConsolidation(args: ConsolidationApplyArgs): MaybePromise<MemoryMutationCounts> {
    let createdCount = 0;
    let updatedCount = 0;
    let deprecatedCount = 0;

    const resolutionContext = buildResolutionContext(
      args.defaultScope,
      args.defaultScopeId,
      args.context,
      args.sourceFloorId,
    );
    const defaultResolvedScope = this.scopeResolver.resolveRef(
      args.defaultScope,
      resolutionContext,
      args.defaultScopeId,
    );
    const touchedFactKeysByScope = new Map<string, {
      scope: MemoryScope;
      scopeId: string;
      keys: Set<string>;
    }>();
    const touchedFactItemIds = new Set<string>();

    const markTouchedFactKey = (scope: MemoryScope, scopeId: string, key: string | undefined) => {
      if (!key) {
        return;
      }

      const normalized = normalizeFactKey(key);
      if (!normalized) {
        return;
      }

      const bucketId = scopeBucketKey(scope, scopeId);
      const bucket = touchedFactKeysByScope.get(bucketId) ?? {
        scope,
        scopeId,
        keys: new Set<string>(),
      };
      bucket.keys.add(normalized);
      touchedFactKeysByScope.set(bucketId, bucket);
    };

    const createTurnSummary = () => {
      const summary = args.output.turnSummary?.trim();
      if (!summary) {
        return undefined;
      }

      return thenMaybe(
        this.store.create({
          scope: defaultResolvedScope.scope,
          scopeId: defaultResolvedScope.scopeId,
          type: 'summary',
          content: summary,
          importance: 0.6,
          tokenCountEstimate: estimateTokenCount(summary),
          confidence: 1.0,
          sourceFloorId: args.sourceFloorId,
          sourceMessageId: args.sourceMessageId,
          status: 'active',
        }),
        (item) => {
          createdCount += 1;
          const eventContext = buildMemoryEventContextPayload({
            scope: item.scope,
            scopeId: item.scopeId,
            context: args.context,
            floorId: args.sourceFloorId,
          });
          return this.emit('memory.created', {
            ...eventContext,
            item,
            source: 'consolidation',
          });
        },
      );
    };

    const createFacts = () => forEachSerial(args.output.factsAdd, (fact) => {
      const factScope = fact.scope ?? args.defaultScope;
      const resolvedScope = this.scopeResolver.resolveRef(
        factScope,
        resolutionContext,
        factScope === args.defaultScope ? args.defaultScopeId : undefined,
      );
      const factKey = resolveFactAddKey(fact);
      markTouchedFactKey(resolvedScope.scope, resolvedScope.scopeId, factKey);

      return thenMaybe(
        this.store.create({
          scope: resolvedScope.scope,
          scopeId: resolvedScope.scopeId,
          type: 'fact',
          content: toFactContent(factKey, fact.value),
          factKey,
          tokenCountEstimate: estimateTokenCount(toFactContent(factKey, fact.value)),
          importance: fact.importance ?? 0.5,
          confidence: 1.0,
          sourceFloorId: args.sourceFloorId,
          sourceMessageId: args.sourceMessageId,
          status: 'active',
        }),
        (item) => {
          touchedFactItemIds.add(item.id);
          createdCount += 1;
          const eventContext = buildMemoryEventContextPayload({
            scope: item.scope,
            scopeId: item.scopeId,
            context: args.context,
            floorId: args.sourceFloorId,
          });
          return this.emit('memory.created', {
            ...eventContext,
            item,
            source: 'consolidation',
          });
        },
      );
    });

    const updateFacts = () => forEachSerial(args.output.factsUpdate, (update) => thenMaybe(
      this.store.findById(update.id),
      (existing) => {
        if (!existing) {
          return undefined;
        }

        return thenMaybe(
          this.store.update(update.id, {
            content: update.value,
            importance: update.importance,
            ...(update.factKey !== undefined ? { factKey: update.factKey } : {}),
          }),
          (updated) => {
            if (!updated) {
              return undefined;
            }

            touchedFactItemIds.add(updated.id);
            markTouchedFactKey(
              updated.scope,
              updated.scopeId,
              updated.factKey ?? normalizeFactKey(update.factKey),
            );
            updatedCount += 1;
            const eventContext = buildMemoryEventContextPayload({
              scope: updated.scope,
              scopeId: updated.scopeId,
              context: args.context,
              floorId: args.sourceFloorId,
            });
            return this.emit('memory.updated', {
              ...eventContext,
              item: updated,
              previousContent: existing.content,
            });
          },
        );
      },
    ));

    const deprecateFacts = () => forEachSerial(args.output.factsDeprecate, (deprecatedFact) => thenMaybe(
      this.store.deprecate(deprecatedFact.id),
      (deprecated) => {
        if (!deprecated) {
          return undefined;
        }

        deprecatedCount += 1;
        const eventContext = buildMemoryEventContextPayload({
          scope: deprecated.scope,
          scopeId: deprecated.scopeId,
          context: args.context,
          floorId: args.sourceFloorId,
        });
        return this.emit('memory.deprecated', {
          ...eventContext,
          item: deprecated,
          reason: deprecatedFact.reason,
        });
      },
    ));

    const resolveConflicts = () => forEachSerial(
      [...touchedFactKeysByScope.values()],
      (bucket) => {
        if (bucket.keys.size === 0) {
          return undefined;
        }

        return thenMaybe(
          this.store.findMany({
            scope: bucket.scope,
            scopeId: bucket.scopeId,
            type: 'fact',
            status: 'active',
            limit: 1000,
            orderBy: 'updatedAt',
            orderDir: 'desc',
          }),
          (activeFacts) => {
            const groupedByKey = new Map<string, MemoryItem[]>();

            activeFacts.forEach((item) => {
              const key = item.factKey;
              if (!key || !bucket.keys.has(key)) {
                return;
              }

              const group = groupedByKey.get(key);
              if (group) {
                group.push(item);
              } else {
                groupedByKey.set(key, [item]);
              }
            });

            return forEachSerial([...groupedByKey.entries()], ([key, items]) => {
              if (items.length <= 1) {
                return undefined;
              }

              const sorted = [...items].sort((a, b) =>
                compareFactItemsForConflictResolution(a, b, touchedFactItemIds),
              );
              const winner = sorted[0]!;

              return forEachSerial(sorted.slice(1), (item) => thenMaybe(
                this.store.deprecate(item.id),
                (deprecated) => {
                  if (!deprecated) {
                    return undefined;
                  }

                  deprecatedCount += 1;
                  const eventContext = buildMemoryEventContextPayload({
                    scope: deprecated.scope,
                    scopeId: deprecated.scopeId,
                    context: args.context,
                    floorId: args.sourceFloorId,
                  });
                  return thenMaybe(
                    this.emit('memory.deprecated', {
                      ...eventContext,
                      item: deprecated,
                      reason: `conflict_resolution:${key}`,
                    }),
                    () => thenMaybe(
                      this.store.createEdge({
                        fromId: winner.id,
                        toId: deprecated.id,
                        relation: 'updates',
                      }),
                      () => undefined,
                    ),
                  );
                },
              ));
            });
          },
        );
      },
    );

    const execution = thenMaybe(createTurnSummary(), () => thenMaybe(createFacts(), () => thenMaybe(
      updateFacts(),
      () => thenMaybe(deprecateFacts(), () => resolveConflicts()),
    )));

    return thenMaybe(execution, () => thenMaybe(
      this.emit('memory.consolidated', {
        ...buildMemoryEventContextPayload({
          scope: defaultResolvedScope.scope,
          scopeId: defaultResolvedScope.scopeId,
          context: args.context,
          floorId: args.sourceFloorId,
        }),
        floorId: args.sourceFloorId,
        created: createdCount,
        updated: updatedCount,
        deprecated: deprecatedCount,
      }),
      () => ({
        created: createdCount,
        updated: updatedCount,
        deprecated: deprecatedCount,
      }),
    ));
  }

  applyIngestOutput(args: IngestApplyArgs): MaybePromise<MemoryMutationCounts> {
    let createdCount = 0;
    let updatedCount = 0;
    let deprecatedCount = 0;
    let microSummaryItem: MemoryItem | undefined;

    const resolutionContext = buildResolutionContext(
      args.defaultScope,
      args.defaultScopeId,
      args.context,
      args.sourceFloorId,
    );
    const defaultResolvedScope = this.scopeResolver.resolveRef(
      args.defaultScope,
      resolutionContext,
      args.defaultScopeId,
    );
    const touchedFactKeysByScope = new Map<string, {
      scope: MemoryScope;
      scopeId: string;
      keys: Set<string>;
    }>();
    const touchedFactItemIds = new Set<string>();

    const markTouchedFactKey = (scope: MemoryScope, scopeId: string, key: string | undefined) => {
      if (!key) {
        return;
      }

      const normalized = normalizeFactKey(key);
      if (!normalized) {
        return;
      }

      const bucketId = scopeBucketKey(scope, scopeId);
      const bucket = touchedFactKeysByScope.get(bucketId) ?? {
        scope,
        scopeId,
        keys: new Set<string>(),
      };
      bucket.keys.add(normalized);
      touchedFactKeysByScope.set(bucketId, bucket);
    };

    const createMicroSummary = () => {
      const summary = args.output.microSummary.trim();
      if (!summary) {
        return undefined;
      }

      return thenMaybe(
        this.store.create({
          scope: defaultResolvedScope.scope,
          scopeId: defaultResolvedScope.scopeId,
          type: 'summary',
          summaryTier: 'micro',
          content: summary,
          importance: 0.6,
          confidence: 1.0,
          sourceFloorId: args.sourceFloorId,
          sourceMessageId: args.sourceMessageId,
          status: 'active',
          lifecycleStatus: 'active',
          sourceJobId: args.sourceJobId,
          tokenCountEstimate: estimateTokenCount(summary),
          ...(args.sourceFloorNo !== undefined
            ? {
                coverageStartFloorNo: args.sourceFloorNo,
                coverageEndFloorNo: args.sourceFloorNo,
              }
            : {}),
        }),
        (item) => {
          microSummaryItem = item;
          createdCount += 1;
          const eventContext = buildMemoryEventContextPayload({
            scope: item.scope,
            scopeId: item.scopeId,
            context: args.context,
            floorId: args.sourceFloorId,
            sourceJobId: args.sourceJobId,
          });
          return this.emit('memory.created', {
            ...eventContext,
            item,
            source: 'consolidation',
          });
        },
      );
    };

    const createFacts = () => forEachSerial(args.output.factsAdd, (fact) => {
      const factScope = fact.scope ?? args.defaultScope;
      const resolvedScope = this.scopeResolver.resolveRef(
        factScope,
        resolutionContext,
        factScope === args.defaultScope ? args.defaultScopeId : undefined,
      );
      const factKey = resolveFactAddKey(fact);
      const content = toFactContent(factKey, fact.value);
      markTouchedFactKey(resolvedScope.scope, resolvedScope.scopeId, factKey);

      return thenMaybe(
        this.store.create({
          scope: resolvedScope.scope,
          scopeId: resolvedScope.scopeId,
          type: 'fact',
          content,
          factKey,
          importance: fact.importance ?? 0.5,
          confidence: 1.0,
          sourceFloorId: args.sourceFloorId,
          sourceMessageId: args.sourceMessageId,
          status: 'active',
          lifecycleStatus: 'active',
          sourceJobId: args.sourceJobId,
          tokenCountEstimate: estimateTokenCount(content),
        }),
        (item) => {
          touchedFactItemIds.add(item.id);
          createdCount += 1;
          const eventContext = buildMemoryEventContextPayload({
            scope: item.scope,
            scopeId: item.scopeId,
            context: args.context,
            floorId: args.sourceFloorId,
            sourceJobId: args.sourceJobId,
          });
          return this.emit('memory.created', {
            ...eventContext,
            item,
            source: 'consolidation',
          });
        },
      );
    });

    const updateFacts = () => forEachSerial(args.output.factsUpdate, (update) => thenMaybe(
      this.store.findById(update.id),
      (existing) => {
        if (!existing || existing.type !== 'fact' || existing.status !== 'active') {
          return undefined;
        }

        return thenMaybe(
          this.store.update(update.id, {
            content: update.value,
            importance: update.importance,
            ...(update.factKey !== undefined ? { factKey: update.factKey } : {}),
          }),
          (updated) => {
            if (!updated) {
              return undefined;
            }

            touchedFactItemIds.add(updated.id);
            markTouchedFactKey(
              updated.scope,
              updated.scopeId,
              updated.factKey ?? normalizeFactKey(update.factKey),
            );
            updatedCount += 1;
            const eventContext = buildMemoryEventContextPayload({
              scope: updated.scope,
              scopeId: updated.scopeId,
              context: args.context,
              floorId: args.sourceFloorId,
              sourceJobId: args.sourceJobId,
            });
            return this.emit('memory.updated', {
              ...eventContext,
              item: updated,
              previousContent: existing.content,
            });
          },
        );
      },
    ));

    const deprecateFacts = () => forEachSerial(args.output.factsDeprecate, (deprecatedFact) => thenMaybe(
      this.store.findById(deprecatedFact.id),
      (existing) => {
        if (!existing || existing.type !== 'fact' || existing.status !== 'active') {
          return undefined;
        }

        return thenMaybe(
          this.store.deprecate(deprecatedFact.id),
          (deprecated) => {
            if (!deprecated) {
              return undefined;
            }

            deprecatedCount += 1;
            const eventContext = buildMemoryEventContextPayload({
              scope: deprecated.scope,
              scopeId: deprecated.scopeId,
              context: args.context,
              floorId: args.sourceFloorId,
              sourceJobId: args.sourceJobId,
            });
            return this.emit('memory.deprecated', {
              ...eventContext,
              item: deprecated,
              reason: deprecatedFact.reason,
            });
          },
        );
      },
    ));

    const createOpenLoops = () => forEachSerial(args.output.openLoopsAdd, (openLoop) => {
      const resolvedScope = this.scopeResolver.resolveRef(
        openLoop.scope ?? args.defaultScope,
        resolutionContext,
        (openLoop.scope ?? args.defaultScope) === args.defaultScope ? args.defaultScopeId : undefined,
      );
      const content = openLoop.content.trim();
      if (!content) {
        return undefined;
      }

      return thenMaybe(
        this.store.create({
          scope: resolvedScope.scope,
          scopeId: resolvedScope.scopeId,
          type: 'open_loop',
          content,
          importance: openLoop.importance ?? 0.6,
          confidence: 1.0,
          sourceFloorId: args.sourceFloorId,
          sourceMessageId: args.sourceMessageId,
          status: 'active',
          lifecycleStatus: 'active',
          sourceJobId: args.sourceJobId,
          tokenCountEstimate: estimateTokenCount(content),
        }),
        (item) => {
          createdCount += 1;
          const eventContext = buildMemoryEventContextPayload({
            scope: item.scope,
            scopeId: item.scopeId,
            context: args.context,
            floorId: args.sourceFloorId,
            sourceJobId: args.sourceJobId,
          });
          return this.emit('memory.created', {
            ...eventContext,
            item,
            source: 'consolidation',
          });
        },
      );
    });

    const resolveOpenLoops = () => forEachSerial(args.output.openLoopsResolve, (resolvedLoop) => thenMaybe(
      this.store.findById(resolvedLoop.id),
      (existing) => {
        if (!existing || existing.type !== 'open_loop' || existing.status !== 'active') {
          return undefined;
        }

        const resolution = resolvedLoop.resolution.trim() || 'resolved';
        return thenMaybe(
          this.store.deprecate(resolvedLoop.id),
          (deprecated) => {
            if (!deprecated) {
              return undefined;
            }

            deprecatedCount += 1;
            const eventContext = buildMemoryEventContextPayload({
              scope: deprecated.scope,
              scopeId: deprecated.scopeId,
              context: args.context,
              floorId: args.sourceFloorId,
              sourceJobId: args.sourceJobId,
            });
            return thenMaybe(
              this.emit('memory.deprecated', {
                ...eventContext,
                item: deprecated,
                reason: `resolved:${resolution}`,
              }),
              () => {
                if (!microSummaryItem) {
                  return undefined;
                }

                return thenMaybe(
                  this.store.createEdge({
                    fromId: microSummaryItem.id,
                    toId: deprecated.id,
                    relation: 'resolves',
                  }),
                  () => undefined,
                );
              },
            );
          },
        );
      },
    ));

    const resolveConflicts = () => forEachSerial(
      [...touchedFactKeysByScope.values()],
      (bucket) => {
        if (bucket.keys.size === 0) {
          return undefined;
        }

        return thenMaybe(
          this.store.findMany({
            scope: bucket.scope,
            scopeId: bucket.scopeId,
            type: 'fact',
            status: 'active',
            limit: 1000,
            orderBy: 'updatedAt',
            orderDir: 'desc',
          }),
          (activeFacts) => {
            const groupedByKey = new Map<string, MemoryItem[]>();

            activeFacts.forEach((item) => {
              const key = item.factKey;
              if (!key || !bucket.keys.has(key)) {
                return;
              }

              const group = groupedByKey.get(key);
              if (group) {
                group.push(item);
              } else {
                groupedByKey.set(key, [item]);
              }
            });

            return forEachSerial([...groupedByKey.entries()], ([key, items]) => {
              if (items.length <= 1) {
                return undefined;
              }

              const sorted = [...items].sort((a, b) =>
                compareFactItemsForConflictResolution(a, b, touchedFactItemIds),
              );
              const winner = sorted[0]!;

              return forEachSerial(sorted.slice(1), (item) => thenMaybe(
                this.store.deprecate(item.id),
                (deprecated) => {
                  if (!deprecated) {
                    return undefined;
                  }

                  deprecatedCount += 1;
                  const eventContext = buildMemoryEventContextPayload({
                    scope: deprecated.scope,
                    scopeId: deprecated.scopeId,
                    context: args.context,
                    floorId: args.sourceFloorId,
                    sourceJobId: args.sourceJobId,
                  });
                  return thenMaybe(
                    this.emit('memory.deprecated', {
                      ...eventContext,
                      item: deprecated,
                      reason: `conflict_resolution:${key}`,
                    }),
                    () => thenMaybe(
                      this.store.createEdge({
                        fromId: winner.id,
                        toId: deprecated.id,
                        relation: 'updates',
                      }),
                      () => undefined,
                    ),
                  );
                },
              ));
            });
          },
        );
      },
    );

    const execution = thenMaybe(createMicroSummary(), () => thenMaybe(createFacts(), () => thenMaybe(
      updateFacts(),
      () => thenMaybe(deprecateFacts(), () => thenMaybe(
        createOpenLoops(),
        () => thenMaybe(resolveOpenLoops(), () => resolveConflicts()),
      )),
    )));

    return thenMaybe(execution, () => thenMaybe(
      this.emit('memory.consolidated', {
        ...buildMemoryEventContextPayload({
          scope: defaultResolvedScope.scope,
          scopeId: defaultResolvedScope.scopeId,
          context: args.context,
          floorId: args.sourceFloorId,
          sourceJobId: args.sourceJobId,
        }),
        floorId: args.sourceFloorId,
        created: createdCount,
        updated: updatedCount,
        deprecated: deprecatedCount,
        jobType: 'ingest_turn',
      }),
      () => ({
        created: createdCount,
        updated: updatedCount,
        deprecated: deprecatedCount,
      }),
    ));
  }

  applyCompactionOutput(args: CompactionApplyArgs): MaybePromise<MemoryMutationCounts> {
    let createdCount = 0;
    let updatedCount = 0;
    let deprecatedCount = 0;
    let macroSummaryItem: MemoryItem | undefined;
    const sourceMicroItems: MemoryItem[] = [];

    const resolutionContext = buildResolutionContext(
      args.defaultScope,
      args.defaultScopeId,
      args.context,
      args.sourceFloorId,
    );
    const defaultResolvedScope = this.scopeResolver.resolveRef(
      args.defaultScope,
      resolutionContext,
      args.defaultScopeId,
    );
    const touchedFactKeysByScope = new Map<string, {
      scope: MemoryScope;
      scopeId: string;
      keys: Set<string>;
    }>();
    const touchedFactItemIds = new Set<string>();

    const markTouchedFactKey = (scope: MemoryScope, scopeId: string, key: string | undefined) => {
      if (!key) {
        return;
      }

      const normalized = normalizeFactKey(key);
      if (!normalized) {
        return;
      }

      const bucketId = scopeBucketKey(scope, scopeId);
      const bucket = touchedFactKeysByScope.get(bucketId) ?? {
        scope,
        scopeId,
        keys: new Set<string>(),
      };
      bucket.keys.add(normalized);
      touchedFactKeysByScope.set(bucketId, bucket);
    };

    const loadSourceMicroItems = () => forEachSerial(
      resolveEffectiveCompactionSourceIds(args.sourceMicroIds, args.output.sourceMicroIds),
      (id) => thenMaybe(this.store.findById(id), (item) => {
        if (!item || item.type !== 'summary' || item.status !== 'active') {
          return undefined;
        }

        if ((item.lifecycleStatus ?? 'active') !== 'active') {
          return undefined;
        }

        if (item.summaryTier === 'macro') {
          return undefined;
        }

        sourceMicroItems.push(item);
        return undefined;
      }),
    );

    const createMacroSummary = () => {
      const summary = args.output.macroSummary.trim();
      if (!summary || sourceMicroItems.length === 0) {
        return undefined;
      }

      const coverageValues = sourceMicroItems
        .flatMap((item) => [item.coverageStartFloorNo, item.coverageEndFloorNo])
        .filter((value): value is number => typeof value === 'number');
      const newestSource = [...sourceMicroItems].sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) {
          return right.updatedAt - left.updatedAt;
        }
        return right.id.localeCompare(left.id);
      })[0];

      return thenMaybe(
        this.store.create({
          scope: defaultResolvedScope.scope,
          scopeId: defaultResolvedScope.scopeId,
          type: 'summary',
          summaryTier: 'macro',
          content: summary,
          importance: 0.65,
          confidence: 1.0,
          sourceFloorId: newestSource?.sourceFloorId ?? args.sourceFloorId,
          status: 'active',
          lifecycleStatus: 'active',
          sourceJobId: args.sourceJobId,
          tokenCountEstimate: estimateTokenCount(summary),
          ...(coverageValues.length > 0
            ? {
                coverageStartFloorNo: Math.min(...coverageValues),
                coverageEndFloorNo: Math.max(...coverageValues),
              }
            : {}),
          derivedFromCount: sourceMicroItems.length,
        }),
        (item) => {
          macroSummaryItem = item;
          createdCount += 1;
          const eventContext = buildMemoryEventContextPayload({
            scope: item.scope,
            scopeId: item.scopeId,
            context: args.context,
            floorId: args.sourceFloorId,
            sourceJobId: args.sourceJobId,
          });
          return this.emit('memory.created', {
            ...eventContext,
            item,
            source: 'consolidation',
          });
        },
      );
    };

    const compactSourceMicroSummaries = () => {
      if (!macroSummaryItem || sourceMicroItems.length === 0) {
        return undefined;
      }

      return forEachSerial(sourceMicroItems, (sourceItem) => thenMaybe(
        this.store.update(sourceItem.id, { lifecycleStatus: 'compacted' }),
        (updated) => {
          if (!updated) {
            return undefined;
          }

          updatedCount += 1;
          const eventContext = buildMemoryEventContextPayload({
            scope: updated.scope,
            scopeId: updated.scopeId,
            context: args.context,
            floorId: args.sourceFloorId,
            sourceJobId: args.sourceJobId,
          });
          return thenMaybe(
            this.emit('memory.updated', {
              ...eventContext,
              item: updated,
              previousContent: sourceItem.content,
            }),
            () => thenMaybe(
              this.store.createEdge({
                fromId: macroSummaryItem!.id,
                toId: updated.id,
                relation: 'compacts',
              }),
              () => thenMaybe(
                this.store.createEdge({
                  fromId: macroSummaryItem!.id,
                  toId: updated.id,
                  relation: 'derived_from',
                }),
                () => undefined,
              ),
            ),
          );
        },
      ));
    };

    const createFacts = () => forEachSerial(args.output.factsAdd, (fact) => {
      const factScope = fact.scope ?? args.defaultScope;
      const resolvedScope = this.scopeResolver.resolveRef(
        factScope,
        resolutionContext,
        factScope === args.defaultScope ? args.defaultScopeId : undefined,
      );
      const factKey = resolveFactAddKey(fact);
      const content = toFactContent(factKey, fact.value);
      markTouchedFactKey(resolvedScope.scope, resolvedScope.scopeId, factKey);

      return thenMaybe(
        this.store.create({
          scope: resolvedScope.scope,
          scopeId: resolvedScope.scopeId,
          type: 'fact',
          content,
          factKey,
          importance: fact.importance ?? 0.5,
          confidence: 1.0,
          sourceFloorId: args.sourceFloorId,
          status: 'active',
          lifecycleStatus: 'active',
          sourceJobId: args.sourceJobId,
          tokenCountEstimate: estimateTokenCount(content),
        }),
        (item) => {
          touchedFactItemIds.add(item.id);
          createdCount += 1;
          const eventContext = buildMemoryEventContextPayload({
            scope: item.scope,
            scopeId: item.scopeId,
            context: args.context,
            floorId: args.sourceFloorId,
            sourceJobId: args.sourceJobId,
          });
          return this.emit('memory.created', {
            ...eventContext,
            item,
            source: 'consolidation',
          });
        },
      );
    });

    const updateFacts = () => forEachSerial(args.output.factsUpdate, (update) => thenMaybe(
      this.store.findById(update.id),
      (existing) => {
        if (!existing || existing.type !== 'fact' || existing.status !== 'active') {
          return undefined;
        }

        return thenMaybe(
          this.store.update(update.id, {
            content: update.value,
            importance: update.importance,
            ...(update.factKey !== undefined ? { factKey: update.factKey } : {}),
          }),
          (updated) => {
            if (!updated) {
              return undefined;
            }

            touchedFactItemIds.add(updated.id);
            markTouchedFactKey(
              updated.scope,
              updated.scopeId,
              updated.factKey ?? normalizeFactKey(update.factKey),
            );
            updatedCount += 1;
            const eventContext = buildMemoryEventContextPayload({
              scope: updated.scope,
              scopeId: updated.scopeId,
              context: args.context,
              floorId: args.sourceFloorId,
              sourceJobId: args.sourceJobId,
            });
            return this.emit('memory.updated', {
              ...eventContext,
              item: updated,
              previousContent: existing.content,
            });
          },
        );
      },
    ));

    const deprecateFacts = () => forEachSerial(args.output.factsDeprecate, (deprecatedFact) => thenMaybe(
      this.store.findById(deprecatedFact.id),
      (existing) => {
        if (!existing || existing.type !== 'fact' || existing.status !== 'active') {
          return undefined;
        }

        return thenMaybe(
          this.store.deprecate(deprecatedFact.id),
          (deprecated) => {
            if (!deprecated) {
              return undefined;
            }

            deprecatedCount += 1;
            const eventContext = buildMemoryEventContextPayload({
              scope: deprecated.scope,
              scopeId: deprecated.scopeId,
              context: args.context,
              floorId: args.sourceFloorId,
              sourceJobId: args.sourceJobId,
            });
            return this.emit('memory.deprecated', {
              ...eventContext,
              item: deprecated,
              reason: deprecatedFact.reason,
            });
          },
        );
      },
    ));

    const createOpenLoops = () => forEachSerial(args.output.openLoopsAdd, (openLoop) => {
      const resolvedScope = this.scopeResolver.resolveRef(
        openLoop.scope ?? args.defaultScope,
        resolutionContext,
        (openLoop.scope ?? args.defaultScope) === args.defaultScope ? args.defaultScopeId : undefined,
      );
      const content = openLoop.content.trim();
      if (!content) {
        return undefined;
      }

      return thenMaybe(
        this.store.create({
          scope: resolvedScope.scope,
          scopeId: resolvedScope.scopeId,
          type: 'open_loop',
          content,
          importance: openLoop.importance ?? 0.6,
          confidence: 1.0,
          sourceFloorId: args.sourceFloorId,
          status: 'active',
          lifecycleStatus: 'active',
          sourceJobId: args.sourceJobId,
          tokenCountEstimate: estimateTokenCount(content),
        }),
        (item) => {
          createdCount += 1;
          const eventContext = buildMemoryEventContextPayload({
            scope: item.scope,
            scopeId: item.scopeId,
            context: args.context,
            floorId: args.sourceFloorId,
            sourceJobId: args.sourceJobId,
          });
          return this.emit('memory.created', {
            ...eventContext,
            item,
            source: 'consolidation',
          });
        },
      );
    });

    const resolveOpenLoops = () => forEachSerial(args.output.openLoopsResolve, (resolvedLoop) => thenMaybe(
      this.store.findById(resolvedLoop.id),
      (existing) => {
        if (!existing || existing.type !== 'open_loop' || existing.status !== 'active') {
          return undefined;
        }

        const resolution = resolvedLoop.resolution.trim() || 'resolved';
        return thenMaybe(
          this.store.deprecate(resolvedLoop.id),
          (deprecated) => {
            if (!deprecated) {
              return undefined;
            }

            deprecatedCount += 1;
            const eventContext = buildMemoryEventContextPayload({
              scope: deprecated.scope,
              scopeId: deprecated.scopeId,
              context: args.context,
              floorId: args.sourceFloorId,
              sourceJobId: args.sourceJobId,
            });
            return thenMaybe(
              this.emit('memory.deprecated', {
                ...eventContext,
                item: deprecated,
                reason: `resolved:${resolution}`,
              }),
              () => {
                if (!macroSummaryItem) {
                  return undefined;
                }

                return thenMaybe(
                  this.store.createEdge({
                    fromId: macroSummaryItem.id,
                    toId: deprecated.id,
                    relation: 'resolves',
                  }),
                  () => undefined,
                );
              },
            );
          },
        );
      },
    ));

    const resolveConflicts = () => forEachSerial(
      [...touchedFactKeysByScope.values()],
      (bucket) => {
        if (bucket.keys.size === 0) {
          return undefined;
        }

        return thenMaybe(
          this.store.findMany({
            scope: bucket.scope,
            scopeId: bucket.scopeId,
            type: 'fact',
            status: 'active',
            limit: 1000,
            orderBy: 'updatedAt',
            orderDir: 'desc',
          }),
          (activeFacts) => {
            const groupedByKey = new Map<string, MemoryItem[]>();

            activeFacts.forEach((item) => {
              const key = item.factKey;
              if (!key || !bucket.keys.has(key)) {
                return;
              }

              const group = groupedByKey.get(key);
              if (group) {
                group.push(item);
              } else {
                groupedByKey.set(key, [item]);
              }
            });

            return forEachSerial([...groupedByKey.entries()], ([key, items]) => {
              if (items.length <= 1) {
                return undefined;
              }

              const sorted = [...items].sort((a, b) =>
                compareFactItemsForConflictResolution(a, b, touchedFactItemIds),
              );
              const winner = sorted[0]!;

              return forEachSerial(sorted.slice(1), (item) => thenMaybe(
                this.store.deprecate(item.id),
                (deprecated) => {
                  if (!deprecated) {
                    return undefined;
                  }

                  deprecatedCount += 1;
                  const eventContext = buildMemoryEventContextPayload({
                    scope: deprecated.scope,
                    scopeId: deprecated.scopeId,
                    context: args.context,
                    floorId: args.sourceFloorId,
                    sourceJobId: args.sourceJobId,
                  });
                  return thenMaybe(
                    this.emit('memory.deprecated', {
                      ...eventContext,
                      item: deprecated,
                      reason: `conflict_resolution:${key}`,
                    }),
                    () => thenMaybe(
                      this.store.createEdge({
                        fromId: winner.id,
                        toId: deprecated.id,
                        relation: 'updates',
                      }),
                      () => undefined,
                    ),
                  );
                },
              ));
            });
          },
        );
      },
    );

    const execution = thenMaybe(loadSourceMicroItems(), () => thenMaybe(createMacroSummary(), () => thenMaybe(
      compactSourceMicroSummaries(),
      () => thenMaybe(createFacts(), () => thenMaybe(
        updateFacts(),
        () => thenMaybe(deprecateFacts(), () => thenMaybe(
          createOpenLoops(),
          () => thenMaybe(resolveOpenLoops(), () => resolveConflicts()),
        )),
      )),
    )));

    return thenMaybe(execution, () => thenMaybe(
      this.emit('memory.consolidated', {
        ...buildMemoryEventContextPayload({
          scope: defaultResolvedScope.scope,
          scopeId: defaultResolvedScope.scopeId,
          context: args.context,
          floorId: args.sourceFloorId,
          sourceJobId: args.sourceJobId,
        }),
        floorId: args.sourceFloorId,
        created: createdCount,
        updated: updatedCount,
        deprecated: deprecatedCount,
        jobType: 'compact_macro',
      }),
      () => ({
        created: createdCount,
        updated: updatedCount,
        deprecated: deprecatedCount,
      }),
    ));
  }


  private emit<K extends MemoryMutationEventName>(
    name: K,
    payload: CoreEventMap[K],
  ): MaybePromise<void> {
    if (!this.onEvent) {
      return undefined;
    }

    return this.onEvent({
      name,
      payload,
    } as MemoryMutationEvent);
  }
}

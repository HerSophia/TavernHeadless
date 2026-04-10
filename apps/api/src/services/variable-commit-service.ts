import { nanoid } from "nanoid";
import type { BufferedToolVariableMutation, CoreEventBus } from "@tavern/core";

import type { AppDb } from "../db/client.js";
import type { MutationBatch } from "./runtime-mutation-types.js";
import { createDefaultMutationRuntime } from "./default-mutation-runtime.js";
import type { MutationRuntime } from "./runtime-mutation-types.js";
import {
  VARIABLE_MUTATION_KINDS,
  type VariableCommitInput,
  type VariableCommitResult,
  type VariableDeleteMutationPayload,
  type VariablePromotionPolicy,
  type VariableSetMutationItem,
} from "./variable-mutation-applier.js";

interface VariableCommitServiceOptions {
  db?: AppDb;
  mutationRuntime?: MutationRuntime;
  eventBus?: CoreEventBus;
  accountMode?: "single" | "multi";
  defaultAccountId?: string;
}

interface StageBufferedMutationsInput {
  mutations: BufferedToolVariableMutation[];
  committedAt: number;
  accountId: string;
}

interface StageDeleteMutationInput {
  runId: string;
  generationAttemptNo: number;
  scope: "branch" | "global";
  scopeId: string;
  key: string;
  committedAt: number;
  accountId: string;
  sessionId: string;
  branchId: string;
}

interface StagePromotionInput extends VariableCommitInput {
  accountId: string;
}

function normalizePromotionPolicy(policy?: VariablePromotionPolicy): "replace" | "if_absent" {
  return policy === "ifAbsent" ? "if_absent" : "replace";
}

export type { VariablePromotionPolicy };

export class VariableCommitService {
  private readonly mutationRuntime?: MutationRuntime;

  constructor(options: VariableCommitServiceOptions = {}) {
    this.mutationRuntime = options.mutationRuntime
      ?? (options.db
        ? createDefaultMutationRuntime(options.db, {
          eventBus: options.eventBus,
        })
        : undefined);
  }

  beginBatch(): MutationBatch {
    if (!this.mutationRuntime) {
      throw new Error("VariableCommitService requires a mutation runtime to begin a batch");
    }
    return this.mutationRuntime.beginBatch();
  }

  stageBufferedMutations(batch: MutationBatch, input: StageBufferedMutationsInput): void {
    if (input.mutations.length === 0) {
      return;
    }

    const items: VariableSetMutationItem[] = input.mutations.map((mutation, index) => ({
      index,
      id: nanoid(),
      accountId: input.accountId,
      scope: mutation.scope,
      scopeId: mutation.scopeId,
      key: mutation.key,
      valueJson: JSON.stringify(mutation.value),
      updatedAt: input.committedAt,
    }));

    batch.stage({
      id: `variable-set:${input.accountId}:${input.committedAt}:${items.length}`,
      kind: VARIABLE_MUTATION_KINDS.set,
      source: "system",
      accountId: input.accountId,
      scopeType: "variable",
      scopeKey: input.accountId,
      applyPhase: "commit",
      durability: "transactional",
      replaySafety: "safe",
      payload: {
        items,
        emitEvents: false,
      },
      createdAt: input.committedAt,
    });
  }

  stageDeleteMutation(batch: MutationBatch, input: StageDeleteMutationInput): void {
    const payload: VariableDeleteMutationPayload = {
      id: `${input.runId}:${input.generationAttemptNo}:${input.scope}:${input.key}:delete`,
      accountId: input.accountId,
      scope: input.scope,
      scopeId: input.scopeId,
      key: input.key,
      sessionId: input.sessionId,
      branchId: input.branchId,
      emitEvent: false,
    };

    batch.stage({
      id: payload.id,
      kind: VARIABLE_MUTATION_KINDS.delete,
      source: "system",
      accountId: input.accountId,
      sessionId: input.sessionId,
      floorId: undefined,
      pageId: undefined,
      scopeType: "variable",
      scopeKey: `${input.scope}:${input.scopeId}`,
      applyPhase: "commit",
      durability: "transactional",
      replaySafety: "safe",
      payload,
      createdAt: input.committedAt,
    });
  }

  stagePromotion(batch: MutationBatch, input: StagePromotionInput): void {
    batch.stage({
      id: `variable-promote:${input.floorId}:${input.pageId ?? "none"}`,
      kind: VARIABLE_MUTATION_KINDS.promotePageToFloor,
      source: "system",
      accountId: input.accountId,
      sessionId: input.sessionId,
      floorId: input.floorId,
      pageId: input.pageId,
      scopeType: "variable",
      scopeKey: `floor:${input.floorId}`,
      applyPhase: "commit",
      durability: "transactional",
      replaySafety: "safe",
      conflictPolicy: normalizePromotionPolicy(input.policy),
      payload: input,
      createdAt: input.committedAt ?? Date.now(),
    });
  }

  promoteAll(input: VariableCommitInput, tx: Parameters<MutationBatch["applyInTransaction"]>[0]): VariableCommitResult {
    if (!this.mutationRuntime) {
      throw new Error("VariableCommitService requires a mutation runtime to promote variables");
    }

    const batch = this.mutationRuntime.beginBatch();
    this.stagePromotion(batch, {
      ...input,
      accountId: input.accountId ?? "default-admin",
    });

    const applied = batch.applyInTransaction(tx, {
      actor: { type: "system", id: "variable-commit-service" },
      requestId: `variable-commit:${input.floorId}`,
    });

    const result = applied.mutations.find((mutation) => mutation.envelope.kind === VARIABLE_MUTATION_KINDS.promotePageToFloor)?.result;
    if (!result) {
      return {
        pageId: input.pageId,
        floorId: input.floorId,
        sessionId: input.sessionId,
        fromScope: "page",
        toScope: "floor",
        policy: input.policy ?? "replace",
        scannedCount: 0,
        promotedCount: 0,
        skippedCount: 0,
        promotedVariables: [],
      };
    }

    return result as VariableCommitResult;
  }
}

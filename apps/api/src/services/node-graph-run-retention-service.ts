import { and, eq, inArray, isNull, lte } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { nodeGraphNodeRuns, nodeGraphRuns } from "../db/schema.js";

/** Terminal run statuses eligible for body cleanup. `running` is never cleaned. */
export const NODE_GRAPH_RUN_TERMINAL_STATUSES = ["succeeded", "failed", "cancelled"] as const;

export type NodeGraphRunTerminalStatus = (typeof NODE_GRAPH_RUN_TERMINAL_STATUSES)[number];

const DEFAULT_CLEANUP_LIMIT = 200;
const DEFAULT_CLEANUP_SCAN_LIMIT = 1_000;

export interface NodeGraphRunRetentionRunInput {
  now?: number;
  /**
   * Grace window (ms) kept after a terminal run is recorded before its node-run
   * bodies (`previewJson` / `diagnosticsJson`) are redacted.
   */
  retentionGraceMs?: number;
  /** Max terminal runs cleaned per pass. */
  cleanupLimit?: number;
}

export interface NodeGraphRunRetentionRunResult {
  now: number;
  cleaned: number;
  redactedNodeRuns: number;
  cleanedByStatus: Record<NodeGraphRunTerminalStatus, number>;
}

/**
 * Batch 8 (R6-3, gap 5) NodeGraph run retention maintenance.
 *
 * This service is db-only: cleanup never needs the chat or graph runtime, so it
 * can run inside the generic RuntimeMaintenanceService without dragging in the
 * executor. It redacts the large node-run bodies (`previewJson`,
 * `diagnosticsJson`, which may carry final prompt messages or agent briefs)
 * of terminal runs once the retention grace window has elapsed, while keeping
 * the run row, node-run row structure, status, phase, timings and input/output
 * hashes for long-term audit. A redacted run is marked with `cleanedAt` and is
 * never cleaned again.
 *
 * Results only carry summary counts, never run/node bodies.
 */
export class NodeGraphRunRetentionService {
  constructor(private readonly db: AppDb) {}

  run(input: NodeGraphRunRetentionRunInput = {}): NodeGraphRunRetentionRunResult {
    const now = input.now ?? Date.now();
    const retentionGraceMs = Math.max(0, input.retentionGraceMs ?? 0);
    const cleanup = this.cleanupEligible(now, retentionGraceMs, input.cleanupLimit ?? DEFAULT_CLEANUP_LIMIT);
    return {
      now,
      cleaned: cleanup.cleaned,
      redactedNodeRuns: cleanup.redactedNodeRuns,
      cleanedByStatus: cleanup.cleanedByStatus,
    };
  }

  /**
   * Redacts node-run bodies of terminal NodeGraph runs once the retention grace
   * window has elapsed. Run rows, node-run rows, statuses and hashes stay.
   */
  cleanupEligible(
    now = Date.now(),
    retentionGraceMs = 0,
    limit = DEFAULT_CLEANUP_LIMIT,
  ): {
    cleaned: number;
    redactedNodeRuns: number;
    cleanedByStatus: Record<NodeGraphRunTerminalStatus, number>;
  } {
    const cleanedByStatus = emptyStatusCounter();
    let cleaned = 0;
    let redactedNodeRuns = 0;

    const candidates = this.db
      .select({
        id: nodeGraphRuns.id,
        status: nodeGraphRuns.status,
        createdAt: nodeGraphRuns.createdAt,
        updatedAt: nodeGraphRuns.updatedAt,
      })
      .from(nodeGraphRuns)
      .where(and(
        isNull(nodeGraphRuns.cleanedAt),
        inArray(nodeGraphRuns.status, [...NODE_GRAPH_RUN_TERMINAL_STATUSES]),
        lte(nodeGraphRuns.createdAt, now - retentionGraceMs),
      ))
      .limit(DEFAULT_CLEANUP_SCAN_LIMIT)
      .all();

    for (const candidate of candidates) {
      if (cleaned >= Math.max(1, limit)) {
        break;
      }
      const status = candidate.status as NodeGraphRunTerminalStatus;
      if (!NODE_GRAPH_RUN_TERMINAL_STATUSES.includes(status)) {
        continue;
      }
      redactedNodeRuns += this.redactRunBodies(candidate.id, now);
      cleaned += 1;
      cleanedByStatus[status] += 1;
    }

    return { cleaned, redactedNodeRuns, cleanedByStatus };
  }

  private redactRunBodies(graphRunId: string, now: number): number {
    const redacted = this.db
      .update(nodeGraphNodeRuns)
      .set({ previewJson: null, diagnosticsJson: null })
      .where(eq(nodeGraphNodeRuns.graphRunId, graphRunId))
      .returning({ id: nodeGraphNodeRuns.id })
      .all();

    this.db
      .update(nodeGraphRuns)
      .set({ cleanedAt: now, updatedAt: now })
      .where(eq(nodeGraphRuns.id, graphRunId))
      .run();

    return redacted.length;
  }
}

function emptyStatusCounter(): Record<NodeGraphRunTerminalStatus, number> {
  const counter = {} as Record<NodeGraphRunTerminalStatus, number>;
  for (const status of NODE_GRAPH_RUN_TERMINAL_STATUSES) {
    counter[status] = 0;
  }
  return counter;
}

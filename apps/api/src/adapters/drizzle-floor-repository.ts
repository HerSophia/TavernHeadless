import { eq } from "drizzle-orm";
import type { FloorState } from "@tavern/shared";
import type { FloorEntity, FloorRepository } from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { floors } from "../db/schema.js";

// ── 内部映射 ──────────────────────────────────────────

type FloorRow = typeof floors.$inferSelect;

function toEntity(row: FloorRow): FloorEntity {
  return {
    id: row.id,
    sessionId: row.sessionId,
    floorNo: row.floorNo,
    branchId: row.branchId,
    parentFloorId: row.parentFloorId,
    state: row.state as FloorState,
    tokenIn: row.tokenIn,
    tokenOut: row.tokenOut,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Adapter ───────────────────────────────────────────

export class DrizzleFloorRepository implements FloorRepository {
  constructor(private readonly db: AppDb) {}

  async findById(id: string): Promise<FloorEntity | null> {
    const [row] = await this.db
      .select()
      .from(floors)
      .where(eq(floors.id, id));

    return row ? toEntity(row) : null;
  }

  async updateState(
    id: string,
    state: FloorState,
    updatedAt: number,
  ): Promise<FloorEntity | null> {
    const [row] = await this.db
      .update(floors)
      .set({ state, updatedAt })
      .where(eq(floors.id, id))
      .returning();

    return row ? toEntity(row) : null;
  }
}

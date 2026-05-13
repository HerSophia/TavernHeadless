import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase, type AppDb } from "../../db/client.js";
import { accounts, workspaces } from "../../db/schema.js";
import { ensureDefaultAdminAccount } from "../service.js";
import { DEFAULT_ADMIN_ACCOUNT_ID, DEFAULT_ADMIN_ACCOUNT_NAME } from "../constants.js";

describe("ensureDefaultAdminAccount", () => {
  let db: AppDb;
  let closeDb: () => void;

  beforeEach(() => {
    const conn = createDatabase(":memory:");
    db = conn.db;
    closeDb = conn.close;

    // 迁移脚本 0007 已自动插入 default-admin 行。
    // 删掉它以确保测试从干净状态开始。
    // Workspace / Project Phase 1 启动修复会为账号补默认 Workspace，
    // 因此要先删从属 Workspace，再删账号。
    db.delete(workspaces)
      .where(eq(workspaces.accountId, DEFAULT_ADMIN_ACCOUNT_ID))
      .run();
    db.delete(accounts)
      .where(eq(accounts.id, DEFAULT_ADMIN_ACCOUNT_ID))
      .run();
  });

  afterEach(() => {
    closeDb();
  });

  it("inserts default admin account on first call", async () => {
    await ensureDefaultAdminAccount(db, () => 1000);

    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, DEFAULT_ADMIN_ACCOUNT_ID))
      .limit(1);

    expect(row).toBeDefined();
    expect(row!.name).toBe(DEFAULT_ADMIN_ACCOUNT_NAME);
    expect(row!.role).toBe("admin");
    expect(row!.status).toBe("active");
    expect(row!.isDefault).toBe(true);
    expect(row!.createdAt).toBe(1000);

    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.accountId, DEFAULT_ADMIN_ACCOUNT_ID))
      .limit(1);

    expect(workspace).toBeDefined();
    expect(workspace!.id).toBe("ws_default_default-admin");
    expect(workspace!.isDefault).toBe(true);
    expect(workspace!.createdAt).toBe(1000);
  });

  it("is idempotent — second call does not duplicate", async () => {
    await ensureDefaultAdminAccount(db);
    await ensureDefaultAdminAccount(db);

    const rows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, DEFAULT_ADMIN_ACCOUNT_ID));

    const workspaceRows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.accountId, DEFAULT_ADMIN_ACCOUNT_ID));

    expect(rows).toHaveLength(1);
    expect(workspaceRows).toHaveLength(1);
  });

  it("uses Date.now as default timestamp factory", async () => {
    const before = Date.now();
    await ensureDefaultAdminAccount(db);
    const after = Date.now();

    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, DEFAULT_ADMIN_ACCOUNT_ID))
      .limit(1);

    expect(row!.createdAt).toBeGreaterThanOrEqual(before);
    expect(row!.createdAt).toBeLessThanOrEqual(after);
  });
});

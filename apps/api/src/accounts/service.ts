import { eq } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { WorkspaceScopeService } from "../services/workspace-scope-service.js";
import { DEFAULT_ADMIN_ACCOUNT_ID, DEFAULT_ADMIN_ACCOUNT_NAME } from "./constants.js";

export type AccountAuthState = {
  id: string;
  role: "admin" | "user";
  status: "active" | "disabled";
};

export async function ensureDefaultAdminAccount(db: AppDb, now: () => number = Date.now): Promise<void> {
  db.transaction((tx) => {
    const existing = tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, DEFAULT_ADMIN_ACCOUNT_ID))
      .limit(1)
      .all()[0];

    if (existing) {
      new WorkspaceScopeService(tx).ensureDefaultWorkspace(DEFAULT_ADMIN_ACCOUNT_ID, now());
      return;
    }

    const timestamp = now();
    tx.insert(accounts).values({
      id: DEFAULT_ADMIN_ACCOUNT_ID,
      name: DEFAULT_ADMIN_ACCOUNT_NAME,
      role: "admin",
      status: "active",
      isDefault: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run();

    new WorkspaceScopeService(tx).ensureDefaultWorkspace(DEFAULT_ADMIN_ACCOUNT_ID, timestamp);
  });
}

export async function getAccountAuthState(db: AppDb, accountId: string): Promise<AccountAuthState | null> {
  const [account] = await db
    .select({
      id: accounts.id,
      role: accounts.role,
      status: accounts.status,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  return account ?? null;
}

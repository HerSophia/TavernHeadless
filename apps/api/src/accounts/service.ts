import { eq } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { DEFAULT_ADMIN_ACCOUNT_ID, DEFAULT_ADMIN_ACCOUNT_NAME } from "./constants.js";

export async function ensureDefaultAdminAccount(db: AppDb, now: () => number = Date.now): Promise<void> {
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, DEFAULT_ADMIN_ACCOUNT_ID))
    .limit(1);

  if (existing) {
    return;
  }

  const timestamp = now();
  await db.insert(accounts).values({
    id: DEFAULT_ADMIN_ACCOUNT_ID,
    name: DEFAULT_ADMIN_ACCOUNT_NAME,
    role: "admin",
    status: "active",
    isDefault: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

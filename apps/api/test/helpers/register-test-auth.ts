import type { FastifyInstance } from "fastify";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../src/accounts/constants.js";
import { registerAuth } from "../../src/plugins/auth.js";

export async function registerDevelopmentTestAuth(
  app: FastifyInstance,
  db: unknown = {},
): Promise<void> {
  await registerAuth(app, { mode: "off" }, {
    db: db as never,
    accountMode: "single",
    defaultAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
  });
}

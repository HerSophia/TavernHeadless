import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";
import { ensureDefaultAdminAccount } from "../src/accounts/service.js";
import { createDatabase } from "../src/db/client.js";
import { characters, worldbooks } from "../src/db/schema.js";
import {
  BUILTIN_CHARACTER_ASSET_MANAGER_ID,
  BUILTIN_CHARACTER_ASSISTANT_ID,
  BUILTIN_WORLDBOOK_ID,
  ensureBuiltinAssets,
} from "../src/services/builtin-assets-seed.js";

type CharacterListItem = { id: string; name: string; source: string };
type WorldbookListItem = { id: string; name: string; source: string };
type ErrorResponse = { error: { code: string; message: string } };

describe("Builtin assets seed (SC2-11)", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("does not seed builtin assets by default (clean fixtures)", async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));

    const charsRes = await app.inject({ method: "GET", url: "/characters" });
    expect(charsRes.statusCode).toBe(200);
    expect(charsRes.json<{ data: CharacterListItem[] }>().data).toHaveLength(0);

    const wbRes = await app.inject({ method: "GET", url: "/worldbooks" });
    expect(wbRes.statusCode).toBe(200);
    expect(wbRes.json<{ data: WorldbookListItem[] }>().data).toHaveLength(0);
  });

  it("seeds two builtin characters and one builtin worldbook when enabled", async () => {
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      seedBuiltinAssets: true,
    }));

    const charsRes = await app.inject({ method: "GET", url: "/characters" });
    expect(charsRes.statusCode).toBe(200);
    const chars = charsRes.json<{ data: CharacterListItem[] }>().data;
    const builtinChars = chars.filter((c) => c.source === "builtin");
    expect(builtinChars).toHaveLength(2);
    const builtinCharIds = builtinChars.map((c) => c.id).sort();
    expect(builtinCharIds).toEqual(
      [BUILTIN_CHARACTER_ASSET_MANAGER_ID, BUILTIN_CHARACTER_ASSISTANT_ID].sort(),
    );

    const wbRes = await app.inject({ method: "GET", url: "/worldbooks" });
    expect(wbRes.statusCode).toBe(200);
    const worldbookRows = wbRes.json<{ data: WorldbookListItem[] }>().data;
    const builtinWorldbooks = worldbookRows.filter((w) => w.source === "builtin");
    expect(builtinWorldbooks).toHaveLength(1);
    expect(builtinWorldbooks[0]!.id).toBe(BUILTIN_WORLDBOOK_ID);
  });

  it("blocks deletion of builtin character and worldbook with 409", async () => {
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      seedBuiltinAssets: true,
    }));

    const deleteCharRes = await app.inject({
      method: "DELETE",
      url: `/characters/${BUILTIN_CHARACTER_ASSISTANT_ID}`,
    });
    expect(deleteCharRes.statusCode).toBe(409);
    expect(deleteCharRes.json<ErrorResponse>().error.code).toBe("builtin_asset_immutable");

    const deleteWbRes = await app.inject({
      method: "DELETE",
      url: `/worldbooks/${BUILTIN_WORLDBOOK_ID}`,
    });
    expect(deleteWbRes.statusCode).toBe(409);
    expect(deleteWbRes.json<ErrorResponse>().error.code).toBe("builtin_asset_immutable");
  });

  it("is idempotent when ensureBuiltinAssets runs repeatedly on the same database", async () => {
    const connection = createDatabase(":memory:");
    try {
      await ensureDefaultAdminAccount(connection.db);
      // 连续两次 seed：第二次不应重复插入（按稳定 id 存在即跳过）。
      await ensureBuiltinAssets(connection.db);
      await ensureBuiltinAssets(connection.db);

      const builtinChars = connection.db
        .select({ id: characters.id, source: characters.source })
        .from(characters)
        .all()
        .filter((row) => row.source === "builtin");
      expect(builtinChars).toHaveLength(2);

      const builtinWorldbooks = connection.db
        .select({ id: worldbooks.id, source: worldbooks.source })
        .from(worldbooks)
        .all()
        .filter((row) => row.source === "builtin");
      expect(builtinWorldbooks).toHaveLength(1);
    } finally {
      connection.close();
    }
  });
});

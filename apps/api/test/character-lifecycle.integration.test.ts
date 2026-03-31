import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app";
import * as retryModule from "../src/lib/retry.js";

const BASE_CHARACTER_CARD_V2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Nia",
    description: "A test archivist.",
    personality: "Thoughtful",
    scenario: "Smoke chamber",
    first_mes: "Hello from Nia",
    mes_example: "<START>\\nNia: hi"
  }
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type ItemResponse<T> = { data: T };

function makeCharacterCard(name: string) {
  return {
    ...BASE_CHARACTER_CARD_V2,
    data: {
      ...BASE_CHARACTER_CARD_V2.data,
      name,
      description: `${name} description`,
      first_mes: `Hello from ${name}`,
      mes_example: `<START>\n${name}: hi`
    }
  };
}

describe("Character lifecycle routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    await app.close();
  });

  async function importCharacter(name: string, headers?: Record<string, string>) {
    const imported = await app.inject({
      method: "POST",
      url: "/import/character",
      headers,
      payload: {
        payload: makeCharacterCard(name),
        create_session: false
      }
    });

    expect(imported.statusCode, imported.body).toBe(201);
    return imported.json<ItemResponse<{
      character_id: string;
      character_version_id: string;
    }>>().data;
  }

  it("covers list/detail/version/rollback/delete/restore flow", async () => {
    const imported = await importCharacter("Nia");

    const characterId = imported.character_id;
    const initialVersionId = imported.character_version_id;

    const listRes = await app.inject({ method: "GET", url: "/characters?sort_by=created_at&sort_order=asc" });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json<{
      data: Array<{ id: string; latest_version_no: number | null; revision: number }>;
      meta: { total: number };
    }>();
    expect(listBody.meta.total).toBe(1);
    expect(listBody.data[0]?.id).toBe(characterId);
    expect(listBody.data[0]?.latest_version_no).toBe(1);
    expect(listBody.data[0]?.revision).toBe(0);

    const detailRes = await app.inject({ method: "GET", url: `/characters/${characterId}` });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json<{
      data: {
        status: "active" | "deleted";
        revision: number;
        latest_version: { id: string; version_no: number } | null;
      };
    }>();
    expect(detailBody.data.status).toBe("active");
    expect(detailBody.data.latest_version?.id).toBe(initialVersionId);
    expect(detailBody.data.latest_version?.version_no).toBe(1);
    expect(detailBody.data.revision).toBe(0);

    const newVersionRes = await app.inject({
      method: "POST",
      url: `/characters/${characterId}/versions`,
      payload: {
        snapshot: {
          name: "Nia v2",
          description: "Updated"
        }
      }
    });
    expect(newVersionRes.statusCode, newVersionRes.body).toBe(201);
    const newVersionBody = newVersionRes.json<{
      data: { id: string; version_no: number; revision: number };
    }>();
    expect(newVersionBody.data.version_no).toBe(2);
    expect(newVersionBody.data.revision).toBe(1);

    const versionsRes = await app.inject({
      method: "GET",
      url: `/characters/${characterId}/versions?sort_by=version_no&sort_order=asc`
    });
    expect(versionsRes.statusCode).toBe(200);
    const versionsBody = versionsRes.json<{
      data: Array<{ id: string; version_no: number }>;
      meta: { total: number };
    }>();
    expect(versionsBody.meta.total).toBe(2);
    expect(versionsBody.data[0]?.version_no).toBe(1);
    expect(versionsBody.data[1]?.version_no).toBe(2);

    const rollbackRes = await app.inject({
      method: "POST",
      url: `/characters/${characterId}/versions/${initialVersionId}/rollback`
    });
    expect(rollbackRes.statusCode, rollbackRes.body).toBe(201);
    const rollbackBody = rollbackRes.json<{
      data: { version_no: number; rolled_back_from_version_id: string; revision: number };
    }>();
    expect(rollbackBody.data.version_no).toBe(3);
    expect(rollbackBody.data.rolled_back_from_version_id).toBe(initialVersionId);
    expect(rollbackBody.data.revision).toBe(2);

    const deleteRes = await app.inject({ method: "DELETE", url: `/characters/${characterId}` });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json<{ data: { revision: number } }>().data.revision).toBe(3);

    const appendAfterDeleteRes = await app.inject({
      method: "POST",
      url: `/characters/${characterId}/versions`,
      payload: {
        snapshot: {
          name: "Nia deleted"
        }
      }
    });
    expect(appendAfterDeleteRes.statusCode).toBe(409);
    expect(appendAfterDeleteRes.json<ErrorResponse>().error.code).toBe("character_deleted");

    const restoreRes = await app.inject({ method: "POST", url: `/characters/${characterId}/restore` });
    expect(restoreRes.statusCode).toBe(200);
    expect(restoreRes.json<{ data: { revision: number } }>().data.revision).toBe(4);

    const appendAfterRestoreRes = await app.inject({
      method: "POST",
      url: `/characters/${characterId}/versions`,
      payload: {
        snapshot: {
          name: "Nia restored"
        }
      }
    });
    expect(appendAfterRestoreRes.statusCode).toBe(201);
    const appendAfterRestoreBody = appendAfterRestoreRes.json<{
      data: { version_no: number; revision: number };
    }>();
    expect(appendAfterRestoreBody.data.version_no).toBe(4);
    expect(appendAfterRestoreBody.data.revision).toBe(5);
  });

  it("rejects stale expected_revision on concurrent version append attempts", async () => {
    const imported = await importCharacter("Concurrent Nia");

    const detailRes = await app.inject({ method: "GET", url: `/characters/${imported.character_id}` });
    expect(detailRes.statusCode).toBe(200);
    const revision = detailRes.json<{ data: { revision: number } }>().data.revision;

    const [firstRes, secondRes] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/characters/${imported.character_id}/versions`,
        payload: { snapshot: { name: "Concurrent Nia A" }, expected_revision: revision }
      }),
      app.inject({
        method: "POST",
        url: `/characters/${imported.character_id}/versions`,
        payload: { snapshot: { name: "Concurrent Nia B" }, expected_revision: revision }
      })
    ]);

    const responses = [firstRes, secondRes];
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);

    const conflict = responses.find((response) => response.statusCode === 409)!;
    expect(["character_revision_conflict", "character_conflict"]).toContain(conflict.json<ErrorResponse>().error.code);

    const detailAfterRes = await app.inject({ method: "GET", url: `/characters/${imported.character_id}` });
    expect(detailAfterRes.statusCode).toBe(200);
    expect(detailAfterRes.json<{ data: { latest_version_no: number | null; revision: number } }>().data).toEqual(
      expect.objectContaining({ latest_version_no: 2, revision: 1 })
    );
  });

  it("returns one success and one conflict for append versus delete with the same expected_revision", async () => {
    const imported = await importCharacter("Race Delete");

    const detailRes = await app.inject({ method: "GET", url: `/characters/${imported.character_id}` });
    expect(detailRes.statusCode).toBe(200);
    const revision = detailRes.json<{ data: { revision: number } }>().data.revision;

    const [appendRes, deleteRes] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/characters/${imported.character_id}/versions`,
        payload: { snapshot: { name: "Race Delete v2" }, expected_revision: revision }
      }),
      app.inject({
        method: "DELETE",
        url: `/characters/${imported.character_id}`,
        payload: { expected_revision: revision }
      })
    ]);

    const responses = [appendRes, deleteRes];
    expect(responses.filter((response) => response.statusCode === 201 || response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);

    const conflict = responses.find((response) => response.statusCode === 409)!;
    expect(["character_revision_conflict", "character_deleted"]).toContain(conflict.json<ErrorResponse>().error.code);

    const detailAfterRes = await app.inject({ method: "GET", url: `/characters/${imported.character_id}` });
    expect(detailAfterRes.statusCode).toBe(200);
    const detailAfter = detailAfterRes.json<{ data: { status: string; latest_version_no: number | null; revision: number } }>().data;
    expect(detailAfter.revision).toBe(1);
    expect([
      { status: "active", latest_version_no: 2 },
      { status: "deleted", latest_version_no: 1 }
    ]).toContainEqual({ status: detailAfter.status, latest_version_no: detailAfter.latest_version_no });
  });

  it("maps resource_busy on character writes", async () => {
    const imported = await importCharacter("Busy Character");
    vi.spyOn(retryModule, "executeWithSqliteBusyRetry").mockRejectedValueOnce(new retryModule.ResourceBusyError("database is locked"));

    const res = await app.inject({
      method: "POST",
      url: `/characters/${imported.character_id}/versions`,
      payload: { snapshot: { name: "Busy Character v2" } }
    });

    expect(res.statusCode).toBe(503);
    expect(res.json<ErrorResponse>().error.code).toBe("resource_busy");
  });

  it("covers list filters, missing branches, and rollback edge cases", async () => {
    const deletedCharacter = await importCharacter("Zed");
    const activeCharacter = await importCharacter("Aria");

    const deleteRes = await app.inject({ method: "DELETE", url: `/characters/${deletedCharacter.character_id}` });
    expect(deleteRes.statusCode).toBe(200);

    const deletedListRes = await app.inject({
      method: "GET",
      url: "/characters?status=deleted&keyword=Zed&sort_by=name&sort_order=asc"
    });
    expect(deletedListRes.statusCode).toBe(200);
    const deletedListBody = deletedListRes.json<{
      data: Array<{ id: string; name: string; status: string; latest_version_no: number | null }>;
      meta: { total: number };
    }>();
    expect(deletedListBody.meta.total).toBe(1);
    expect(deletedListBody.data).toEqual([
      expect.objectContaining({
        id: deletedCharacter.character_id,
        name: "Zed",
        status: "deleted",
        latest_version_no: 1
      })
    ]);

    const emptyListRes = await app.inject({
      method: "GET",
      url: "/characters?status=deleted&keyword=missing&sort_by=name&sort_order=asc"
    });
    expect(emptyListRes.statusCode).toBe(200);
    expect(emptyListRes.json<{ data: unknown[]; meta: { total: number } }>()).toEqual({
      data: [],
      meta: {
        total: 0,
        limit: 50,
        offset: 0,
        has_more: false,
        sort_by: "name",
        sort_order: "asc"
      }
    });

    const missingDetailRes = await app.inject({ method: "GET", url: "/characters/missing-character" });
    expect(missingDetailRes.statusCode).toBe(404);
    expect(missingDetailRes.json<ErrorResponse>().error.code).toBe("not_found");

    const invalidCreateVersionRes = await app.inject({
      method: "POST",
      url: `/characters/${activeCharacter.character_id}/versions`,
      payload: {
        snapshot: {}
      }
    });
    expect(invalidCreateVersionRes.statusCode).toBe(400);

    const secondVersionRes = await app.inject({
      method: "POST",
      url: `/characters/${activeCharacter.character_id}/versions`,
      payload: {
        snapshot: {
          name: "Aria v2"
        }
      }
    });
    expect(secondVersionRes.statusCode, secondVersionRes.body).toBe(201);

    const versionsByCreatedAtRes = await app.inject({
      method: "GET",
      url: `/characters/${activeCharacter.character_id}/versions?sort_by=created_at&sort_order=desc`
    });
    expect(versionsByCreatedAtRes.statusCode).toBe(200);
    const versionsByCreatedAtBody = versionsByCreatedAtRes.json<{
      data: Array<{ id: string; version_no: number }>;
      meta: { total: number };
    }>();
    expect(versionsByCreatedAtBody.meta.total).toBe(2);
    expect(versionsByCreatedAtBody.data).toHaveLength(2);

    const missingVersionsRes = await app.inject({
      method: "GET",
      url: "/characters/missing-character/versions"
    });
    expect(missingVersionsRes.statusCode).toBe(404);
    expect(missingVersionsRes.json<ErrorResponse>().error.code).toBe("not_found");

    const missingCreateVersionRes = await app.inject({
      method: "POST",
      url: "/characters/missing-character/versions",
      payload: {
        snapshot: {
          name: "Ghost"
        }
      }
    });
    expect(missingCreateVersionRes.statusCode).toBe(404);
    expect(missingCreateVersionRes.json<ErrorResponse>().error.code).toBe("not_found");

    const missingRollbackTargetRes = await app.inject({
      method: "POST",
      url: `/characters/${activeCharacter.character_id}/versions/missing-version/rollback`
    });
    expect(missingRollbackTargetRes.statusCode).toBe(404);
    expect(missingRollbackTargetRes.json<ErrorResponse>().error.code).toBe("not_found");

    const deletedRollbackRes = await app.inject({
      method: "POST",
      url: `/characters/${deletedCharacter.character_id}/versions/${deletedCharacter.character_version_id}/rollback`
    });
    expect(deletedRollbackRes.statusCode).toBe(409);
    expect(deletedRollbackRes.json<ErrorResponse>().error.code).toBe("character_deleted");

    const missingDeleteRes = await app.inject({ method: "DELETE", url: "/characters/missing-character" });
    expect(missingDeleteRes.statusCode).toBe(404);
    expect(missingDeleteRes.json<ErrorResponse>().error.code).toBe("not_found");

    const missingRestoreRes = await app.inject({ method: "POST", url: "/characters/missing-character/restore" });
    expect(missingRestoreRes.statusCode).toBe(404);
    expect(missingRestoreRes.json<ErrorResponse>().error.code).toBe("not_found");
  });
});

describe("Character routes with multi-account auth", () => {
  let app: FastifyInstance;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" }
    }));

    const rootToken = app.jwt.sign({ sub: "root", account_id: "default-admin", role: "user" });

    tokenA = app.jwt.sign({ sub: "u-a", account_id: "acc-a", role: "admin" });
    tokenB = app.jwt.sign({ sub: "u-b", account_id: "acc-b", role: "admin" });

    const createAccountARes = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { authorization: `Bearer ${rootToken}` },
      payload: { id: "acc-a", name: "Account A" }
    });
    expect(createAccountARes.statusCode).toBe(201);

    const createAccountBRes = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { authorization: `Bearer ${rootToken}` },
      payload: { id: "acc-b", name: "Account B" }
    });
    expect(createAccountBRes.statusCode).toBe(201);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  async function importCharacter(name: string, token: string) {
    const imported = await app.inject({
      method: "POST",
      url: "/import/character",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        payload: makeCharacterCard(name),
        create_session: false
      }
    });

    expect(imported.statusCode, imported.body).toBe(201);
    return imported.json<ItemResponse<{
      character_id: string;
      character_version_id: string;
    }>>().data;
  }

  it("isolates character routes by account", async () => {
    const imported = await importCharacter("Isla", tokenA);

    const listARes = await app.inject({
      method: "GET",
      url: "/characters",
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(listARes.statusCode).toBe(200);
    expect(listARes.json<{ data: Array<{ id: string }> }>().data).toEqual([
      expect.objectContaining({ id: imported.character_id })
    ]);

    const listBRes = await app.inject({
      method: "GET",
      url: "/characters?keyword=Isla&sort_by=name&sort_order=asc",
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(listBRes.statusCode).toBe(200);
    expect(listBRes.json<{ data: unknown[]; meta: { total: number } }>().data).toHaveLength(0);
    expect(listBRes.json<{ data: unknown[]; meta: { total: number } }>().meta.total).toBe(0);

    const detailBRes = await app.inject({
      method: "GET",
      url: `/characters/${imported.character_id}`,
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(detailBRes.statusCode).toBe(404);

    const versionsBRes = await app.inject({
      method: "GET",
      url: `/characters/${imported.character_id}/versions`,
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(versionsBRes.statusCode).toBe(404);

    const createVersionBRes = await app.inject({
      method: "POST",
      url: `/characters/${imported.character_id}/versions`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        snapshot: {
          name: "Isla v2"
        }
      }
    });
    expect(createVersionBRes.statusCode).toBe(404);

    const rollbackBRes = await app.inject({
      method: "POST",
      url: `/characters/${imported.character_id}/versions/${imported.character_version_id}/rollback`,
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(rollbackBRes.statusCode).toBe(404);

    const deleteBRes = await app.inject({
      method: "DELETE",
      url: `/characters/${imported.character_id}`,
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(deleteBRes.statusCode).toBe(404);

    const restoreBRes = await app.inject({
      method: "POST",
      url: `/characters/${imported.character_id}/restore`,
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(restoreBRes.statusCode).toBe(404);
  });
});

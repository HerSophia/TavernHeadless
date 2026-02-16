import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

const CHARACTER_CARD_V2 = {
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

describe("Character lifecycle routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    await app.close();
  });

  it("covers list/detail/version/rollback/delete/restore flow", async () => {
    const imported = await app.inject({
      method: "POST",
      url: "/import/character",
      payload: {
        payload: CHARACTER_CARD_V2,
        create_session: false
      }
    });

    expect(imported.statusCode, imported.body).toBe(201);
    const importedBody = imported.json<{
      data: {
        character_id: string;
        character_version_id: string;
      };
    }>();

    const characterId = importedBody.data.character_id;
    const initialVersionId = importedBody.data.character_version_id;

    const listRes = await app.inject({ method: "GET", url: "/characters?sort_by=created_at&sort_order=asc" });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json<{
      data: Array<{ id: string; latest_version_no: number | null }>;
      meta: { total: number };
    }>();
    expect(listBody.meta.total).toBe(1);
    expect(listBody.data[0]?.id).toBe(characterId);
    expect(listBody.data[0]?.latest_version_no).toBe(1);

    const detailRes = await app.inject({ method: "GET", url: `/characters/${characterId}` });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json<{
      data: {
        status: "active" | "deleted";
        latest_version: { id: string; version_no: number } | null;
      };
    }>();
    expect(detailBody.data.status).toBe("active");
    expect(detailBody.data.latest_version?.id).toBe(initialVersionId);
    expect(detailBody.data.latest_version?.version_no).toBe(1);

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
      data: { id: string; version_no: number };
    }>();
    expect(newVersionBody.data.version_no).toBe(2);

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
      data: { version_no: number; rolled_back_from_version_id: string };
    }>();
    expect(rollbackBody.data.version_no).toBe(3);
    expect(rollbackBody.data.rolled_back_from_version_id).toBe(initialVersionId);

    const deleteRes = await app.inject({ method: "DELETE", url: `/characters/${characterId}` });
    expect(deleteRes.statusCode).toBe(200);

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

    const restoreRes = await app.inject({ method: "POST", url: `/characters/${characterId}/restore` });
    expect(restoreRes.statusCode).toBe(200);

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
      data: { version_no: number };
    }>();
    expect(appendAfterRestoreBody.data.version_no).toBe(4);
  });
});

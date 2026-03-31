import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

const MINIMAL_REGEX_SCRIPTS = [
  {
    id: "regex-1",
    scriptName: "Test Regex",
    findRegex: "hello",
    replaceString: "world",
    placement: [1, 2],
    disabled: false,
  },
];

interface ImportResponse {
  data: {
    id: string;
    name: string;
    source: string;
    script_count?: number;
  };
}

interface DetailResponse {
  data: {
    id: string;
    name: string;
    source: string;
    data: unknown;
    created_at: number;
    version: number;
    updated_at: number;
  };
}

interface UpdateResponse {
  data: {
    id: string;
    name: string;
    source: string;
    created_at: number;
    version: number;
    updated_at: number;
  };
}

describe("Regex profile update routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    await app.close();
  });

  it("PUT /regex-profiles/:id updates a profile in place", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/regex",
      payload: { name: "Original Regex", data: MINIMAL_REGEX_SCRIPTS },
    });
    expect(importRes.statusCode).toBe(201);
    const profileId = importRes.json<ImportResponse>().data.id;

    const detailRes = await app.inject({ method: "GET", url: `/regex-profiles/${profileId}` });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json<DetailResponse>();

    const putRes = await app.inject({
      method: "PUT",
      url: `/regex-profiles/${profileId}`,
      payload: {
        name: "Updated Regex",
        expected_version: detailBody.data.version,
        data: [
          {
            id: "regex-1",
            scriptName: "Trim Input",
            findRegex: "hello",
            replaceString: "traveler",
            placement: [1, 2],
            disabled: false,
          },
          {
            id: "regex-2",
            scriptName: "Narration Guard",
            findRegex: "\\[ooc\\]",
            replaceString: "",
            placement: [2],
            disabled: true,
          },
        ]
      },
    });

    expect(putRes.statusCode, putRes.body).toBe(200);
    const putBody = putRes.json<UpdateResponse>();
    expect(putBody.data.id).toBe(profileId);
    expect(putBody.data.name).toBe("Updated Regex");
    expect(putBody.data.version).toBe(detailBody.data.version + 1);
    expect(putBody.data.updated_at).toBeGreaterThanOrEqual(detailBody.data.updated_at);

    const updatedDetailRes = await app.inject({ method: "GET", url: `/regex-profiles/${profileId}` });
    expect(updatedDetailRes.statusCode).toBe(200);
    const updatedDetailBody = updatedDetailRes.json<DetailResponse>();
    expect(updatedDetailBody.data.name).toBe("Updated Regex");

    const scripts = updatedDetailBody.data.data as Array<Record<string, unknown>>;
    expect(scripts).toHaveLength(2);
    expect(scripts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scriptName: "Trim Input", replaceString: "traveler" }),
        expect.objectContaining({ scriptName: "Narration Guard", disabled: true }),
      ])
    );
  });

  it("PUT /regex-profiles/:id returns 409 when expected_updated_at mismatches", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/regex",
      payload: { name: "Conflict Regex", data: MINIMAL_REGEX_SCRIPTS },
    });
    expect(importRes.statusCode).toBe(201);
    const profileId = importRes.json<ImportResponse>().data.id;

    const putRes = await app.inject({
      method: "PUT",
      url: `/regex-profiles/${profileId}`,
      payload: {
        name: "Conflict Regex",
        data: MINIMAL_REGEX_SCRIPTS,
        expected_updated_at: 1,
      },
    });

    expect(putRes.statusCode).toBe(409);
    const body = putRes.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("regex_profile_conflict");
  });

  it("PUT /regex-profiles/:id returns 404 when the profile does not exist", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: "/regex-profiles/missing-profile",
      payload: {
        name: "Missing Regex",
        data: MINIMAL_REGEX_SCRIPTS,
      },
    });

    expect(putRes.statusCode).toBe(404);
    const body = putRes.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("regex_profile_not_found");
  });

  it("PUT /regex-profiles/:id returns 400 for invalid body shape", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/regex",
      payload: { name: "Invalid Body Regex", data: MINIMAL_REGEX_SCRIPTS },
    });
    expect(importRes.statusCode).toBe(201);
    const profileId = importRes.json<ImportResponse>().data.id;

    const putRes = await app.inject({
      method: "PUT",
      url: `/regex-profiles/${profileId}`,
      payload: {
        name: "",
        data: [],
      },
    });

    expect(putRes.statusCode).toBe(400);
    const body = putRes.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("validation_error");
  });

  it("PUT /regex-profiles/:id returns 400 when regex data fails adapter validation", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/regex",
      payload: { name: "Broken Regex", data: MINIMAL_REGEX_SCRIPTS },
    });
    expect(importRes.statusCode).toBe(201);
    const profileId = importRes.json<ImportResponse>().data.id;

    const putRes = await app.inject({
      method: "PUT",
      url: `/regex-profiles/${profileId}`,
      payload: {
        name: "Broken Regex",
        data: [
          {
            replaceString: "world",
          },
        ],
      },
    });

    expect(putRes.statusCode).toBe(400);
    const body = putRes.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("regex_validation_error");
  });

  it("DELETE /regex-profiles/:id supports expected_version baseline and returns 409 for stale versions", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/regex",
      payload: { name: "Delete Regex", data: MINIMAL_REGEX_SCRIPTS },
    });
    expect(importRes.statusCode).toBe(201);
    const profileId = importRes.json<ImportResponse>().data.id;

    const detailRes = await app.inject({ method: "GET", url: `/regex-profiles/${profileId}` });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json<DetailResponse>();

    const updateRes = await app.inject({
      method: "PUT",
      url: `/regex-profiles/${profileId}`,
      payload: {
        name: "Delete Regex Updated",
        expected_version: detailBody.data.version,
        data: [
          {
            id: "regex-1",
            scriptName: "Updated",
            findRegex: "hello",
            replaceString: "traveler",
            placement: [1, 2],
            disabled: false,
          },
        ],
      },
    });
    expect(updateRes.statusCode).toBe(200);

    const staleDeleteRes = await app.inject({
      method: "DELETE",
      url: `/regex-profiles/${profileId}?expected_version=${detailBody.data.version}`,
    });
    expect(staleDeleteRes.statusCode).toBe(409);
    expect(staleDeleteRes.json<{ error: { code: string } }>().error.code).toBe("regex_profile_conflict");
  });
});

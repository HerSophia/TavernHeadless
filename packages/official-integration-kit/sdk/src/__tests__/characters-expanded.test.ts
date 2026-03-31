import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk characters expanded resource", () => {
  it("lists character versions with defaults", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            character_id: "char-1",
            content_hash: "hash-1",
            created_at: 100,
            id: "ver-2",
            snapshot: { name: "Hero v2" },
            version_no: 2,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.characters.listVersions({ characterId: "char-1" })).resolves.toEqual([
      {
        characterId: "char-1",
        contentHash: "hash-1",
        createdAt: 100,
        id: "ver-2",
        snapshot: { name: "Hero v2" },
        versionNo: 2,
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/characters/char-1/versions");
    expect(requestUrl.searchParams.get("limit")).toBe("100");
    expect(requestUrl.searchParams.get("offset")).toBe("0");
    expect(requestUrl.searchParams.get("sort_by")).toBe("version_no");
    expect(requestUrl.searchParams.get("sort_order")).toBe("desc");
  });

  it("rolls back a character version", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          data: {
            character_id: "char-1",
            content_hash: "hash-1",
            created_at: 120,
            id: "ver-3",
            rolled_back_from_version_id: "ver-1",
            revision: 2,
            snapshot: { name: "Hero v1" },
            version_no: 3,
          },
        },
        201,
      ),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.characters.rollbackVersion({
        characterId: "char-1",
        expectedRevision: 1,
        versionId: "ver-1",
      }),
    ).resolves.toEqual({
      characterId: "char-1",
      contentHash: "hash-1",
      createdAt: 120,
      id: "ver-3",
      rolledBackFromVersionId: "ver-1",
      snapshot: { name: "Hero v1" },
      revision: 2,
      versionNo: 3,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ expected_revision: 1 }));
  });

  it("passes keyword through the character list query", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            created_at: 1,
            id: "char-1",
            latest_version_no: null,
            name: "Hero",
            revision: 0,
            source: "sillytavern",
            status: "active",
            updated_at: 2,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.characters.list({
        keyword: "Her",
      }),
    ).resolves.toEqual([
      {
        createdAt: 1,
        id: "char-1",
        latestVersionNo: null,
        name: "Hero",
        revision: 0,
        source: "sillytavern",
        status: "active",
        updatedAt: 2,
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/characters");
    expect(requestUrl.searchParams.get("keyword")).toBe("Her");
    expect(requestUrl.searchParams.get("status")).toBe("active");
  });
});

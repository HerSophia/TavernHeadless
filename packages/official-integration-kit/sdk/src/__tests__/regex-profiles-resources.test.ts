import { describe, expect, it, vi } from "vitest";

import { createRegexProfilesResource } from "../resources/regex-profiles.js";
import { createTransportClient } from "../client/transport.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    headers: body === null ? undefined : { "content-type": "application/json" },
    status,
  });
}

describe("sdk regex profile resources", () => {
  it("lists, gets, updates, and removes regex profiles", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              created_at: 10,
              id: "regex-1",
              name: "Regex A",
              source: "sillytavern",
              version: 2,
              updated_at: 11,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            created_at: 10,
            data: [{ scriptName: "rule" }],
            id: "regex-1",
            name: "Regex A",
            source: "sillytavern",
            version: 2,
            updated_at: 11,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            created_at: 10,
            id: "regex-1",
            name: "Regex B",
            source: "sillytavern",
            version: 3,
            updated_at: 12,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(null, 204));

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const regexProfiles = createRegexProfilesResource(transport);

    await expect(regexProfiles.list()).resolves.toEqual([
      {
        createdAt: 10,
        id: "regex-1",
        name: "Regex A",
        source: "sillytavern",
        version: 2,
        updatedAt: 11,
      },
    ]);

    await expect(regexProfiles.getDetail({ profileId: "regex-1" })).resolves.toEqual({
      createdAt: 10,
      data: [{ scriptName: "rule" }],
      id: "regex-1",
      name: "Regex A",
      source: "sillytavern",
      version: 2,
      updatedAt: 11,
    });

    await expect(
      regexProfiles.update({
        data: '[{"scriptName":"rule-2"}]',
        expectedVersion: 2,
        expectedUpdatedAt: 11,
        name: "Regex B",
        profileId: "regex-1",
      }),
    ).resolves.toEqual({
      createdAt: 10,
      id: "regex-1",
      name: "Regex B",
      source: "sillytavern",
      version: 3,
      updatedAt: 12,
    });

    await expect(regexProfiles.remove({ profileId: "regex-1" })).resolves.toBe(true);

    const [, updateInit] = fetchImpl.mock.calls[2]!;
    expect(updateInit?.body).toBe(JSON.stringify({
      data: '[{"scriptName":"rule-2"}]',
      expected_version: 2,
      expected_updated_at: 11,
      name: "Regex B",
    }));
  });
});

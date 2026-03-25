import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk llm profiles expanded resource", () => {
  it("gets a single profile by id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          api_key_masked: "sk-***",
          api_key_name: "main-key",
          base_url: "https://api.example.com",
          created_at: 10,
          id: "profile-1",
          last_used_at: 11,
          model_id: "gpt-4o-mini",
          preset_name: "Default",
          provider: "openai",
          status: "active",
          updated_at: 12,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.llmProfiles.getDetail({ profileId: "profile-1" })).resolves.toEqual({
      apiKeyMasked: "sk-***",
      apiKeyName: "main-key",
      baseUrl: "https://api.example.com",
      createdAt: 10,
      id: "profile-1",
      lastUsedAt: 11,
      modelId: "gpt-4o-mini",
      presetName: "Default",
      provider: "openai",
      status: "active",
      updatedAt: 12,
    });
  });
});

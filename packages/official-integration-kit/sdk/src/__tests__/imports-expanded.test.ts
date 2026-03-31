import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk imports expanded resource", () => {
  it("imports regex profiles", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          data: {
            id: "regex-1",
            name: "Regex A",
            script_count: 3,
            source: "sillytavern",
          },
        },
        201,
      ),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.imports.regex({
        data: '[{"scriptName":"rule"}]',
        name: "Regex A",
      }),
    ).resolves.toEqual({
      id: "regex-1",
      name: "Regex A",
      scriptCount: 3,
      source: "sillytavern",
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({
      data: '[{"scriptName":"rule"}]',
      name: "Regex A",
    }));
  });

  it("imports chats and preserves backend counters", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          data: {
            floor_count: 2,
            format: "sillytavern_jsonl",
            import_source: "sillytavern_jsonl",
            message_count: 8,
            session_id: "session-1",
            skipped_lines: 1,
            swipe_count: 3,
            title: "Imported Chat",
          },
        },
        201,
      ),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.imports.chat({
        characterId: "char-1",
        data: "line-1\nline-2",
        title: "Imported Chat",
      }),
    ).resolves.toEqual({
      floorCount: 2,
      format: "sillytavern_jsonl",
      importSource: "sillytavern_jsonl",
      messageCount: 8,
      sessionId: "session-1",
      skippedLines: 1,
      swipeCount: 3,
      title: "Imported Chat",
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({
      character_id: "char-1",
      data: "line-1\nline-2",
      title: "Imported Chat",
    }));
  });

  it("creates async chat import jobs and preserves compatibility request fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          data: {
            job_id: "ctj-import-1",
            status: "pending",
            job_kind: "import_chat",
            format: "sillytavern_jsonl",
          },
        },
        202,
      ),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.imports.chatJob({
        characterId: "char-1",
        data: "line-1\nline-2",
        title: "Imported Chat",
      }),
    ).resolves.toEqual({
      format: "sillytavern_jsonl",
      jobId: "ctj-import-1",
      jobKind: "import_chat",
      status: "pending",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/import/chat/jobs");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      character_id: "char-1",
      data: "line-1\nline-2",
      title: "Imported Chat",
    }));
  });
});

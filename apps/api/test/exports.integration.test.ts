import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

const MINIMAL_PRESET = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "You are a helpful assistant.",
    },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [{ identifier: "main", enabled: true }],
    },
  ],
  temperature: 0.8,
  openai_max_context: 8000,
  openai_max_tokens: 500,
};

const MINIMAL_WORLDBOOK = {
  name: "Test World",
  entries: {
    "0": {
      uid: 0,
      key: ["dragon"],
      content: "Dragons are powerful creatures.",
      position: 0,
      constant: false,
      selective: false,
    },
  },
};

const RICH_WORLDBOOK = {
  name: "Recursive World",
  scanDepth: 6,
  caseSensitive: true,
  matchWholeWords: true,
  recursive: true,
  maxRecursionSteps: 3,
  entries: {
    "0": {
      uid: 0,
      key: ["dragon"],
      keysecondary: ["fire"],
      content: "Dragons are powerful creatures.",
      selective: true,
      selectiveLogic: 0,
      constant: false,
      position: 7,
      extensions: {
        outlet_name: "LoreOutlet",
        exclude_recursion: true,
        delay_until_recursion: 2,
      },
    },
  },
};

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

const CHARACTER_CARD_V2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Luna",
    description: "A curious moon archivist.",
    personality: "Soft-spoken and precise.",
    scenario: "An observatory above a sea of clouds.",
    first_mes: "Welcome back. The stars kept your seat warm.",
    mes_example: "<START>\nLuna: I catalog memories by starlight.",
  },
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type ItemResponse<T> = { data: T };

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("Export routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  async function createSession(title: string) {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title },
    });

    expect(res.statusCode).toBe(201);
    return res.json<ItemResponse<{ id: string }>>().data;
  }

  it("exports chat as thchat and respects include_variables=false and include_memories=false", async () => {
    const session = await createSession("Unsafe/Chat");

    const res = await app.inject({
      method: "GET",
      url: `/export/chat/${session.id}?include_variables=false&include_memories=false`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toContain('filename="Unsafe_Chat.thchat"');

    const body = res.json<{
      spec: string;
      data: {
        title: string;
        floors: unknown[];
        variables?: unknown;
        memories?: unknown;
      };
    }>();

    expect(body.spec).toBeDefined();
    expect(body.data.title).toBe("Unsafe/Chat");
    expect(body.data.floors).toEqual([]);
    expect(body.data.variables).toBeUndefined();
    expect(body.data.memories).toBeUndefined();
  });

  it("exports chat as st_jsonl and returns 404 when the session does not exist", async () => {
    const session = await createSession("Hero/Guide");

    const jsonlRes = await app.inject({
      method: "GET",
      url: `/export/chat/${session.id}?format=st_jsonl`,
    });

    expect(jsonlRes.statusCode).toBe(200);
    expect(jsonlRes.headers["content-type"]).toContain("application/x-ndjson");
    expect(jsonlRes.headers["content-disposition"]).toContain('filename="Hero_Guide.jsonl"');

    const [headerLine] = jsonlRes.body.trim().split("\n");
    const header = JSON.parse(headerLine!) as {
      user_name: string;
      character_name: string;
      chat_metadata: { th_session_title: string | null };
    };

    expect(header.user_name).toBe("User");
    expect(header.character_name).toBe("Hero/Guide");
    expect(header.chat_metadata.th_session_title).toBe("Hero/Guide");

    const missingRes = await app.inject({
      method: "GET",
      url: "/export/chat/missing-session",
    });

    expect(missingRes.statusCode).toBe(404);
    expect(missingRes.json<ErrorResponse>().error.code).toBe("session_not_found");
  });

  it("exports preset, worldbook, and regex resources and covers their 404 branches", async () => {
    const presetImportRes = await app.inject({
      method: "POST",
      url: "/import/preset",
      payload: {
        name: "Preset/One",
        data: MINIMAL_PRESET,
      },
    });
    expect(presetImportRes.statusCode).toBe(201);
    const presetId = presetImportRes.json<ItemResponse<{ id: string }>>().data.id;

    const presetExportRes = await app.inject({
      method: "GET",
      url: `/export/preset/${presetId}`,
    });
    expect(presetExportRes.statusCode).toBe(200);
    expect(presetExportRes.headers["content-disposition"]).toContain('filename="Preset_One.json"');
    const presetBody = presetExportRes.json<{ prompts: Array<{ identifier: string }> }>();
    expect(presetBody.prompts[0]?.identifier).toBe("main");

    const missingPresetRes = await app.inject({
      method: "GET",
      url: "/export/preset/missing-preset",
    });
    expect(missingPresetRes.statusCode).toBe(404);
    expect(missingPresetRes.json<ErrorResponse>().error.code).toBe("preset_not_found");

    const worldbookImportRes = await app.inject({
      method: "POST",
      url: "/import/worldbook",
      payload: {
        name: "World/One",
        data: MINIMAL_WORLDBOOK,
      },
    });
    expect(worldbookImportRes.statusCode).toBe(201);
    const worldbookId = worldbookImportRes.json<ItemResponse<{ id: string }>>().data.id;

    const worldbookExportRes = await app.inject({
      method: "GET",
      url: `/export/worldbook/${worldbookId}`,
    });
    expect(worldbookExportRes.statusCode).toBe(200);
    expect(worldbookExportRes.headers["content-disposition"]).toContain('filename="World_One.json"');
    const worldbookBody = worldbookExportRes.json<{
      name: string;
      entries: Record<string, { content: string }>;
    }>();
    expect(worldbookBody.name).toBe("World/One");
    expect(worldbookBody.entries["0"]?.content).toBe("Dragons are powerful creatures.");

    const missingWorldbookRes = await app.inject({
      method: "GET",
      url: "/export/worldbook/missing-worldbook",
    });
    expect(missingWorldbookRes.statusCode).toBe(404);
    expect(missingWorldbookRes.json<ErrorResponse>().error.code).toBe("worldbook_not_found");

    const regexImportRes = await app.inject({
      method: "POST",
      url: "/import/regex",
      payload: {
        name: "Regex/One",
        data: MINIMAL_REGEX_SCRIPTS,
      },
    });
    expect(regexImportRes.statusCode).toBe(201);
    const regexId = regexImportRes.json<ItemResponse<{ id: string }>>().data.id;

    const regexExportRes = await app.inject({
      method: "GET",
      url: `/export/regex/${regexId}`,
    });
    expect(regexExportRes.statusCode).toBe(200);
    expect(regexExportRes.headers["content-disposition"]).toContain('filename="Regex_One.json"');
    const regexBody = regexExportRes.json<Array<{ scriptName: string; markdownOnly: boolean }>>();
    expect(regexBody[0]?.scriptName).toBe("Test Regex");
    expect(regexBody[0]?.markdownOnly).toBe(false);

    const missingRegexRes = await app.inject({
      method: "GET",
      url: "/export/regex/missing-regex",
    });
    expect(missingRegexRes.statusCode).toBe(404);
    expect(missingRegexRes.json<ErrorResponse>().error.code).toBe("regex_profile_not_found");
  });

  it("exports worldbook global settings and recursive or outlet fields without losing semantics", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/worldbook",
      payload: {
        name: "Rich World",
        data: RICH_WORLDBOOK,
      },
    });
    expect(importRes.statusCode).toBe(201);
    const worldbookId = importRes.json<ItemResponse<{ id: string }>>().data.id;

    const exportRes = await app.inject({
      method: "GET",
      url: `/export/worldbook/${worldbookId}`,
    });
    expect(exportRes.statusCode).toBe(200);

    const body = exportRes.json<{
      scanDepth: number;
      caseSensitive: boolean;
      matchWholeWords: boolean;
      recursive: boolean;
      maxRecursionSteps: number;
      entries: Record<string, Record<string, unknown>>;
    }>();
    expect(body).toMatchObject({ scanDepth: 6, caseSensitive: true, matchWholeWords: true, recursive: true, maxRecursionSteps: 3 });
    expect(body.entries["0"]).toMatchObject({ key: ["dragon"], keysecondary: ["fire"], position: 7, outletName: "LoreOutlet", excludeRecursion: true, delayUntilRecursion: 2 });
    expect((body.entries["0"]?.extensions as Record<string, unknown> | undefined)?.outlet_name).toBe("LoreOutlet");
  });

  it("exports the latest character card and a specific version and covers missing-resource branches", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/character",
      payload: {
        payload: CHARACTER_CARD_V2,
        create_session: false,
      },
    });

    expect(importRes.statusCode).toBe(201);
    const imported = importRes.json<ItemResponse<{ character_id: string; character_version_id: string }>>().data;

    const latestRes = await app.inject({
      method: "GET",
      url: `/export/character/${imported.character_id}`,
    });

    expect(latestRes.statusCode).toBe(200);
    expect(latestRes.headers["content-disposition"]).toContain('filename="Luna.json"');
    const latestBody = latestRes.json<{
      spec: string;
      spec_version: string;
      data: { name: string; first_mes: string };
    }>();
    expect(latestBody.spec).toBe("chara_card_v2");
    expect(latestBody.spec_version).toBe("2.0");
    expect(latestBody.data.name).toBe("Luna");
    expect(latestBody.data.first_mes).toBe("Welcome back. The stars kept your seat warm.");

    const versionedRes = await app.inject({
      method: "GET",
      url: `/export/character/${imported.character_id}?version_id=${imported.character_version_id}`,
    });

    expect(versionedRes.statusCode).toBe(200);
    expect(versionedRes.json<{ data: { name: string } }>().data.name).toBe("Luna");

    const missingCharacterRes = await app.inject({
      method: "GET",
      url: "/export/character/missing-character",
    });

    expect(missingCharacterRes.statusCode).toBe(404);
    expect(missingCharacterRes.json<ErrorResponse>().error.code).toBe("character_not_found");

    const missingVersionRes = await app.inject({
      method: "GET",
      url: `/export/character/${imported.character_id}?version_id=missing-version`,
    });

    expect(missingVersionRes.statusCode).toBe(404);
    expect(missingVersionRes.json<ErrorResponse>().error.code).toBe("character_version_not_found");
  });
});

describe("Export routes multi-account isolation", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" },
    }));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  const rootTokenForSetup = () => app.jwt.sign({ sub: "root", account_id: "default-admin", role: "user" });

  async function createAccount(token: string, id: string, name: string) {
    const response = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: authHeader(token),
      payload: { id, name },
    });

    expect(response.statusCode, response.body).toBe(201);
  }

  async function createSession(headers: Record<string, string>): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      headers,
      payload: { title: "Private Export Session" },
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<ItemResponse<{ id: string }>>().data.id;
  }

  it("returns 404 when exporting a foreign session", async () => {
    const tokenA = app.jwt.sign({ sub: "u-a", account_id: "acc-a", role: "admin" });
    const tokenB = app.jwt.sign({ sub: "u-b", account_id: "acc-b", role: "admin" });
    const rootToken = rootTokenForSetup();

    await createAccount(rootToken, "acc-a", "Account A");
    await createAccount(rootToken, "acc-b", "Account B");

    const sessionId = await createSession(authHeader(tokenA));

    const foreignThChat = await app.inject({ method: "GET", url: `/export/chat/${sessionId}`, headers: authHeader(tokenB) });
    expect(foreignThChat.statusCode).toBe(404);
    expect(foreignThChat.json<ErrorResponse>().error.code).toBe("session_not_found");

    const foreignJsonl = await app.inject({ method: "GET", url: `/export/chat/${sessionId}?format=st_jsonl`, headers: authHeader(tokenB) });
    expect(foreignJsonl.statusCode).toBe(404);
    expect(foreignJsonl.json<ErrorResponse>().error.code).toBe("session_not_found");

    const ownExport = await app.inject({ method: "GET", url: `/export/chat/${sessionId}`, headers: authHeader(tokenA) });
    expect(ownExport.statusCode).toBe(200);
  });
});

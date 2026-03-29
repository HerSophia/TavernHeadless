import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

const TH_CHAT_SPEC = "tavern_headless_chat";
const TH_CHAT_SPEC_VERSION = "1.0.0";

const CHARACTER_CARD_V2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Luna",
    description: "A careful archivist.",
    personality: "Precise and calm.",
    scenario: "A quiet library at night.",
    first_mes: "The shelves remember more than people do.",
    mes_example: "<START>\nLuna: Every page has a witness.",
  },
};

interface ChatImportResponse {
  data: {
    session_id: string;
    title: string;
    floor_count: number;
    message_count: number;
    swipe_count?: number;
    skipped_lines: number;
    import_source: "thchat" | "sillytavern_jsonl";
    format: "thchat" | "sillytavern_jsonl";
    page_count?: number;
    variable_count?: number;
    memory_item_count?: number;
    memory_edge_count?: number;
  };
}

interface SessionResponse {
  data: {
    id: string;
    title: string | null;
    character_binding: {
      character_id: string;
    } | null;
  };
}

interface TimelineResponse {
  data: {
    session_id: string;
    branch_id: string;
    floors: Array<{
      id: string;
      floor_no: number;
      page_count: number;
      active_page: {
        id: string;
        messages: Array<{ content: string }>;
      } | null;
    }>;
  };
}

interface ListResponse<T> {
  data: T[];
}

function makeMinimalThChatFile(): any {
  return {
    spec: TH_CHAT_SPEC,
    spec_version: TH_CHAT_SPEC_VERSION,
    exported_at: 1700000005000,
    export_source: "test-suite",
    data: {
      title: "Original ThChat Title",
      status: "active",
      created_at: 1700000000000,
      updated_at: 1700000004000,
      character_snapshot: { name: "Archivist", greeting: "Stored greeting" },
      user_snapshot: { name: "Traveler" },
      character_sync_policy: "pin",
      prompt_mode: "native",
      model_provider: "openai",
      model_name: "gpt-4.1-mini",
      metadata: { imported_from: "test" },
      floors: [
        {
          floor_no: 0,
          branch_id: "main",
          parent_floor_id_ref: null,
          state: "committed",
          token_in: 0,
          token_out: 4,
          metadata: { floor: 1 },
          created_at: 1700000000000,
          updated_at: 1700000000001,
          _original_id: "floor_001",
          pages: [
            {
              page_no: 0,
              page_kind: "output",
              is_active: true,
              version: 1,
              checksum: "chk-001",
              created_at: 1700000000000,
              updated_at: 1700000000001,
              _original_id: "page_001",
              messages: [
                {
                  seq: 0,
                  role: "assistant",
                  content: "Hello from .thchat",
                  content_format: "text",
                  token_count: 4,
                  is_hidden: false,
                  source: "archive",
                  created_at: 1700000000000,
                  _original_id: "msg_001",
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

async function createCharacter(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/import/character",
    payload: {
      payload: CHARACTER_CARD_V2,
      create_session: false,
    },
  });

  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ data: { character_id: string } }>().data.character_id;
}

describe("Import chat routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST /import/chat imports SillyTavern jsonl with skipped lines, swipes, and bound character", async () => {
    const characterId = await createCharacter(app);
    const content = [
      JSON.stringify({ chat_metadata: { source: "test" }, user_name: "Traveler", character_name: "Luna" }),
      "",
      "not json at all",
      JSON.stringify({ name: "Traveler", is_user: true, mes: "Question" }),
      JSON.stringify({
        name: "Luna",
        is_user: false,
        mes: "Answer v1",
        swipes: ["Answer v1", "Answer v2", "Answer v3"],
        swipe_id: 1,
      }),
    ].join("\n");

    const importRes = await app.inject({
      method: "POST",
      url: "/import/chat",
      payload: {
        data: content,
        character_id: characterId,
      },
    });

    expect(importRes.statusCode, importRes.body).toBe(201);
    const importBody = importRes.json<ChatImportResponse>();
    expect(importBody.data.title).toBe("Luna");
    expect(importBody.data.floor_count).toBe(1);
    expect(importBody.data.message_count).toBe(4);
    expect(importBody.data.swipe_count).toBe(3);
    expect(importBody.data.skipped_lines).toBe(2);
    expect(importBody.data.import_source).toBe("sillytavern_jsonl");
    expect(importBody.data.format).toBe("sillytavern_jsonl");

    const sessionId = importBody.data.session_id;

    const sessionRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    expect(sessionRes.statusCode).toBe(200);
    const sessionBody = sessionRes.json<SessionResponse>();
    expect(sessionBody.data.character_binding?.character_id).toBe(characterId);

    const timelineRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}/timeline` });
    expect(timelineRes.statusCode).toBe(200);
    const timelineBody = timelineRes.json<TimelineResponse>();
    expect(timelineBody.data.floors).toHaveLength(1);
    expect(timelineBody.data.floors[0]!.page_count).toBe(4);

    const contents = timelineBody.data.floors[0]!.active_page?.messages.map((message) => message.content) ?? [];
    expect(contents).toEqual(expect.arrayContaining(["Question", "Answer v2"]));
  });

  it("POST /import/chat returns 400 when the chat file contains no messages", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/import/chat",
      payload: {
        data: JSON.stringify({ chat_metadata: {}, user_name: "Traveler", character_name: "Luna" }),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("import_empty");
  });

  it("POST /import/chat returns 400 for an invalid jsonl header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/import/chat",
      payload: {
        data: [
          JSON.stringify({ something_else: true }),
          JSON.stringify({ name: "Traveler", is_user: true, mes: "Hello" }),
        ].join("\n"),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe("import_parse_error");
    expect(body.error.message).toContain("must contain at least one of");
  });

  it("POST /import/chat imports .thchat files with variables and memories", async () => {
    const characterId = await createCharacter(app);
    const file = makeMinimalThChatFile();
    file.data.variables = [
      { scope: "chat", scope_id_ref: null, key: "chat-key", value: { mood: "calm" }, updated_at: 1700000000100 },
      { scope: "floor", scope_id_ref: "floor_001", key: "floor-key", value: 7, updated_at: 1700000000200 },
      { scope: "page", scope_id_ref: "page_001", key: "page-key", value: ["a", "b"], updated_at: 1700000000300 },
    ];
    file.data.memories = {
      items: [
        {
          _original_id: "mem_001",
          scope: "chat",
          scope_id_ref: null,
          type: "fact",
          content: { text: "Global fact" },
          importance: 0.8,
          confidence: 1,
          source_floor_id_ref: null,
          source_message_id_ref: null,
          status: "active",
          lifecycle_status: "active",
          source_job_id: "memory-job:ingest_turn:seed-floor",
          token_count_estimate: 14,
          last_used_at: 1700000000450,
          created_at: 1700000000400,
          updated_at: 1700000000500,
        },
        {
          _original_id: "mem_002",
          scope: "floor",
          scope_id_ref: "floor_001",
          type: "summary",
          summary_tier: "macro",
          content: { text: "Floor summary" },
          importance: 0.5,
          confidence: 0.9,
          source_floor_id_ref: "floor_001",
          source_message_id_ref: "msg_001",
          status: "active",
          lifecycle_status: "compacted",
          source_job_id: "memory-job:compact_macro:floor_001:seed",
          token_count_estimate: 28,
          last_used_at: 1700000000650,
          coverage_start_floor_no: 0,
          coverage_end_floor_no: 0,
          derived_from_count: 3,
          created_at: 1700000000600,
          updated_at: 1700000000700,
        },
      ],
      edges: [
        { from_id_ref: "mem_001", to_id_ref: "mem_002", relation: "derived_from", created_at: 1700000000800 },
        { from_id_ref: "mem_001", to_id_ref: "missing_ref", relation: "updates", created_at: 1700000000900 },
      ],
    };

    const importRes = await app.inject({
      method: "POST",
      url: "/import/chat",
      payload: {
        data: JSON.stringify(file),
        title: "Override ThChat Title",
        character_id: characterId,
      },
    });

    expect(importRes.statusCode, importRes.body).toBe(201);
    const importBody = importRes.json<ChatImportResponse>();
    expect(importBody.data.title).toBe("Override ThChat Title");
    expect(importBody.data.floor_count).toBe(1);
    expect(importBody.data.page_count).toBe(1);
    expect(importBody.data.message_count).toBe(1);
    expect(importBody.data.variable_count).toBe(3);
    expect(importBody.data.memory_item_count).toBe(2);
    expect(importBody.data.memory_edge_count).toBe(1);
    expect(importBody.data.skipped_lines).toBe(0);
    expect(importBody.data.import_source).toBe("thchat");
    expect(importBody.data.format).toBe("thchat");

    const sessionId = importBody.data.session_id;

    const sessionRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    expect(sessionRes.statusCode).toBe(200);
    const sessionBody = sessionRes.json<SessionResponse>();
    expect(sessionBody.data.title).toBe("Override ThChat Title");
    expect(sessionBody.data.character_binding?.character_id).toBe(characterId);

    const timelineRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}/timeline` });
    expect(timelineRes.statusCode).toBe(200);
    const timelineBody = timelineRes.json<TimelineResponse>();
    expect(timelineBody.data.floors).toHaveLength(1);
    expect(timelineBody.data.floors[0]!.page_count).toBe(1);
    expect(timelineBody.data.floors[0]!.active_page?.messages[0]!.content).toBe("Hello from .thchat");

    const floorId = timelineBody.data.floors[0]!.id;
    const pageId = timelineBody.data.floors[0]!.active_page!.id;

    const chatVarsRes = await app.inject({
      method: "GET",
      url: `/variables?scope=chat&scope_id=${sessionId}&limit=10&offset=0&sort_by=updated_at&sort_order=asc`,
    });
    expect(chatVarsRes.statusCode).toBe(200);
    const chatVarsBody = chatVarsRes.json<ListResponse<{ key: string }>>();
    expect(chatVarsBody.data).toEqual([expect.objectContaining({ key: "chat-key" })]);

    const floorVarsRes = await app.inject({
      method: "GET",
      url: `/variables?scope=floor&scope_id=${floorId}&limit=10&offset=0&sort_by=updated_at&sort_order=asc`,
    });
    expect(floorVarsRes.statusCode).toBe(200);
    const floorVarsBody = floorVarsRes.json<ListResponse<{ key: string }>>();
    expect(floorVarsBody.data).toEqual([expect.objectContaining({ key: "floor-key" })]);

    const pageVarsRes = await app.inject({
      method: "GET",
      url: `/variables?scope=page&scope_id=${pageId}&limit=10&offset=0&sort_by=updated_at&sort_order=asc`,
    });
    expect(pageVarsRes.statusCode).toBe(200);
    const pageVarsBody = pageVarsRes.json<ListResponse<{ key: string }>>();
    expect(pageVarsBody.data).toEqual([expect.objectContaining({ key: "page-key" })]);

    const chatMemoriesRes = await app.inject({
      method: "GET",
      url: `/memories?scope=chat&scope_id=${sessionId}&limit=10&offset=0&sort_by=created_at&sort_order=asc`,
    });
    expect(chatMemoriesRes.statusCode).toBe(200);
    const chatMemoriesBody = chatMemoriesRes.json<ListResponse<{
      id: string;
      lifecycle_status: string;
      source_job_id: string | null;
      token_count_estimate: number | null;
      last_used_at: number | null;
    }>>();
    expect(chatMemoriesBody.data).toHaveLength(1);
    expect(chatMemoriesBody.data[0]).toEqual(expect.objectContaining({
      lifecycle_status: "active",
      source_job_id: "memory-job:ingest_turn:seed-floor",
      token_count_estimate: 14,
      last_used_at: 1700000000450,
    }));

    const floorMemoriesRes = await app.inject({
      method: "GET",
      url: `/memories?scope=floor&scope_id=${floorId}&limit=10&offset=0&sort_by=created_at&sort_order=asc`,
    });
    expect(floorMemoriesRes.statusCode).toBe(200);
    const floorMemoriesBody = floorMemoriesRes.json<ListResponse<{
      id: string;
      summary_tier: string | null;
      lifecycle_status: string;
      source_job_id: string | null;
      token_count_estimate: number | null;
      last_used_at: number | null;
      coverage_start_floor_no: number | null;
      coverage_end_floor_no: number | null;
      derived_from_count: number | null;
    }>>();
    expect(floorMemoriesBody.data).toHaveLength(1);
    expect(floorMemoriesBody.data[0]).toEqual(expect.objectContaining({
      summary_tier: "macro",
      lifecycle_status: "compacted",
      source_job_id: "memory-job:compact_macro:floor_001:seed",
      token_count_estimate: 28,
      last_used_at: 1700000000650,
      coverage_start_floor_no: 0,
      coverage_end_floor_no: 0,
      derived_from_count: 3,
    }));

    const chatScopeStatesRes = await app.inject({
      method: "GET",
      url: `/memory/scopes?scope=chat&scope_id=${sessionId}&limit=10&offset=0&sort_by=updated_at&sort_order=asc`,
    });
    expect(chatScopeStatesRes.statusCode).toBe(200);
    const chatScopeStatesBody = chatScopeStatesRes.json<ListResponse<{
      revision: number;
      last_processed_floor_no: number | null;
      last_compaction_at: number | null;
    }>>();
    expect(chatScopeStatesBody.data).toEqual([
      expect.objectContaining({ revision: 1, last_processed_floor_no: 0, last_compaction_at: null }),
    ]);

    const floorScopeStatesRes = await app.inject({
      method: "GET",
      url: `/memory/scopes?scope=floor&scope_id=${floorId}&limit=10&offset=0&sort_by=updated_at&sort_order=asc`,
    });
    expect(floorScopeStatesRes.statusCode).toBe(200);
    const floorScopeStatesBody = floorScopeStatesRes.json<ListResponse<{
      revision: number;
      last_processed_floor_no: number | null;
      last_compaction_at: number | null;
    }>>();
    expect(floorScopeStatesBody.data).toEqual([
      expect.objectContaining({ revision: 1, last_processed_floor_no: 0, last_compaction_at: expect.any(Number) }),
    ]);

    const memoryEdgesRes = await app.inject({
      method: "GET",
      url: `/memory-edges?from_id=${chatMemoriesBody.data[0]!.id}&limit=10&offset=0&sort_by=created_at&sort_order=asc`,
    });
    expect(memoryEdgesRes.statusCode).toBe(200);
    const memoryEdgesBody = memoryEdgesRes.json<ListResponse<{ id: string; relation: string }>>();
    expect(memoryEdgesBody.data).toEqual([
      expect.objectContaining({ relation: "derived_from" }),
    ]);
  });

  it("POST /import/chat synthesizes memory scope states for .thchat files without memories", async () => {
    const file = makeMinimalThChatFile();

    const importRes = await app.inject({
      method: "POST",
      url: "/import/chat",
      payload: { data: JSON.stringify(file) },
    });

    expect(importRes.statusCode, importRes.body).toBe(201);
    const importBody = importRes.json<ChatImportResponse>();
    expect(importBody.data.memory_item_count).toBe(0);

    const sessionId = importBody.data.session_id;
    const timelineRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}/timeline` });
    expect(timelineRes.statusCode).toBe(200);
    const timelineBody = timelineRes.json<TimelineResponse>();
    const floorId = timelineBody.data.floors[0]!.id;

    const chatScopeStatesRes = await app.inject({
      method: "GET",
      url: `/memory/scopes?scope=chat&scope_id=${sessionId}&limit=10&offset=0&sort_by=updated_at&sort_order=asc`,
    });
    expect(chatScopeStatesRes.statusCode).toBe(200);
    const chatScopeStatesBody = chatScopeStatesRes.json<ListResponse<{ revision: number; last_processed_floor_no: number | null; last_compaction_at: number | null }>>();
    expect(chatScopeStatesBody.data).toEqual([
      expect.objectContaining({ revision: 0, last_processed_floor_no: 0, last_compaction_at: null }),
    ]);

    const floorScopeStatesRes = await app.inject({
      method: "GET",
      url: `/memory/scopes?scope=floor&scope_id=${floorId}&limit=10&offset=0&sort_by=updated_at&sort_order=asc`,
    });
    expect(floorScopeStatesRes.statusCode).toBe(200);
    const floorScopeStatesBody = floorScopeStatesRes.json<ListResponse<{ revision: number; last_processed_floor_no: number | null; last_compaction_at: number | null }>>();
    expect(floorScopeStatesBody.data).toEqual([
      expect.objectContaining({ revision: 0, last_processed_floor_no: 0, last_compaction_at: null }),
    ]);
  });

  it("POST /import/chat returns 400 when .thchat variables contain duplicate targets", async () => {
    const file = makeMinimalThChatFile();
    file.data.variables = [
      { scope: "chat", scope_id_ref: null, key: "dup-key", value: 1, updated_at: 1700000000100 },
      { scope: "chat", scope_id_ref: null, key: "dup-key", value: 2, updated_at: 1700000000200 },
    ];

    const res = await app.inject({
      method: "POST",
      url: "/import/chat",
      payload: {
        data: JSON.stringify(file),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe("import_parse_error");
    expect(body.error.message).toContain("Duplicate variable target");
  });

  it("POST /import/chat returns 400 for invalid .thchat schema", async () => {
    const invalidFile = makeMinimalThChatFile();
    delete invalidFile.data.floors[0]._original_id;

    const res = await app.inject({
      method: "POST",
      url: "/import/chat",
      payload: {
        data: JSON.stringify(invalidFile),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe("import_parse_error");
    expect(body.error.message).toContain("Invalid .thchat file");
  });

  it("POST /import/chat returns 400 for unsupported .thchat spec_version major", async () => {
    const unsupportedFile = makeMinimalThChatFile();
    unsupportedFile.spec_version = "2.0.0";

    const res = await app.inject({
      method: "POST",
      url: "/import/chat",
      payload: {
        data: JSON.stringify(unsupportedFile),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe("import_unsupported_version");
    expect(body.error.message).toContain("Unsupported spec_version \"2.0.0\"");
  });

  it("POST /import/chat returns 400 when .thchat character_id does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/import/chat",
      payload: {
        data: JSON.stringify(makeMinimalThChatFile()),
        character_id: "char-missing",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("character_not_found");
  });
});

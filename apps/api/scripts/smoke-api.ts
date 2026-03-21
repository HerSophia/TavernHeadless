import process from "node:process";

type SmokeOptions = {
  baseUrl: string;
  keepData: boolean;
  skipImports: boolean;
};

type JsonObject = Record<string, unknown>;

type ApiResponse<T> = {
  status: number;
  body: T | null;
};

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
  name: "Smoke World",
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

const MINIMAL_REGEX_SCRIPTS = [
  {
    id: "regex-1",
    scriptName: "Smoke Regex",
    findRegex: "hello",
    replaceString: "world",
    placement: [1, 2],
    disabled: false,
  },
];

const MINIMAL_CHARACTER_CARD = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Smoke Character",
    description: "A minimal character card for smoke testing.",
    personality: "Reliable and concise.",
    scenario: "A test scene with deterministic behavior.",
    first_mes: "Hello from smoke character.",
    mes_example: "<START>\nSmoke Character: Testing in progress.",
  },
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const api = createApiClient(options.baseUrl);
  const runId = `smoke-${Date.now().toString(36)}`;

  const cleanupTasks: Array<() => Promise<void>> = [];
  const keptResourceIds: Record<string, string[]> = {
    sessions: [],
    variables: [],
    memories: [],
    memoryEdges: [],
    presets: [],
    worldbooks: [],
    regexProfiles: [],
    characters: [],
    characterVersions: [],
  };

  let step = 0;

  async function runStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
    step += 1;
    process.stdout.write(`[${String(step).padStart(2, "0")}] ${name} ... `);
    try {
      const result = await fn();
      console.log("PASS");
      return result;
    } catch (error) {
      console.log("FAIL");
      throw error;
    }
  }

  function track(resource: keyof typeof keptResourceIds, id: string): void {
    keptResourceIds[resource].push(id);
  }

  function addCleanup(task: () => Promise<void>): void {
    cleanupTasks.unshift(task);
  }

  try {
    const health = await runStep("GET /health", () => api.request<JsonObject>("GET", "/health", undefined, [200]));
    assert(
      health.body?.ok === true,
      `Health endpoint returned unexpected payload: ${JSON.stringify(health.body)}`
    );

    const openApi = await runStep("GET /openapi.json", () =>
      api.request<JsonObject>("GET", "/openapi.json", undefined, [200])
    );
    assert(typeof openApi.body?.openapi === "string", "OpenAPI schema not returned");

    const session = await runStep("POST /sessions", () =>
      api.request<{ data: { id: string } }>("POST", "/sessions", { title: `${runId}-session` }, [201])
    );
    const sessionId = must(session.body?.data?.id, "Missing session id");
    track("sessions", sessionId);
    addCleanup(async () => {
      await api.request("DELETE", `/sessions/${sessionId}`, undefined, [200, 404]);
    });

    const disposableSession = await runStep("POST /sessions (disposable)", () =>
      api.request<{ data: { id: string } }>("POST", "/sessions", { title: `${runId}-delete-me` }, [201])
    );
    const disposableSessionId = must(disposableSession.body?.data?.id, "Missing disposable session id");
    await runStep("DELETE /sessions/:id", () =>
      api.request("DELETE", `/sessions/${disposableSessionId}`, undefined, [200])
    );
    await runStep("GET /sessions/:id (deleted => 404)", () =>
      api.request("GET", `/sessions/${disposableSessionId}`, undefined, [404])
    );

    await runStep("GET /sessions/:id", () => api.request("GET", `/sessions/${sessionId}`, undefined, [200]));
    await runStep("PATCH /sessions/:id", () =>
      api.request(
        "PATCH",
        `/sessions/${sessionId}`,
        { metadata: { smoke: runId }, prompt_mode: "compat_strict" },
        [200]
      )
    );
    await runStep("GET /sessions list", () =>
      api.request("GET", "/sessions?limit=5&offset=0&sort_by=updated_at&sort_order=desc", undefined, [200])
    );

    await runStep("POST /sessions/:id/character/sync (no binding => 409)", () =>
      api.request("POST", `/sessions/${sessionId}/character/sync`, undefined, [409])
    );

    const timelineEmpty = await runStep("GET /sessions/:id/timeline (empty)", () =>
      api.request<{ data: { floors: unknown[] } }>("GET", `/sessions/${sessionId}/timeline`, undefined, [200])
    );
    assert(Array.isArray(timelineEmpty.body?.data?.floors), "Timeline floors is not an array");

    const floor = await runStep("POST /floors (committed)", () =>
      api.request<{ data: { id: string } }>(
        "POST",
        "/floors",
        {
          session_id: sessionId,
          floor_no: 0,
          branch_id: "main",
          state: "committed",
        },
        [201]
      )
    );
    const floorId = must(floor.body?.data?.id, "Missing floor id");

    await runStep("GET /floors/:id", () => api.request("GET", `/floors/${floorId}`, undefined, [200]));
    await runStep("PATCH /floors/:id", () =>
      api.request("PATCH", `/floors/${floorId}`, { token_in: 7, token_out: 11 }, [200])
    );
    await runStep("GET /floors list", () =>
      api.request("GET", `/floors?session_id=${encodeURIComponent(sessionId)}&sort_by=floor_no&sort_order=asc`, undefined, [200])
    );

    const disposableFloor = await runStep("POST /floors (disposable)", () =>
      api.request<{ data: { id: string } }>(
        "POST",
        "/floors",
        {
          session_id: sessionId,
          floor_no: 99,
          branch_id: "main",
          state: "draft",
        },
        [201]
      )
    );
    const disposableFloorId = must(disposableFloor.body?.data?.id, "Missing disposable floor id");
    await runStep("DELETE /floors/:id", () => api.request("DELETE", `/floors/${disposableFloorId}`, undefined, [200]));

    const pageV1 = await runStep("POST /pages (active v1)", () =>
      api.request<{ data: { id: string } }>(
        "POST",
        "/pages",
        {
          floor_id: floorId,
          page_no: 0,
          page_kind: "output",
          is_active: true,
          version: 1,
        },
        [201]
      )
    );
    const pageV1Id = must(pageV1.body?.data?.id, "Missing page v1 id");

    const msgV1 = await runStep("POST /messages (v1)", () =>
      api.request<{ data: { id: string } }>(
        "POST",
        "/messages",
        {
          page_id: pageV1Id,
          seq: 0,
          role: "assistant",
          content: `${runId}-v1`,
        },
        [201]
      )
    );
    const msgV1Id = must(msgV1.body?.data?.id, "Missing message v1 id");

    const pageV2 = await runStep("POST /pages (inactive v2)", () =>
      api.request<{ data: { id: string } }>(
        "POST",
        "/pages",
        {
          floor_id: floorId,
          page_no: 0,
          page_kind: "output",
          is_active: false,
          version: 2,
        },
        [201]
      )
    );
    const pageV2Id = must(pageV2.body?.data?.id, "Missing page v2 id");

    const msgV2 = await runStep("POST /messages (v2)", () =>
      api.request<{ data: { id: string } }>(
        "POST",
        "/messages",
        {
          page_id: pageV2Id,
          seq: 0,
          role: "assistant",
          content: `${runId}-v2`,
        },
        [201]
      )
    );
    const msgV2Id = must(msgV2.body?.data?.id, "Missing message v2 id");

    await runStep("GET /messages", () =>
      api.request("GET", `/messages?page_id=${encodeURIComponent(pageV2Id)}&sort_by=seq&sort_order=asc`, undefined, [200])
    );
    await runStep("GET /messages/:id", () => api.request("GET", `/messages/${msgV2Id}`, undefined, [200]));
    await runStep("PATCH /messages/:id", () =>
      api.request("PATCH", `/messages/${msgV2Id}`, { content: `${runId}-v2-edited` }, [200])
    );

    const disposableMessage = await runStep("POST /messages (disposable)", () =>
      api.request<{ data: { id: string } }>(
        "POST",
        "/messages",
        {
          page_id: pageV2Id,
          seq: 1,
          role: "assistant",
          content: `${runId}-temp-message`,
        },
        [201]
      )
    );
    const disposableMessageId = must(disposableMessage.body?.data?.id, "Missing disposable message id");
    await runStep("DELETE /messages/:id", () =>
      api.request("DELETE", `/messages/${disposableMessageId}`, undefined, [200])
    );

    await runStep("GET /pages", () =>
      api.request("GET", `/pages?floor_id=${encodeURIComponent(floorId)}&sort_by=version&sort_order=asc`, undefined, [200])
    );
    await runStep("GET /pages/:id", () => api.request("GET", `/pages/${pageV1Id}`, undefined, [200]));
    await runStep("PATCH /pages/:id", () =>
      api.request("PATCH", `/pages/${pageV2Id}`, { checksum: `${runId}-checksum` }, [200])
    );

    const timeline = await runStep("GET /sessions/:id/timeline (with data)", () =>
      api.request<{ data: { floors: Array<{ page_count: number; active_page: { id: string } | null }> } }>(
        "GET",
        `/sessions/${sessionId}/timeline`,
        undefined,
        [200]
      )
    );
    const firstFloor = timeline.body?.data?.floors?.[0];
    assert(firstFloor?.page_count === 2, "Timeline page_count should be 2");
    assert(firstFloor?.active_page?.id === pageV1Id, "Initial active page should be v1");

    await runStep("PATCH /pages/:id/activate", () =>
      api.request("PATCH", `/pages/${pageV2Id}/activate`, undefined, [200])
    );

    const pageV1After = await runStep("GET /pages/:id (v1 inactive)", () =>
      api.request<{ data: { is_active: boolean } }>("GET", `/pages/${pageV1Id}`, undefined, [200])
    );
    assert(pageV1After.body?.data?.is_active === false, "v1 should be inactive after activate");

    const pageV2After = await runStep("GET /pages/:id (v2 active)", () =>
      api.request<{ data: { is_active: boolean } }>("GET", `/pages/${pageV2Id}`, undefined, [200])
    );
    assert(pageV2After.body?.data?.is_active === true, "v2 should be active after activate");

    const disposablePage = await runStep("POST /pages (disposable)", () =>
      api.request<{ data: { id: string } }>(
        "POST",
        "/pages",
        {
          floor_id: floorId,
          page_no: 1,
          page_kind: "mixed",
          is_active: false,
          version: 1,
        },
        [201]
      )
    );
    const disposablePageId = must(disposablePage.body?.data?.id, "Missing disposable page id");
    await runStep("DELETE /pages/:id", () => api.request("DELETE", `/pages/${disposablePageId}`, undefined, [200]));

    await runStep("POST /floors/:id/branch (auto)", () =>
      api.request("POST", `/floors/${floorId}/branch`, {}, [201])
    );

    const customBranchId = `${runId}-branch`;
    await runStep("POST /floors/:id/branch (custom)", () =>
      api.request("POST", `/floors/${floorId}/branch`, { branch_id: customBranchId }, [201])
    );

    await runStep("POST /floors/:id/branch (duplicate => 409)", () =>
      api.request("POST", `/floors/${floorId}/branch`, { branch_id: "main" }, [409])
    );

    await runStep("POST /floors (custom branch floor)", () =>
      api.request(
        "POST",
        "/floors",
        {
          session_id: sessionId,
          floor_no: 1,
          branch_id: customBranchId,
          parent_floor_id: floorId,
          state: "committed",
        },
        [201]
      )
    );

    const branches = await runStep("GET /sessions/:id/branches", () =>
      api.request<{ data: Array<{ branch_id: string }> }>(
        "GET",
        `/sessions/${sessionId}/branches?sort_by=branch_id&sort_order=asc`,
        undefined,
        [200]
      )
    );
    assert(
      branches.body?.data?.some((branch) => branch.branch_id === customBranchId) ?? false,
      "Custom branch should appear in branches list"
    );

    await runStep("GET /sessions/:id/branches/diff", () =>
      api.request(
        "GET",
        `/sessions/${sessionId}/branches/diff?base_branch_id=main&target_branch_id=${encodeURIComponent(customBranchId)}`,
        undefined,
        [200]
      )
    );

    await runStep("GET /sessions/:id/timeline (custom branch)", () =>
      api.request("GET", `/sessions/${sessionId}/timeline?branch_id=${encodeURIComponent(customBranchId)}`, undefined, [200])
    );

    await runStep("DELETE /branches/main (protected => 409)", () =>
      api.request("DELETE", "/branches/main", undefined, [409])
    );

    await runStep("DELETE /branches/:id", () =>
      api.request("DELETE", `/branches/${customBranchId}?session_id=${encodeURIComponent(sessionId)}`, undefined, [200])
    );

    const branchesAfterDelete = await runStep("GET /sessions/:id/branches (after delete)", () =>
      api.request<{ data: Array<{ branch_id: string }> }>("GET", `/sessions/${sessionId}/branches`, undefined, [200])
    );
    assert(
      !branchesAfterDelete.body?.data?.some((branch) => branch.branch_id === customBranchId),
      "Custom branch should be removed"
    );

    const variable = await runStep("PUT /variables (create)", () =>
      api.request<{ data: { id: string } }>(
        "PUT",
        "/variables",
        {
          scope: "chat",
          scope_id: sessionId,
          key: `${runId}.mood`,
          value: "happy",
        },
        [201]
      )
    );
    const variableId = must(variable.body?.data?.id, "Missing variable id");
    track("variables", variableId);
    addCleanup(async () => {
      await api.request("DELETE", `/variables/${variableId}`, undefined, [200, 404]);
    });

    await runStep("PUT /variables (update)", () =>
      api.request(
        "PUT",
        "/variables",
        {
          scope: "chat",
          scope_id: sessionId,
          key: `${runId}.mood`,
          value: "excited",
        },
        [200]
      )
    );
    await runStep("GET /variables", () =>
      api.request("GET", `/variables?scope=chat&scope_id=${encodeURIComponent(sessionId)}`, undefined, [200])
    );
    await runStep("GET /variables/:id", () => api.request("GET", `/variables/${variableId}`, undefined, [200]));

    if (!options.keepData) {
      await runStep("DELETE /variables/:id", () =>
        api.request("DELETE", `/variables/${variableId}`, undefined, [200])
      );
    }

    const memoryA = await runStep("POST /memories (A)", () =>
      api.request<{ data: { id: string } }>(
        "POST",
        "/memories",
        {
          scope: "chat",
          scope_id: sessionId,
          type: "fact",
          content: { text: `${runId}-memory-a` },
          source_floor_id: floorId,
          status: "active",
        },
        [201]
      )
    );
    const memoryAId = must(memoryA.body?.data?.id, "Missing memory A id");
    track("memories", memoryAId);
    addCleanup(async () => {
      await api.request("DELETE", `/memories/${memoryAId}`, undefined, [200, 404]);
    });

    const memoryB = await runStep("POST /memories (B)", () =>
      api.request<{ data: { id: string } }>(
        "POST",
        "/memories",
        {
          scope: "chat",
          scope_id: sessionId,
          type: "summary",
          content: { text: `${runId}-memory-b` },
          status: "deprecated",
        },
        [201]
      )
    );
    const memoryBId = must(memoryB.body?.data?.id, "Missing memory B id");
    track("memories", memoryBId);
    addCleanup(async () => {
      await api.request("DELETE", `/memories/${memoryBId}`, undefined, [200, 404]);
    });

    await runStep("PATCH /memories/:id", () =>
      api.request("PATCH", `/memories/${memoryAId}`, { confidence: 0.8 }, [200])
    );
    await runStep("GET /memories", () =>
      api.request(
        "GET",
        `/memories?scope=chat&scope_id=${encodeURIComponent(sessionId)}&type=fact&status=active&source_floor_id=${encodeURIComponent(floorId)}&q=${encodeURIComponent(runId)}&limit=10&offset=0&sort_by=created_at&sort_order=desc`,
        undefined,
        [200]
      )
    );
    await runStep("GET /memories/:id", () => api.request("GET", `/memories/${memoryAId}`, undefined, [200]));
    await runStep("GET /memories/stats", () =>
      api.request("GET", `/memories/stats?scope=chat&scope_id=${encodeURIComponent(sessionId)}`, undefined, [200])
    );

    const edge = await runStep("POST /memory-edges", () =>
      api.request<{ data: { id: string } }>(
        "POST",
        "/memory-edges",
        {
          from_id: memoryAId,
          to_id: memoryBId,
          relation: "supports",
        },
        [201]
      )
    );
    const edgeId = must(edge.body?.data?.id, "Missing memory edge id");
    track("memoryEdges", edgeId);
    addCleanup(async () => {
      await api.request("DELETE", `/memory-edges/${edgeId}`, undefined, [200, 404]);
    });

    await runStep("GET /memory-edges", () =>
      api.request("GET", `/memory-edges?from_id=${encodeURIComponent(memoryAId)}`, undefined, [200])
    );
    await runStep("GET /memory-edges/:id", () => api.request("GET", `/memory-edges/${edgeId}`, undefined, [200]));

    if (!options.keepData) {
      await runStep("DELETE /memory-edges/:id", () =>
        api.request("DELETE", `/memory-edges/${edgeId}`, undefined, [200])
      );
      await runStep("DELETE /memories/:id (A)", () =>
        api.request("DELETE", `/memories/${memoryAId}`, undefined, [200])
      );
      await runStep("DELETE /memories/:id (B)", () =>
        api.request("DELETE", `/memories/${memoryBId}`, undefined, [200])
      );
    }

    if (!options.skipImports) {
      const preset = await runStep("POST /import/preset", () =>
        api.request<{ data: { id: string } }>(
          "POST",
          "/import/preset",
          {
            name: `${runId}-preset`,
            data: MINIMAL_PRESET,
          },
          [201]
        )
      );
      const presetId = must(preset.body?.data?.id, "Missing preset id");
      track("presets", presetId);
      addCleanup(async () => {
        await api.request("DELETE", `/presets/${presetId}`, undefined, [204, 404]);
      });

      await runStep("GET /presets", () => api.request("GET", "/presets", undefined, [200]));
      await runStep("GET /presets/:id", () => api.request("GET", `/presets/${presetId}`, undefined, [200]));
      if (!options.keepData) {
        await runStep("DELETE /presets/:id", () => api.request("DELETE", `/presets/${presetId}`, undefined, [204]));
      }

      const worldbook = await runStep("POST /import/worldbook", () =>
        api.request<{ data: { id: string } }>(
          "POST",
          "/import/worldbook",
          {
            name: `${runId}-worldbook`,
            data: MINIMAL_WORLDBOOK,
          },
          [201]
        )
      );
      const worldbookId = must(worldbook.body?.data?.id, "Missing worldbook id");
      track("worldbooks", worldbookId);
      addCleanup(async () => {
        await api.request("DELETE", `/worldbooks/${worldbookId}`, undefined, [204, 404]);
      });

      await runStep("GET /worldbooks", () => api.request("GET", "/worldbooks", undefined, [200]));
      await runStep("GET /worldbooks/:id", () => api.request("GET", `/worldbooks/${worldbookId}`, undefined, [200]));
      if (!options.keepData) {
        await runStep("DELETE /worldbooks/:id", () =>
          api.request("DELETE", `/worldbooks/${worldbookId}`, undefined, [204])
        );
      }

      const regex = await runStep("POST /import/regex", () =>
        api.request<{ data: { id: string } }>(
          "POST",
          "/import/regex",
          {
            name: `${runId}-regex`,
            data: MINIMAL_REGEX_SCRIPTS,
          },
          [201]
        )
      );
      const regexId = must(regex.body?.data?.id, "Missing regex profile id");
      track("regexProfiles", regexId);
      addCleanup(async () => {
        await api.request("DELETE", `/regex-profiles/${regexId}`, undefined, [204, 404]);
      });

      await runStep("GET /regex-profiles", () => api.request("GET", "/regex-profiles", undefined, [200]));
      await runStep("GET /regex-profiles/:id", () =>
        api.request("GET", `/regex-profiles/${regexId}`, undefined, [200])
      );
      if (!options.keepData) {
        await runStep("DELETE /regex-profiles/:id", () =>
          api.request("DELETE", `/regex-profiles/${regexId}`, undefined, [204])
        );
      }

      const importedCharacter = await runStep("POST /import/character (create_session=false)", () =>
        api.request<{ data: { character_id: string; character_version_id: string } }>(
          "POST",
          "/import/character",
          {
            payload: MINIMAL_CHARACTER_CARD,
            create_session: false,
          },
          [201]
        )
      );
      const characterId = must(importedCharacter.body?.data?.character_id, "Missing character id");
      const characterVersionId = must(
        importedCharacter.body?.data?.character_version_id,
        "Missing character version id"
      );
      track("characters", characterId);
      track("characterVersions", characterVersionId);
      addCleanup(async () => {
        await api.request("DELETE", `/characters/${characterId}`, undefined, [200, 404]);
      });

      const characterBoundSession = await runStep("POST /sessions (character-bound manual)", () =>
        api.request<{ data: { id: string } }>(
          "POST",
          "/sessions",
          {
            title: `${runId}-character-session`,
            character_id: characterId,
            character_version_id: characterVersionId,
            character_sync_policy: "manual",
          },
          [201]
        )
      );
      const characterSessionId = must(characterBoundSession.body?.data?.id, "Missing character session id");
      track("sessions", characterSessionId);
      addCleanup(async () => {
        await api.request("DELETE", `/sessions/${characterSessionId}`, undefined, [200, 404]);
      });

      await runStep("POST /sessions/:id/character/sync (manual)", () =>
        api.request("POST", `/sessions/${characterSessionId}/character/sync`, undefined, [200])
      );
      await runStep("PATCH /sessions/:id (sync_policy=pin)", () =>
        api.request("PATCH", `/sessions/${characterSessionId}`, { character_sync_policy: "pin" }, [200])
      );
      await runStep("POST /sessions/:id/character/sync (pin => 409)", () =>
        api.request("POST", `/sessions/${characterSessionId}/character/sync`, undefined, [409])
      );
      await runStep("POST /sessions/:id/character/sync (force=true)", () =>
        api.request("POST", `/sessions/${characterSessionId}/character/sync`, { force: true }, [200])
      );

      const importedCharacterWithSession = await runStep("POST /import/character (default create_session)", () =>
        api.request<{ data: { session: { id: string } } }>(
          "POST",
          "/import/character",
          {
            payload: MINIMAL_CHARACTER_CARD,
          },
          [201]
        )
      );
      const importedSessionId = must(
        importedCharacterWithSession.body?.data?.session?.id,
        "Missing imported session id"
      );
      track("sessions", importedSessionId);
      addCleanup(async () => {
        await api.request("DELETE", `/sessions/${importedSessionId}`, undefined, [200, 404]);
      });

      const importedSessionDetail = await runStep("GET /sessions/:id (imported binding)", () =>
        api.request<{
          data: { character_binding: { character_id: string | null; character_version_id: string | null } | null };
        }>("GET", `/sessions/${importedSessionId}`, undefined, [200])
      );
      const importedCharacterId = importedSessionDetail.body?.data?.character_binding?.character_id;
      const importedCharacterVersionId = importedSessionDetail.body?.data?.character_binding?.character_version_id;
      if (typeof importedCharacterId === "string") {
        track("characters", importedCharacterId);
        addCleanup(async () => {
          await api.request("DELETE", `/characters/${importedCharacterId}`, undefined, [200, 404]);
        });
      }
      if (typeof importedCharacterVersionId === "string") {
        track("characterVersions", importedCharacterVersionId);
      }
    }

    await runStep("GET /messages?limit=0 (validation => 400)", () =>
      api.request("GET", "/messages?limit=0", undefined, [400])
    );

    console.log("\nSmoke test completed successfully.");
    console.log(`Base URL: ${options.baseUrl}`);

    if (options.keepData) {
      console.log("Created resources were kept (--keep-data):");
      for (const [resource, ids] of Object.entries(keptResourceIds)) {
        if (ids.length > 0) {
          console.log(`- ${resource}: ${ids.join(", ")}`);
        }
      }
    }
  } finally {
    if (!options.keepData) {
      for (const task of cleanupTasks) {
        try {
          await task();
        } catch {
          // Best effort cleanup.
        }
      }
    }
  }
}

function createApiClient(baseUrl: string) {
  const normalizedBase = baseUrl.replace(/\/$/, "");

  async function request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    expectedStatuses: number[] = [200]
  ): Promise<ApiResponse<T>> {
    const url = `${normalizedBase}${path}`;
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const parsedBody = text.length === 0 ? null : safeParseJson(text);

    if (!expectedStatuses.includes(response.status)) {
      throw new Error(
        `${method} ${path} expected [${expectedStatuses.join(", ")}], got ${response.status}. Response: ${truncate(
          text,
          400
        )}`
      );
    }

    return {
      status: response.status,
      body: parsedBody as T | null,
    };
  }

  return { request };
}

function parseArgs(args: string[]): SmokeOptions {
  const defaultPort = process.env.PORT ?? "3000";
  const parsed: SmokeOptions = {
    baseUrl: process.env.API_BASE_URL ?? `http://127.0.0.1:${defaultPort}`,
    keepData: false,
    skipImports: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=");
    const nextValue = inlineValue ?? args[i + 1];
    const consumeNext = inlineValue === undefined;

    switch (key) {
      case "base-url": {
        if (!nextValue) {
          throw new Error("Missing value for --base-url");
        }
        parsed.baseUrl = nextValue;
        break;
      }
      case "keep-data": {
        parsed.keepData = true;
        break;
      }
      case "skip-imports": {
        parsed.skipImports = true;
        break;
      }
      case "help": {
        printUsage();
        process.exit(0);
        break;
      }
      default:
        throw new Error(`Unknown option: --${key}`);
    }

    if (consumeNext && key === "base-url") {
      i += 1;
    }
  }

  return parsed;
}

function printUsage(): void {
  console.log("Usage: pnpm --filter @tavern/api smoke -- [options]");
  console.log("Options:");
  console.log("  --base-url <url>  API base URL (default: API_BASE_URL or http://127.0.0.1:3000)");
  console.log("  --keep-data       Keep created resources (default: cleanup enabled)");
  console.log("  --skip-imports    Skip import routes smoke tests");
  console.log("  --help            Show this help message");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function must<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

main().catch((error) => {
  console.error("\nSmoke test failed.");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});

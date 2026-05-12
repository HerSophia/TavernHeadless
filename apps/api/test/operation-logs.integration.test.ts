import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { buildApp } from "../src/app.js";
import type { DatabaseConnection } from "../src/db/client.js";
import { characterVersions, floors } from "../src/db/schema.js";
import { OperationLogService } from "../src/services/operation-log-service.js";

type Data<T> = { data: T };

type OperationLogResponse = {
  id: string;
  action: string;
  account_id: string;
  actor_type: string;
  after_ref: Record<string, unknown> | null;
  before_ref: Record<string, unknown> | null;
  diff: { total_changes: number; changes: Array<{ path: string; redacted?: boolean }> } | null;
  metadata: Record<string, unknown> | null;
  session_id: string | null;
  floor_id: string | null;
  target_id: string | null;
  target_type: string;
};

const CLIENT_DATA_CONFIG = {
  expirationIntervalMs: 300_000,
  domainPurgeGracePeriodMs: 604_800_000,
  defaultMaxItemSizeBytes: 1_048_576,
  defaultQuotaMaxEntries: 10_000,
  defaultQuotaMaxBytes: 10_485_760,
  maxDomainsPerAccount: 64,
  maxTotalEntriesPerAccount: 100_000,
  maxTotalBytesPerAccount: 104_857_600,
};

const MINIMAL_PRESET = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "SECRET_PRESET_CONTENT",
    },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [{ identifier: "main", enabled: true }],
    },
  ],
  temperature: 0.8,
};

const MINIMAL_WORLDBOOK = {
  name: "Operation Log Worldbook",
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
    scriptName: "Test Regex",
    findRegex: "hello",
    replaceString: "world",
    placement: [1, 2],
    disabled: false,
  },
];

describe("operation log routes", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection["db"];

  beforeEach(async () => {
    ({ app, database } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      enableClientData: true,
      clientData: CLIENT_DATA_CONFIG,
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  it("lists session operation logs created by session write routes", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        title: "Operation Log Session",
        model_params: { apiKey: "secret-value" },
      },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const sessionId = createResponse.json<Data<{ id: string }>>().data.id;

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}`,
      payload: { title: "Operation Log Session Updated" },
    });
    expect(patchResponse.statusCode, patchResponse.body).toBe(200);

    new OperationLogService(database).append({
      id: "foreign-log",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      actorType: "system",
      sourceType: "system",
      action: "system_checkpoint",
      status: "succeeded",
      targetType: "system",
      targetId: "system-1",
      createdAt: 300,
    });

    const listResponse = await app.inject({
      method: "GET",
      url: `/operation-logs?target_type=session&target_id=${sessionId}&sort_order=asc`,
    });
    expect(listResponse.statusCode, listResponse.body).toBe(200);
    const body = listResponse.json<{ data: OperationLogResponse[]; meta: Record<string, unknown> }>();

    expect(body.data.map((log) => log.action).sort()).toEqual(["create_session", "update_session"]);
    expect(body.data.every((log) => log.account_id === DEFAULT_ADMIN_ACCOUNT_ID)).toBe(true);
    const createLog = body.data.find((log) => log.action === "create_session");
    const updateLog = body.data.find((log) => log.action === "update_session");
    expect(createLog?.after_ref?.session_id).toBe(sessionId);
    expect(updateLog?.before_ref?.session_id).toBe(sessionId);
    expect(updateLog?.diff?.total_changes).toBeGreaterThan(0);
    expect(updateLog?.metadata?.route).toBe("PATCH /sessions/:id");
    expect(JSON.stringify(body.data)).not.toContain("secret-value");
    expect(body.meta.sort_by).toBe("created_at");
  });

  it("lists logs through session and floor scoped endpoints", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Scoped Logs" },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const sessionId = createResponse.json<Data<{ id: string }>>().data.id;
    const now = Date.now();
    const floorId = "floor-for-operation-log";

    await database.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      state: "committed",
      createdAt: now,
      updatedAt: now,
    });

    new OperationLogService(database).append({
      id: "floor-log-1",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      actorType: "llm",
      actorId: "run-1",
      sourceType: "llm_run",
      action: "commit_floor",
      status: "succeeded",
      sessionId,
      branchId: "main",
      floorId,
      runId: "run-1",
      targetType: "floor",
      targetId: floorId,
      metadata: { tool_execution_count: 0 },
      createdAt: now + 1,
    });

    const sessionLogsResponse = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/operation-logs?action=commit_floor`,
    });
    expect(sessionLogsResponse.statusCode, sessionLogsResponse.body).toBe(200);
    const sessionLogs = sessionLogsResponse.json<{ data: OperationLogResponse[] }>().data;
    expect(sessionLogs).toHaveLength(1);
    expect(sessionLogs[0]!.floor_id).toBe(floorId);

    const floorLogsResponse = await app.inject({
      method: "GET",
      url: `/floors/${floorId}/operation-logs?run_id=run-1`,
    });
    expect(floorLogsResponse.statusCode, floorLogsResponse.body).toBe(200);
    const floorLogs = floorLogsResponse.json<{ data: OperationLogResponse[] }>().data;
    expect(floorLogs).toHaveLength(1);
    expect(floorLogs[0]!.id).toBe("floor-log-1");

    const missingFloorResponse = await app.inject({
      method: "GET",
      url: "/floors/missing-floor/operation-logs",
    });
    expect(missingFloorResponse.statusCode).toBe(404);
  });

  it("records prompt asset write logs without storing full asset content", async () => {
    const presetImportResponse = await app.inject({
      method: "POST",
      url: "/import/preset",
      payload: {
        name: "Operation Log Preset",
        data: MINIMAL_PRESET,
      },
    });
    expect(presetImportResponse.statusCode, presetImportResponse.body).toBe(201);
    const presetId = presetImportResponse.json<Data<{ id: string }>>().data.id;

    const presetEditorResponse = await app.inject({
      method: "GET",
      url: `/presets/${presetId}/editor`,
    });
    expect(presetEditorResponse.statusCode, presetEditorResponse.body).toBe(200);
    const presetEditorBody = presetEditorResponse.json<{
      data: {
        version: number;
        editor: Record<string, unknown>;
      };
    }>();

    const presetUpdateResponse = await app.inject({
      method: "PUT",
      url: `/presets/${presetId}`,
      payload: {
        name: "Operation Log Preset Updated",
        expected_version: presetEditorBody.data.version,
        editor: presetEditorBody.data.editor,
      },
    });
    expect(presetUpdateResponse.statusCode, presetUpdateResponse.body).toBe(200);

    const presetLogsResponse = await app.inject({
      method: "GET",
      url: `/operation-logs?target_type=preset&target_id=${presetId}&sort_order=asc`,
    });
    expect(presetLogsResponse.statusCode, presetLogsResponse.body).toBe(200);
    const presetLogs = presetLogsResponse.json<{ data: OperationLogResponse[] }>().data;
    expect(presetLogs.map((log) => log.action)).toEqual(["import_preset", "update_preset"]);
    expect(JSON.stringify(presetLogs)).not.toContain("SECRET_PRESET_CONTENT");
    expect(presetLogs[0]!.after_ref?.created_by_operation_id).toBe(presetLogs[0]!.id);
    expect(presetLogs[1]!.after_ref?.created_by_operation_id).toBe(presetLogs[1]!.id);
    expect(presetLogs[1]!.after_ref?.version).toBe(2);
    expect(presetLogs[1]!.metadata?.route).toBe("PUT /presets/:id");

    const worldbookImportResponse = await app.inject({
      method: "POST",
      url: "/import/worldbook",
      payload: {
        name: "Operation Log Worldbook",
        data: MINIMAL_WORLDBOOK,
      },
    });
    expect(worldbookImportResponse.statusCode, worldbookImportResponse.body).toBe(201);
    const worldbookId = worldbookImportResponse.json<Data<{ id: string }>>().data.id;

    const worldbookEntryResponse = await app.inject({
      method: "POST",
      url: `/worldbooks/${worldbookId}/entries`,
      payload: {
        keys: ["secret"],
        content: "SECRET_WORLDBOOK_CONTENT",
        comment: "Secret entry",
      },
    });
    expect(worldbookEntryResponse.statusCode, worldbookEntryResponse.body).toBe(201);

    const worldbookLogsResponse = await app.inject({
      method: "GET",
      url: `/operation-logs?target_type=worldbook&target_id=${worldbookId}&action=create_worldbook_entry`,
    });
    expect(worldbookLogsResponse.statusCode, worldbookLogsResponse.body).toBe(200);
    const worldbookLogs = worldbookLogsResponse.json<{ data: OperationLogResponse[] }>().data;
    expect(worldbookLogs).toHaveLength(1);
    expect(JSON.stringify(worldbookLogs)).not.toContain("SECRET_WORLDBOOK_CONTENT");
    expect(worldbookLogs[0]!.after_ref?.created_by_operation_id).toBe(worldbookLogs[0]!.id);
    expect(worldbookLogs[0]!.metadata?.route).toBe("POST /worldbooks/:worldbook_id/entries");

    const regexImportResponse = await app.inject({
      method: "POST",
      url: "/import/regex",
      payload: {
        name: "Operation Log Regex",
        data: MINIMAL_REGEX_SCRIPTS,
      },
    });
    expect(regexImportResponse.statusCode, regexImportResponse.body).toBe(201);
    const regexProfileId = regexImportResponse.json<Data<{ id: string }>>().data.id;

    const regexDetailResponse = await app.inject({
      method: "GET",
      url: `/regex-profiles/${regexProfileId}`,
    });
    expect(regexDetailResponse.statusCode, regexDetailResponse.body).toBe(200);
    const regexDetail = regexDetailResponse.json<{ data: { version: number } }>();

    const regexUpdateResponse = await app.inject({
      method: "PUT",
      url: `/regex-profiles/${regexProfileId}`,
      payload: {
        name: "Operation Log Regex Updated",
        expected_version: regexDetail.data.version,
        data: [
          {
            id: "regex-1",
            scriptName: "Updated Regex",
            findRegex: "hello",
            replaceString: "SECRET_REGEX_REPLACE",
            placement: [1, 2],
            disabled: false,
          },
        ],
      },
    });
    expect(regexUpdateResponse.statusCode, regexUpdateResponse.body).toBe(200);

    const regexLogsResponse = await app.inject({
      method: "GET",
      url: `/operation-logs?target_type=regex_profile&target_id=${regexProfileId}&action=update_regex_profile`,
    });
    expect(regexLogsResponse.statusCode, regexLogsResponse.body).toBe(200);
    const regexLogs = regexLogsResponse.json<{ data: OperationLogResponse[] }>().data;
    expect(regexLogs).toHaveLength(1);
    expect(JSON.stringify(regexLogs)).not.toContain("SECRET_REGEX_REPLACE");
    expect(regexLogs[0]!.after_ref?.created_by_operation_id).toBe(regexLogs[0]!.id);
    expect(regexLogs[0]!.metadata?.route).toBe("PUT /regex-profiles/:id");
  });

  it("records prompt runtime policy logs without storing prompt text or floor id lists", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Prompt Runtime Policy Logs" },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const sessionId = createResponse.json<Data<{ id: string }>>().data.id;

    const sessionPolicyResponse = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}/prompt-runtime/policy`,
      payload: {
        delivery: { no_assistant: true },
        budget: { max_input_tokens: 4096 },
        visibility: {
          mode: "allow_all_except_hidden",
          hidden_floor_ids: ["SECRET_POLICY_FLOOR_ID"],
        },
      },
    });
    expect(sessionPolicyResponse.statusCode, sessionPolicyResponse.body).toBe(200);

    const now = Date.now();
    await database.insert(floors).values({
      id: "prompt-runtime-policy-branch-floor",
      sessionId,
      floorNo: 77,
      branchId: "policy-branch",
      state: "committed",
      createdAt: now,
      updatedAt: now,
    });

    const branchPolicyResponse = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}/prompt-runtime/branches/policy-branch/policy`,
      payload: {
        source_selection: {
          history: { mode: "windowed", max_messages: 8 },
          memory: { enabled: false },
        },
        visibility: {
          mode: "allow_all_except_hidden",
          hidden_floor_ids: ["SECRET_BRANCH_POLICY_FLOOR_ID"],
        },
      },
    });
    expect(branchPolicyResponse.statusCode, branchPolicyResponse.body).toBe(200);

    const logsResponse = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/operation-logs?target_type=prompt_runtime_policy&sort_order=asc`,
    });
    expect(logsResponse.statusCode, logsResponse.body).toBe(200);
    const logs = logsResponse.json<{ data: OperationLogResponse[] }>().data;
    expect(logs.map((log) => log.action)).toEqual([
      "update_prompt_runtime_policy",
      "update_prompt_runtime_branch_policy",
    ]);

    const sessionLog = logs.find((log) => log.action === "update_prompt_runtime_policy");
    const branchLog = logs.find((log) => log.action === "update_prompt_runtime_branch_policy");
    expect(sessionLog?.target_id).toBe(sessionId);
    expect(sessionLog?.after_ref?.policy_scope).toBe("session");
    expect(sessionLog?.after_ref?.policy_version).toBe(1);
    expect(sessionLog?.metadata?.route).toBe("PATCH /sessions/:id/prompt-runtime/policy");
    expect(sessionLog?.metadata?.request_fields).toEqual(["budget", "delivery", "visibility"]);
    expect(sessionLog?.diff?.total_changes).toBeGreaterThan(0);

    const sessionVisibility = sessionLog?.after_ref?.visibility as Record<string, unknown> | undefined;
    expect(sessionVisibility?.hidden_floor_id_count).toBe(1);
    expect(sessionVisibility?.hidden_floor_ids_hash).toEqual(expect.stringMatching(/^sha256:/));

    expect(branchLog?.target_id).toBe(`${sessionId}:policy-branch`);
    expect(branchLog?.after_ref?.policy_scope).toBe("branch");
    expect(branchLog?.after_ref?.branch_id).toBe("policy-branch");
    expect(branchLog?.metadata?.route).toBe("PATCH /sessions/:id/prompt-runtime/branches/:branchId/policy");
    expect(branchLog?.metadata?.branch_materialized).toBe(true);
    expect(branchLog?.diff?.total_changes).toBeGreaterThan(0);

    expect(JSON.stringify(logs)).not.toContain("SECRET_POLICY_FLOOR_ID");
    expect(JSON.stringify(logs)).not.toContain("SECRET_BRANCH_POLICY_FLOOR_ID");
  });

  it("records session state namespace and direct value logs without storing full values", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Session State Operation Logs" },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const sessionId = createResponse.json<Data<{ id: string }>>().data.id;

    const registerResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/state/namespaces`,
      payload: {
        namespace: "quest_flags",
        logical_owner_type: "plugin",
        logical_owner_id: "quest-plugin",
      },
    });
    expect(registerResponse.statusCode, registerResponse.body).toBe(201);

    const writeResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/state/values/write`,
      payload: {
        branch_id: "main",
        namespace: "quest_flags",
        slot: "companion",
        value: {
          secret: "SECRET_STATE_VALUE",
          mood: "ally",
        },
      },
    });
    expect(writeResponse.statusCode, writeResponse.body).toBe(200);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/sessions/${sessionId}/state/values`,
      payload: {
        branch_id: "main",
        namespace: "quest_flags",
        slot: "companion",
      },
    });
    expect(deleteResponse.statusCode, deleteResponse.body).toBe(200);

    const namespaceLogsResponse = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/operation-logs?target_type=session_state_namespace&sort_order=asc`,
    });
    expect(namespaceLogsResponse.statusCode, namespaceLogsResponse.body).toBe(200);
    const namespaceLogs = namespaceLogsResponse.json<{ data: OperationLogResponse[] }>().data;
    expect(namespaceLogs.map((log) => log.action)).toEqual(["register_session_state_namespace"]);
    expect(namespaceLogs[0]!.after_ref?.namespace).toBe("quest_flags");
    expect(namespaceLogs[0]!.metadata?.route).toBe("POST /sessions/:sessionId/state/namespaces");

    const valueLogsResponse = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/operation-logs?target_type=session_state_value&sort_order=asc`,
    });
    expect(valueLogsResponse.statusCode, valueLogsResponse.body).toBe(200);
    const valueLogs = valueLogsResponse.json<{ data: OperationLogResponse[] }>().data;
    expect(valueLogs.map((log) => log.action)).toEqual(["write_session_state_value", "delete_session_state_value"]);
    expect(valueLogs[0]!.metadata?.route).toBe("POST /sessions/:sessionId/state/values/write");
    expect(valueLogs[1]!.metadata?.route).toBe("DELETE /sessions/:sessionId/state/values");
    expect(valueLogs[0]!.after_ref?.namespace).toBe("quest_flags");
    expect(valueLogs[0]!.after_ref?.slot).toBe("companion");
    expect(valueLogs[0]!.diff?.total_changes).toBeGreaterThan(0);

    const writeMutation = valueLogs[0]!.after_ref?.mutation as Record<string, unknown> | undefined;
    const payloadSummary = writeMutation?.payload_value_summary as Record<string, unknown> | undefined;
    expect(payloadSummary?.value_hash).toEqual(expect.stringMatching(/^sha256:/));
    expect(payloadSummary?.value_size_bytes).toEqual(expect.any(Number));
    expect(JSON.stringify(valueLogs)).not.toContain("SECRET_STATE_VALUE");
  });

  it("records remaining session write path logs without storing character snapshots", async () => {
    const characterImportResponse = await app.inject({
      method: "POST",
      url: "/import/character",
      payload: {
        create_session: false,
        payload: {
          spec: "chara_card_v2",
          spec_version: "2.0",
          data: {
            name: "Session Sync Character",
            description: "Initial character description.",
            first_mes: "Initial greeting.",
          },
        },
      },
    });
    expect(characterImportResponse.statusCode, characterImportResponse.body).toBe(201);
    const imported = characterImportResponse.json<Data<{
      character_id: string;
      character_version_id: string;
    }>>().data;

    const sessionResponse = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        title: "Session Sync Operation Logs",
        character_id: imported.character_id,
      },
    });
    expect(sessionResponse.statusCode, sessionResponse.body).toBe(201);
    const sessionId = sessionResponse.json<Data<{ id: string }>>().data.id;

    const batchAResponse = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Batch A" },
    });
    expect(batchAResponse.statusCode, batchAResponse.body).toBe(201);
    const batchAId = batchAResponse.json<Data<{ id: string }>>().data.id;

    const batchBResponse = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Batch B" },
    });
    expect(batchBResponse.statusCode, batchBResponse.body).toBe(201);
    const batchBId = batchBResponse.json<Data<{ id: string }>>().data.id;

    const createVersionResponse = await app.inject({
      method: "POST",
      url: `/characters/${imported.character_id}/versions`,
      payload: {
        snapshot: {
          name: "Session Sync Character",
          description: "SECRET_SYNC_CHARACTER_SNAPSHOT",
          first_mes: "SECRET_SYNC_CHARACTER_GREETING",
        },
      },
    });
    expect(createVersionResponse.statusCode, createVersionResponse.body).toBe(201);
    const createdVersion = createVersionResponse.json<Data<{ id: string }>>().data;

    const syncResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/character/sync`,
      payload: { force: true },
    });
    expect(syncResponse.statusCode, syncResponse.body).toBe(200);

    const batchStatusResponse = await app.inject({
      method: "PATCH",
      url: "/sessions/batch/status",
      payload: {
        ids: [sessionId, batchAId, batchBId, "missing-session"],
        status: "archived",
      },
    });
    expect(batchStatusResponse.statusCode, batchStatusResponse.body).toBe(200);

    const batchDeleteResponse = await app.inject({
      method: "POST",
      url: "/sessions/batch/delete",
      payload: { ids: [batchAId, batchBId, "missing-delete-session"] },
    });
    expect(batchDeleteResponse.statusCode, batchDeleteResponse.body).toBe(200);

    const syncLogsResponse = await app.inject({
      method: "GET",
      url: `/operation-logs?target_type=session&target_id=${sessionId}&action=sync_session_character`,
    });
    expect(syncLogsResponse.statusCode, syncLogsResponse.body).toBe(200);
    const syncLogs = syncLogsResponse.json<{ data: OperationLogResponse[] }>().data;
    expect(syncLogs).toHaveLength(1);
    expect(syncLogs[0]!.before_ref?.character_version_id).toBe(imported.character_version_id);
    expect(syncLogs[0]!.after_ref?.character_version_id).toBe(createdVersion.id);
    expect(syncLogs[0]!.metadata).toEqual(expect.objectContaining({
      route: "POST /sessions/:id/character/sync",
      force: true,
      changed: true,
      latest_character_version_id: createdVersion.id,
    }));

    const statusLogsResponse = await app.inject({
      method: "GET",
      url: "/operation-logs?action=batch_update_session_status&sort_order=asc",
    });
    expect(statusLogsResponse.statusCode, statusLogsResponse.body).toBe(200);
    const statusLogs = statusLogsResponse.json<{ data: OperationLogResponse[] }>().data;
    expect(statusLogs.map((log) => log.target_id).sort()).toEqual([batchAId, batchBId, sessionId].sort());
    expect(statusLogs.every((log) => log.metadata?.route === "PATCH /sessions/batch/status")).toBe(true);
    expect(statusLogs.every((log) => log.after_ref?.status === "archived")).toBe(true);

    const deleteLogsResponse = await app.inject({
      method: "GET",
      url: "/operation-logs?action=batch_delete_session&sort_order=asc",
    });
    expect(deleteLogsResponse.statusCode, deleteLogsResponse.body).toBe(200);
    const deleteLogs = deleteLogsResponse.json<{ data: OperationLogResponse[] }>().data;
    expect(deleteLogs.map((log) => log.target_id).sort()).toEqual([batchAId, batchBId].sort());
    expect(deleteLogs.every((log) => log.metadata?.route === "POST /sessions/batch/delete")).toBe(true);
    expect(deleteLogs.every((log) => log.before_ref?.session_id)).toBe(true);

    const serialized = JSON.stringify([...syncLogs, ...statusLogs, ...deleteLogs]);
    expect(serialized).not.toContain("SECRET_SYNC_CHARACTER_SNAPSHOT");
    expect(serialized).not.toContain("SECRET_SYNC_CHARACTER_GREETING");
  });



  it("records character version logs without storing full character snapshot content", async () => {
    const characterImportResponse = await app.inject({
      method: "POST",
      url: "/import/character",
      payload: {
        create_session: false,
        payload: {
          spec: "chara_card_v2",
          spec_version: "2.0",
          data: {
            name: "Operation Log Character",
            description: "SECRET_CHARACTER_CONTENT",
            personality: "SECRET_CHARACTER_PERSONALITY",
            scenario: "SECRET_CHARACTER_SCENARIO",
            first_mes: "SECRET_CHARACTER_GREETING",
            mes_example: "SECRET_CHARACTER_EXAMPLE",
          },
        },
      },
    });
    expect(characterImportResponse.statusCode, characterImportResponse.body).toBe(201);
    const imported = characterImportResponse.json<Data<{
      character_id: string;
      character_version_id: string;
    }>>().data;

    const createVersionResponse = await app.inject({
      method: "POST",
      url: `/characters/${imported.character_id}/versions`,
      payload: {
        snapshot: {
          name: "Operation Log Character v2",
          description: "SECRET_CHARACTER_VERSION_CONTENT",
          first_mes: "SECRET_CHARACTER_VERSION_GREETING",
        },
      },
    });
    expect(createVersionResponse.statusCode, createVersionResponse.body).toBe(201);
    const createdVersion = createVersionResponse.json<Data<{
      id: string;
      version_no: number;
    }>>().data;

    const rollbackResponse = await app.inject({
      method: "POST",
      url: `/characters/${imported.character_id}/versions/${imported.character_version_id}/rollback`,
    });
    expect(rollbackResponse.statusCode, rollbackResponse.body).toBe(201);
    const rollbackVersion = rollbackResponse.json<Data<{
      id: string;
      rolled_back_from_version_id: string;
    }>>().data;

    const logsResponse = await app.inject({
      method: "GET",
      url: `/operation-logs?target_type=character&target_id=${imported.character_id}&sort_order=asc`,
    });
    expect(logsResponse.statusCode, logsResponse.body).toBe(200);
    const logs = logsResponse.json<{ data: OperationLogResponse[] }>().data;
    expect(logs.map((log) => log.action).sort()).toEqual([
      "create_character_version",
      "import_character",
      "rollback_character_version",
    ].sort());
    expect(JSON.stringify(logs)).not.toContain("SECRET_CHARACTER_CONTENT");
    expect(JSON.stringify(logs)).not.toContain("SECRET_CHARACTER_PERSONALITY");
    expect(JSON.stringify(logs)).not.toContain("SECRET_CHARACTER_VERSION_CONTENT");
    expect(JSON.stringify(logs)).not.toContain("SECRET_CHARACTER_VERSION_GREETING");

    const importLog = logs.find((log) => log.action === "import_character");
    const createLog = logs.find((log) => log.action === "create_character_version");
    const rollbackLog = logs.find((log) => log.action === "rollback_character_version");
    expect(importLog?.after_ref?.character_version_id).toBe(imported.character_version_id);
    expect(createLog?.before_ref?.character_version_id).toBe(imported.character_version_id);
    expect(createLog?.after_ref?.character_version_id).toBe(createdVersion.id);
    expect(createLog?.after_ref?.version_no).toBe(createdVersion.version_no);
    expect(rollbackLog?.after_ref?.character_version_id).toBe(rollbackVersion.id);
    expect(rollbackLog?.after_ref?.rolled_back_from_version_id).toBe(imported.character_version_id);
    expect(rollbackLog?.metadata?.route).toBe("POST /characters/:id/versions/:versionId/rollback");

    const versionRows = await database
      .select()
      .from(characterVersions)
      .where(eq(characterVersions.characterId, imported.character_id));
    expect(versionRows.find((row) => row.id === imported.character_version_id)?.createdByOperationId).toBe(importLog?.id);
    expect(versionRows.find((row) => row.id === createdVersion.id)?.createdByOperationId).toBe(createLog?.id);
    expect(versionRows.find((row) => row.id === rollbackVersion.id)?.createdByOperationId).toBe(rollbackLog?.id);
  });

});

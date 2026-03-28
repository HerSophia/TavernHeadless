import { reactive, type Ref } from "vue";

import {
  connectMcpServer,
  createMcpServer,
  deleteMcpServer,
  disconnectMcpServer,
  fetchMcpServer,
  fetchMcpServerStatus,
  fetchMcpServerTools,
  fetchMcpServers,
  fetchMcpStatuses,
  testMcpServer,
  toggleMcpServer,
  updateMcpServer,
  type WorkspaceMcpDefaultSideEffectLevel,
  type WorkspaceMcpHttpConfig,
  type WorkspaceMcpServer,
  type WorkspaceMcpServerStatus,
  type WorkspaceMcpServerTool,
  type WorkspaceMcpTestResult,
  type WorkspaceMcpTransport
} from "../../../lib/workspace-api";
import type { EventTone } from "../../../stores/workspace-ui";

type AddEvent = (key: string, tone?: EventTone, vars?: Record<string, number | string>) => void;

type UseWorkspaceMcpManagerDialogOptions = {
  addEvent: AddEvent;
  currentAccount: Ref<string>;
  t: (key: string, vars?: Record<string, number | string>) => string;
};

export type McpServerDraft = {
  callTimeoutMs: string;
  connectTimeoutMs: string;
  defaultSideEffectLevel: WorkspaceMcpDefaultSideEffectLevel;
  enabled: boolean;
  httpHeadersJson: string;
  httpUrl: string;
  id: string;
  mode: "create" | "edit";
  name: string;
  stdioArgsJson: string;
  stdioCommand: string;
  stdioCwd: string;
  stdioEnvJson: string;
  toolPrefix: string;
  toolRefreshIntervalMs: string;
  transport: WorkspaceMcpTransport;
};

export type WorkspaceMcpManagerDialogState = {
  actionServerId: string | null;
  errorMessage: string;
  lastTestResult: WorkspaceMcpTestResult | null;
  loading: boolean;
  open: boolean;
  saving: boolean;
  selectedServerId: string;
  selectedStatus: WorkspaceMcpServerStatus | null;
  selectedTools: WorkspaceMcpServerTool[];
  serverDraft: McpServerDraft;
  servers: WorkspaceMcpServer[];
  statuses: WorkspaceMcpServerStatus[];
};

export const workspaceMcpTransports: WorkspaceMcpTransport[] = ["stdio", "http"];
export const workspaceMcpSideEffectLevels: WorkspaceMcpDefaultSideEffectLevel[] = ["none", "sandbox", "irreversible"];

function serializeJson(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) {
    return fallback;
  }

  return JSON.stringify(value, null, 2);
}

function createMcpServerDraft(mode: "create" | "edit" = "create", server?: WorkspaceMcpServer): McpServerDraft {
  if (mode === "edit" && server) {
    return {
      callTimeoutMs: String(server.callTimeoutMs),
      connectTimeoutMs: String(server.connectTimeoutMs),
      defaultSideEffectLevel: server.defaultSideEffectLevel,
      enabled: server.enabled,
      httpHeadersJson: serializeJson(server.http?.headers, ""),
      httpUrl: server.http?.url ?? "",
      id: server.id,
      mode,
      name: server.name,
      stdioArgsJson: serializeJson(server.stdio?.args ?? [], "[]"),
      stdioCommand: server.stdio?.command ?? "",
      stdioCwd: server.stdio?.cwd ?? "",
      stdioEnvJson: serializeJson(server.stdio?.env, ""),
      toolPrefix: server.toolPrefix ?? "",
      toolRefreshIntervalMs: String(server.toolRefreshIntervalMs),
      transport: server.transport
    };
  }

  return {
    callTimeoutMs: "60000",
    connectTimeoutMs: "30000",
    defaultSideEffectLevel: "sandbox",
    enabled: true,
    httpHeadersJson: "",
    httpUrl: "",
    id: "",
    mode,
    name: "",
    stdioArgsJson: "[]",
    stdioCommand: "",
    stdioCwd: "",
    stdioEnvJson: "",
    toolPrefix: "",
    toolRefreshIntervalMs: "300000",
    transport: "stdio"
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseJsonRecord(raw: string, errorMessage: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(errorMessage);
  }

  const record = asRecord(parsed);
  if (!record) {
    throw new Error(errorMessage);
  }

  return record;
}

function parseStringRecord(raw: string, errorMessage: string): Record<string, string> | undefined {
  const record = parseJsonRecord(raw, errorMessage);
  if (!record) {
    return undefined;
  }

  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string") {
      throw new Error(errorMessage);
    }

    mapped[key] = value;
  }

  return mapped;
}

function parseOptionalPositiveInteger(raw: string, errorMessage: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(errorMessage);
  }

  return parsed;
}

function parseStringArray(raw: string, errorMessage: string): string[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(errorMessage);
  }

  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(errorMessage);
  }

  return parsed.map((item) => item.trim()).filter((item) => item.length > 0);
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

export function useWorkspaceMcpManagerDialog(options: UseWorkspaceMcpManagerDialogOptions) {
  const mcpManagerDialog = reactive<WorkspaceMcpManagerDialogState>({
    actionServerId: null,
    errorMessage: "",
    lastTestResult: null,
    loading: false,
    open: false,
    saving: false,
    selectedServerId: "",
    selectedStatus: null,
    selectedTools: [],
    serverDraft: createMcpServerDraft(),
    servers: [],
    statuses: []
  });

  function clearMcpManagerError(): void {
    mcpManagerDialog.errorMessage = "";
  }

  function beginCreateMcpServerDraft(): void {
    mcpManagerDialog.selectedServerId = "";
    mcpManagerDialog.selectedStatus = null;
    mcpManagerDialog.selectedTools = [];
    mcpManagerDialog.lastTestResult = null;
    mcpManagerDialog.serverDraft = createMcpServerDraft();
    clearMcpManagerError();
  }

  async function refreshMcpServerLists(): Promise<void> {
    const [servers, statuses] = await Promise.all([
      fetchMcpServers({
        accountId: options.currentAccount.value,
        limit: 100,
        sortBy: "name",
        sortOrder: "asc"
      }),
      fetchMcpStatuses(options.currentAccount.value)
    ]);

    mcpManagerDialog.servers = servers.servers;
    mcpManagerDialog.statuses = statuses;

    if (
      mcpManagerDialog.selectedServerId &&
      !servers.servers.some((server) => server.id === mcpManagerDialog.selectedServerId)
    ) {
      beginCreateMcpServerDraft();
    }
  }

  async function loadSelectedMcpServerRuntime(serverId: string): Promise<void> {
    const status = await fetchMcpServerStatus(serverId, options.currentAccount.value);
    mcpManagerDialog.selectedStatus = status;

    if (status.toolCount > 0) {
      try {
        mcpManagerDialog.selectedTools = await fetchMcpServerTools(serverId, options.currentAccount.value);
      } catch {
        mcpManagerDialog.selectedTools = [];
      }
    } else {
      mcpManagerDialog.selectedTools = [];
    }
  }

  async function refreshMcpManagerDialog(): Promise<void> {
    mcpManagerDialog.loading = true;
    clearMcpManagerError();

    try {
      await refreshMcpServerLists();

      if (mcpManagerDialog.selectedServerId) {
        await selectMcpServer(mcpManagerDialog.selectedServerId);
      }
    } catch (error) {
      mcpManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.mcpManagerLoadFailed"));
      options.addEvent("events.mcpManagerLoadFailed", "warn");
    } finally {
      mcpManagerDialog.loading = false;
    }
  }

  async function openMcpManagerDialog(): Promise<void> {
    mcpManagerDialog.open = true;
    await refreshMcpManagerDialog();
  }

  function closeMcpManagerDialog(): void {
    mcpManagerDialog.open = false;
  }

  function resetMcpManagerDialog(): void {
    mcpManagerDialog.actionServerId = null;
    mcpManagerDialog.errorMessage = "";
    mcpManagerDialog.lastTestResult = null;
    mcpManagerDialog.loading = false;
    mcpManagerDialog.open = false;
    mcpManagerDialog.saving = false;
    mcpManagerDialog.selectedServerId = "";
    mcpManagerDialog.selectedStatus = null;
    mcpManagerDialog.selectedTools = [];
    mcpManagerDialog.serverDraft = createMcpServerDraft();
    mcpManagerDialog.servers = [];
    mcpManagerDialog.statuses = [];
  }

  async function selectMcpServer(serverId: string): Promise<void> {
    mcpManagerDialog.selectedServerId = serverId;
    clearMcpManagerError();

    try {
      const server = await fetchMcpServer(serverId, options.currentAccount.value);
      mcpManagerDialog.serverDraft = createMcpServerDraft("edit", server);
      await loadSelectedMcpServerRuntime(serverId);
    } catch (error) {
      mcpManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.mcpManagerLoadFailed"));
    }
  }

  function buildStdioConfig(): { args?: string[]; command: string; cwd?: string; env?: Record<string, string> } | undefined {
    if (mcpManagerDialog.serverDraft.transport !== "stdio") {
      return undefined;
    }

    const command = mcpManagerDialog.serverDraft.stdioCommand.trim();
    if (!command) {
      throw new Error(options.t("dialogs.mcpManagerStdioCommandRequired"));
    }

    return {
      args: parseStringArray(mcpManagerDialog.serverDraft.stdioArgsJson, options.t("dialogs.mcpManagerValidationStringArray")),
      command,
      cwd: mcpManagerDialog.serverDraft.stdioCwd.trim() || undefined,
      env: parseStringRecord(mcpManagerDialog.serverDraft.stdioEnvJson, options.t("dialogs.mcpManagerValidationStringRecord"))
    };
  }

  function buildHttpConfig(): WorkspaceMcpHttpConfig | undefined {
    if (mcpManagerDialog.serverDraft.transport !== "http") {
      return undefined;
    }

    const url = mcpManagerDialog.serverDraft.httpUrl.trim();
    if (!url) {
      throw new Error(options.t("dialogs.mcpManagerHttpUrlRequired"));
    }

    return {
      headers: parseStringRecord(mcpManagerDialog.serverDraft.httpHeadersJson, options.t("dialogs.mcpManagerValidationStringRecord")),
      url
    };
  }

  async function saveMcpServer(): Promise<void> {
    const name = mcpManagerDialog.serverDraft.name.trim();
    if (!name) {
      mcpManagerDialog.errorMessage = options.t("dialogs.mcpManagerServerNameRequired");
      return;
    }

    mcpManagerDialog.saving = true;
    clearMcpManagerError();

    try {
      const mode = mcpManagerDialog.serverDraft.mode;
      const integerErrorMessage = options.t("dialogs.mcpManagerValidationPositiveInteger");
      const payload = {
        callTimeoutMs: parseOptionalPositiveInteger(mcpManagerDialog.serverDraft.callTimeoutMs, integerErrorMessage),
        connectTimeoutMs: parseOptionalPositiveInteger(mcpManagerDialog.serverDraft.connectTimeoutMs, integerErrorMessage),
        defaultSideEffectLevel: mcpManagerDialog.serverDraft.defaultSideEffectLevel,
        http: buildHttpConfig(),
        name,
        stdio: buildStdioConfig(),
        toolPrefix: mcpManagerDialog.serverDraft.toolPrefix.trim(),
        toolRefreshIntervalMs: parseOptionalPositiveInteger(mcpManagerDialog.serverDraft.toolRefreshIntervalMs, integerErrorMessage),
        transport: mcpManagerDialog.serverDraft.transport
      };

      const saved = mode === "create"
        ? await createMcpServer({
            accountId: options.currentAccount.value,
            callTimeoutMs: payload.callTimeoutMs,
            connectTimeoutMs: payload.connectTimeoutMs,
            defaultSideEffectLevel: payload.defaultSideEffectLevel,
            enabled: mcpManagerDialog.serverDraft.enabled,
            http: payload.http,
            name: payload.name,
            stdio: payload.stdio,
            toolPrefix: payload.toolPrefix || undefined,
            toolRefreshIntervalMs: payload.toolRefreshIntervalMs,
            transport: payload.transport
          })
        : await updateMcpServer({
            accountId: options.currentAccount.value,
            callTimeoutMs: payload.callTimeoutMs,
            connectTimeoutMs: payload.connectTimeoutMs,
            defaultSideEffectLevel: payload.defaultSideEffectLevel,
            http: payload.http,
            name: payload.name,
            serverId: mcpManagerDialog.serverDraft.id,
            stdio: payload.stdio,
            toolPrefix: payload.toolPrefix || null,
            toolRefreshIntervalMs: payload.toolRefreshIntervalMs,
            transport: payload.transport
          });

      if (saved.enabled !== mcpManagerDialog.serverDraft.enabled) {
        await toggleMcpServer(saved.id, mcpManagerDialog.serverDraft.enabled, options.currentAccount.value);
      }

      await refreshMcpServerLists();
      await selectMcpServer(saved.id);
      options.addEvent(
        mode === "create"
          ? "events.mcpServerCreated"
          : "events.mcpServerUpdated",
        "success",
        { server: saved.name }
      );
    } catch (error) {
      mcpManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.mcpManagerLoadFailed"));
    } finally {
      mcpManagerDialog.saving = false;
    }
  }

  async function toggleMcpServerEnabled(serverId: string, enabled: boolean): Promise<void> {
    mcpManagerDialog.actionServerId = serverId;
    clearMcpManagerError();

    try {
      const saved = await toggleMcpServer(serverId, enabled, options.currentAccount.value);
      mcpManagerDialog.servers = mcpManagerDialog.servers.map((server) => {
        return server.id === saved.id ? saved : server;
      });

      if (mcpManagerDialog.selectedServerId === saved.id) {
        mcpManagerDialog.serverDraft.enabled = saved.enabled;
      }

      options.addEvent("events.mcpServerToggled", "success", {
        server: saved.name,
        state: saved.enabled ? options.t("dialogs.toolManagerDraftTrue") : options.t("dialogs.toolManagerDraftFalse")
      });
    } catch (error) {
      mcpManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.mcpManagerLoadFailed"));
    } finally {
      mcpManagerDialog.actionServerId = null;
    }
  }

  async function deleteMcpServerById(serverId: string): Promise<void> {
    mcpManagerDialog.actionServerId = serverId;
    clearMcpManagerError();

    try {
      const target = mcpManagerDialog.servers.find((server) => server.id === serverId) ?? null;
      await deleteMcpServer(serverId, options.currentAccount.value);
      await refreshMcpServerLists();

      if (mcpManagerDialog.selectedServerId === serverId) {
        beginCreateMcpServerDraft();
      }

      options.addEvent("events.mcpServerDeleted", "warn", {
        server: target?.name ?? serverId
      });
    } catch (error) {
      mcpManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.mcpManagerLoadFailed"));
    } finally {
      mcpManagerDialog.actionServerId = null;
    }
  }

  async function connectSelectedMcpServer(): Promise<void> {
    if (!mcpManagerDialog.selectedServerId) {
      return;
    }

    mcpManagerDialog.actionServerId = mcpManagerDialog.selectedServerId;
    clearMcpManagerError();

    try {
      const status = await connectMcpServer(mcpManagerDialog.selectedServerId, options.currentAccount.value);
      mcpManagerDialog.selectedStatus = status;
      await refreshMcpServerLists();
      await loadSelectedMcpServerRuntime(mcpManagerDialog.selectedServerId);
      options.addEvent("events.mcpServerConnected", "success", {
        server: status.serverName
      });
    } catch (error) {
      mcpManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.mcpManagerLoadFailed"));
    } finally {
      mcpManagerDialog.actionServerId = null;
    }
  }

  async function disconnectSelectedMcpServer(): Promise<void> {
    if (!mcpManagerDialog.selectedServerId) {
      return;
    }

    mcpManagerDialog.actionServerId = mcpManagerDialog.selectedServerId;
    clearMcpManagerError();

    try {
      const status = await disconnectMcpServer(mcpManagerDialog.selectedServerId, options.currentAccount.value);
      mcpManagerDialog.selectedStatus = status;
      mcpManagerDialog.selectedTools = [];
      await refreshMcpServerLists();
      options.addEvent("events.mcpServerDisconnected", "warn", {
        server: status.serverName
      });
    } catch (error) {
      mcpManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.mcpManagerLoadFailed"));
    } finally {
      mcpManagerDialog.actionServerId = null;
    }
  }

  async function testSelectedMcpServerConfig(): Promise<void> {
    if (!mcpManagerDialog.selectedServerId) {
      return;
    }

    mcpManagerDialog.actionServerId = mcpManagerDialog.selectedServerId;
    clearMcpManagerError();

    try {
      const result = await testMcpServer(mcpManagerDialog.selectedServerId, options.currentAccount.value);
      mcpManagerDialog.lastTestResult = result;
      await refreshMcpServerLists();
      if (result.success) {
        await loadSelectedMcpServerRuntime(mcpManagerDialog.selectedServerId);
      }
      options.addEvent(result.success ? "events.mcpServerTestPassed" : "events.mcpServerTestFailed", result.success ? "success" : "warn", {
        duration: result.durationMs,
        toolCount: result.toolCount
      });
    } catch (error) {
      mcpManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.mcpManagerLoadFailed"));
    } finally {
      mcpManagerDialog.actionServerId = null;
    }
  }

  return {
    beginCreateMcpServerDraft,
    clearMcpManagerError,
    closeMcpManagerDialog,
    connectSelectedMcpServer,
    deleteMcpServerById,
    disconnectSelectedMcpServer,
    mcpManagerDialog,
    openMcpManagerDialog,
    refreshMcpManagerDialog,
    resetMcpManagerDialog,
    saveMcpServer,
    selectMcpServer,
    testSelectedMcpServerConfig,
    toggleMcpServerEnabled
  };
}

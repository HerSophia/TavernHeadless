import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import type { ChatTransferFormat } from "./chat-transfer-jobs.js";
import type { SessionCharacterBinding, SessionRecord, SessionUserBinding } from "./sessions.js";
import { readBoolean, readNullableString, readNumber, readOptionalString, readRecord, readString } from "./utils.js";

export type ImportedResource = {
  id: string;
  name: string;
  source: string;
};

export type ImportedCharacter = {
  character: Record<string, unknown>;
  characterId: string;
  characterVersionId: string | null;
  createSession: boolean;
  name: string;
  session?: SessionRecord;
  source: string;
};

type ImportedChatBase = {
  floorCount: number;
  importSource: string;
  messageCount: number;
  sessionId: string;
  skippedLines: number;
  title: string;
};

export type ImportedJsonlChat = ImportedChatBase & {
  format: "sillytavern_jsonl";
  importSource: "sillytavern_jsonl";
  swipeCount: number;
};

export type ImportedThChat = ImportedChatBase & {
  format: "thchat";
  importSource: "thchat";
  memoryEdgeCount: number;
  memoryItemCount: number;
  pageCount: number;
  variableCount: number;
};

export type ImportedChat = ImportedJsonlChat | ImportedThChat;

type ImportChatJobFormat = Extract<ChatTransferFormat, "thchat" | "sillytavern_jsonl">;

export type ImportChatJob = {
  format: ImportChatJobFormat | null;
  jobId: string;
  jobKind: "import_chat";
  status: "pending";
};

export type ImportedRegexProfile = ImportedResource & {
  scriptCount: number;
};

export type ImportsResource = {
  character(options: { accountId?: AccountIdHint; createSession?: boolean; payload: Record<string, unknown>; title?: string }): Promise<ImportedCharacter>;
  chat(options: { accountId?: AccountIdHint; characterId?: string; data: string; title?: string }): Promise<ImportedChat>;
  chatJob(options: { accountId?: AccountIdHint; characterId?: string; data: string; title?: string }): Promise<ImportChatJob>;
  preset(options: { accountId?: AccountIdHint; data: Record<string, unknown>; name: string }): Promise<ImportedResource>;
  regex(options: { accountId?: AccountIdHint; data: string; name: string }): Promise<ImportedRegexProfile>;
  worldbook(options: { accountId?: AccountIdHint; data: Record<string, unknown>; name: string }): Promise<ImportedResource>;
};

export function createImportsResource(client: TransportClient): ImportsResource {
  return {
    async character(options): Promise<ImportedCharacter> {
      const response = await client.fetchJson<Record<string, unknown>>("/import/character", {
        body: {
          create_session: options.createSession ?? true,
          payload: options.payload,
          title: options.title,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const record = readRecord(readRecord(response.body)?.data);
      const characterRecord = readRecord(record?.character) ?? {};
      const session = mapImportedCharacterSession(record?.session);
      const characterId = readOptionalString(record?.character_id) ?? session?.characterBinding?.characterId;
      const characterVersionId = readOptionalString(record?.character_version_id) ?? session?.characterBinding?.characterVersionId ?? null;
      if (!characterId) {
        throw new Error("Character import returned an invalid payload");
      }

      return {
        character: characterRecord,
        characterId,
        characterVersionId,
        createSession: readBoolean(record?.create_session, true),
        name: readString(characterRecord.name, options.title ?? session?.title ?? "Imported Character"),
        ...(session ? { session } : {}),
        source: "sillytavern",
      };
    },
    async chat(options): Promise<ImportedChat> {
      const response = await client.fetchJson<Record<string, unknown>>("/import/chat", {
        body: {
          character_id: options.characterId,
          data: options.data,
          title: options.title,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const data = readRecord(readRecord(response.body)?.data);
      const sessionId = readOptionalString(data?.session_id);
      if (!sessionId) {
        throw new Error("Chat import returned an invalid payload");
      }

      const format = readString(data?.format);
      const title = readString(data?.title, options.title ?? "Imported Chat");

      if (format === "thchat") {
        return {
          floorCount: readNumber(data?.floor_count),
          format: "thchat",
          importSource: "thchat",
          memoryEdgeCount: readNumber(data?.memory_edge_count),
          memoryItemCount: readNumber(data?.memory_item_count),
          messageCount: readNumber(data?.message_count),
          pageCount: readNumber(data?.page_count),
          sessionId,
          skippedLines: readNumber(data?.skipped_lines),
          title,
          variableCount: readNumber(data?.variable_count),
        };
      }

      return {
        floorCount: readNumber(data?.floor_count),
        format: "sillytavern_jsonl",
        importSource: "sillytavern_jsonl",
        messageCount: readNumber(data?.message_count),
        sessionId,
        skippedLines: readNumber(data?.skipped_lines),
        swipeCount: readNumber(data?.swipe_count),
        title,
      };
    },
    async chatJob(options): Promise<ImportChatJob> {
      const response = await client.fetchJson<Record<string, unknown>>("/import/chat/jobs", {
        body: {
          character_id: options.characterId,
          data: options.data,
          title: options.title,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const data = readRecord(readRecord(response.body)?.data);
      const jobId = readOptionalString(data?.job_id);
      const status = readOptionalString(data?.status);
      const jobKind = readOptionalString(data?.job_kind);
      if (!jobId || status !== "pending" || jobKind !== "import_chat") {
        throw new Error("Chat import job creation returned an invalid payload");
      }

      return {
        format: mapImportChatJobFormat(data?.format),
        jobId,
        jobKind,
        status,
      };
    },
    async preset(options): Promise<ImportedResource> {
      const response = await client.fetchJson<Record<string, unknown>>("/import/preset", {
        body: {
          data: options.data,
          name: options.name,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return mapImportedResource(readRecord(response.body)?.data, "Preset import returned an invalid payload", options.name, "sillytavern");
    },
    async regex(options): Promise<ImportedRegexProfile> {
      const response = await client.fetchJson<Record<string, unknown>>("/import/regex", {
        body: {
          data: options.data,
          name: options.name,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const data = readRecord(readRecord(response.body)?.data);
      const id = readOptionalString(data?.id);
      if (!id) {
        throw new Error("Regex import returned an invalid payload");
      }

      return {
        id,
        name: readString(data?.name, options.name),
        scriptCount: readNumber(data?.script_count),
        source: readString(data?.source, "sillytavern"),
      };
    },
    async worldbook(options): Promise<ImportedResource> {
      const response = await client.fetchJson<Record<string, unknown>>("/import/worldbook", {
        body: {
          data: options.data,
          name: options.name,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      return mapImportedResource(
        readRecord(response.body)?.data,
        "Worldbook import returned an invalid payload",
        options.name,
        "sillytavern",
      );
    },
  };
}

function mapImportedResource(
  value: unknown,
  errorMessage: string,
  fallbackName: string,
  fallbackSource: string,
): ImportedResource {
  const record = readRecord(value);
  const id = readOptionalString(record?.id);
  if (!id) {
    throw new Error(errorMessage);
  }

  return {
    id,
    name: readString(record?.name, fallbackName),
    source: readString(record?.source, fallbackSource),
  };
}

function mapImportChatJobFormat(value: unknown): ImportChatJobFormat | null {
  return value === "thchat" || value === "sillytavern_jsonl" ? value : null;
}

function mapImportedCharacterSession(value: unknown): SessionRecord | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    characterBinding: mapSessionCharacterBinding(record.character_binding),
    createdAt: readNumber(record.created_at),
    id: readString(record.id),
    metadata: record.metadata ?? null,
    modelName: readNullableString(record.model_name),
    modelParams: record.model_params ?? null,
    modelProvider: readNullableString(record.model_provider),
    presetId: readNullableString(record.preset_id),
    promptMode: readNullableString(record.prompt_mode),
    regexProfileId: readNullableString(record.regex_profile_id),
    status: readString(record.status),
    title: readNullableString(record.title),
    updatedAt: readNumber(record.updated_at),
    userBinding: mapSessionUserBinding(record.user_binding),
    worldbookProfileId: readNullableString(record.worldbook_profile_id),
  };
}

function mapSessionCharacterBinding(value: unknown): SessionCharacterBinding | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const snapshotSummary = readRecord(record.snapshot_summary);
  return {
    characterId: readNullableString(record.character_id),
    characterVersionId: readNullableString(record.character_version_id),
    snapshotSummary: snapshotSummary
      ? { hasGreeting: readBoolean(snapshotSummary.has_greeting), name: readString(snapshotSummary.name) }
      : null,
    syncPolicy: readString(record.sync_policy, "pin") as SessionCharacterBinding["syncPolicy"],
  };
}

function mapSessionUserBinding(value: unknown): SessionUserBinding | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const snapshotSummary = readRecord(record.snapshot_summary);
  return {
    snapshotSummary: snapshotSummary ? { name: readString(snapshotSummary.name) } : null,
    userId: readNullableString(record.user_id),
  };
}

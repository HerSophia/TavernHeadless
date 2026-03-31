import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import type { ChatTransferFormat } from "./chat-transfer-jobs.js";
import { readNumber, readOptionalString, readRecord, readString } from "./utils.js";

export type ImportedResource = {
  id: string;
  name: string;
  source: string;
};

type ImportChatJobFormat = Extract<ChatTransferFormat, "thchat" | "sillytavern_jsonl">;

export type ImportChatJob = {
  format: ImportChatJobFormat | null;
  jobId: string;
  jobKind: "import_chat";
  status: "pending";
};

export type ImportedCharacter = {
  characterId: string;
  name: string;
  source: string;
};

export type ImportedRegexProfile = ImportedResource & {
  scriptCount: number;
};

export type ImportedChat = {
  floorCount: number;
  format: string;
  importSource: string;
  messageCount: number;
  sessionId: string;
  skippedLines: number;
  swipeCount: number;
  title: string;
};

export type ImportsResource = {
  character(options: { accountId?: AccountIdHint; createSession?: boolean; payload: Record<string, unknown>; title: string }): Promise<ImportedCharacter>;
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
          create_session: options.createSession ?? false,
          payload: options.payload,
          title: options.title,
        },
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const data = readRecord(response.body)?.data;
      const record = readRecord(data);
      const characterId = readOptionalString(record?.character_id);
      const characterRecord = readRecord(record?.character);
      if (!characterId) {
        throw new Error("Character import returned an invalid payload");
      }

      return {
        characterId,
        name: readString(characterRecord?.name, options.title),
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

      return {
        floorCount: readNumber(data?.floor_count),
        format: readString(data?.format),
        importSource: readString(data?.import_source),
        messageCount: readNumber(data?.message_count),
        sessionId,
        skippedLines: readNumber(data?.skipped_lines),
        swipeCount: readNumber(data?.swipe_count),
        title: readString(data?.title, options.title ?? "Imported Chat"),
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

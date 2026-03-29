import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { buildQueryString, compactObject } from "./utils.js";

export type ExportChatFormat = "thchat" | "st_jsonl";

export type ExportsResource = {
  character(options: {
    accountId?: AccountIdHint;
    characterId: string;
    signal?: AbortSignal;
    versionId?: string;
  }): Promise<Response>;
  chat(options: {
    accountId?: AccountIdHint;
    format?: ExportChatFormat;
    includeMemories?: boolean;
    includeVariables?: boolean;
    sessionId: string;
    signal?: AbortSignal;
  }): Promise<Response>;
  preset(options: {
    accountId?: AccountIdHint;
    presetId: string;
    signal?: AbortSignal;
  }): Promise<Response>;
  regex(options: {
    accountId?: AccountIdHint;
    profileId: string;
    signal?: AbortSignal;
  }): Promise<Response>;
  worldbook(options: {
    accountId?: AccountIdHint;
    signal?: AbortSignal;
    worldbookId: string;
  }): Promise<Response>;
};

export function createExportsResource(client: TransportClient): ExportsResource {
  return {
    async character(options): Promise<Response> {
      const query = buildQueryString(compactObject({
        version_id: options.versionId,
      }));
      const pathname = withQuery(`/export/character/${encodeURIComponent(options.characterId)}`, query);

      return client.fetchRaw(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
        signal: options.signal,
      });
    },
    async chat(options): Promise<Response> {
      const query = buildQueryString(compactObject({
        format: options.format,
        include_memories: options.includeMemories,
        include_variables: options.includeVariables,
      }));
      const pathname = withQuery(`/export/chat/${encodeURIComponent(options.sessionId)}`, query);

      return client.fetchRaw(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
        signal: options.signal,
      });
    },
    async preset(options): Promise<Response> {
      return client.fetchRaw(`/export/preset/${encodeURIComponent(options.presetId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
        signal: options.signal,
      });
    },
    async regex(options): Promise<Response> {
      return client.fetchRaw(`/export/regex/${encodeURIComponent(options.profileId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
        signal: options.signal,
      });
    },
    async worldbook(options): Promise<Response> {
      return client.fetchRaw(`/export/worldbook/${encodeURIComponent(options.worldbookId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
        signal: options.signal,
      });
    },
  };
}

function withQuery(pathname: string, query: string): string {
  return query ? `${pathname}?${query}` : pathname;
}

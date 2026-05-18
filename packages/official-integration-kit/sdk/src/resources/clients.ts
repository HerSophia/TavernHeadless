import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import {
 buildQueryString,
  compactObject,
  readArray,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readNumber,
  readRecord,
  readString,
} from "./utils.js";

export type ClientKind = "basic" | "advanced" | "deriver" | "worker" | "custom";
export type ClientStatus = "active" | "disabled";
export type ClientApiKeyStatus = "active" | "revoked";

export type ClientRecord = {
  id: string;
  accountId: string;
  name: string;
  kind: ClientKind;
  status: ClientStatus;
  isDefault: boolean;
  metadata: unknown;
  createdAt: number;
  updatedAt: number;
};

export type ClientApiKeyRecord = {
  id: string;
  accountId: string;
  clientId: string;
  name: string | null;
  keyPrefix: string;
  status: ClientApiKeyStatus;
  lastUsedAt: number | null;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type CreatedClientApiKey = {
  apiKey: ClientApiKeyRecord;
  secret: string;
};

export type ClientsListOptions = {
  accountId?: AccountIdHint;
  status?: ClientStatus;
  kind?: ClientKind;
  limit?: number;
  cursor?: string;
};

export type ClientsListResult = {
  items: ClientRecord[];
  nextCursor: string | null;
};

export type ClientsCreateInput = {
  name: string;
  kind?: ClientKind;
  metadata?: unknown;
};

export type ClientsUpdateInput = {
  name?: string;
  kind?: ClientKind;
  metadata?: unknown;
};

export type ClientsRequestOptions = {
  accountId?: AccountIdHint;
};

export type ClientApiKeysListOptions = ClientsRequestOptions & {
  status?: ClientApiKeyStatus;
  limit?: number;
  cursor?: string;
};

export type ClientApiKeysListResult = {
  items: ClientApiKeyRecord[];
  nextCursor: string | null;
};

export type ClientApiKeysCreateInput = {
name?: string | null;
  expiresAt?: number | null;
};

export type ClientApiKeysResource = {
  list(clientId: string, options?: ClientApiKeysListOptions): Promise<ClientApiKeysListResult>;
  create(
    clientId: string,
    input?: ClientApiKeysCreateInput,
    options?: ClientsRequestOptions,
  ): Promise<CreatedClientApiKey>;
  revoke(
    clientId: string,
    apiKeyId: string,
    options?: ClientsRequestOptions,
  ): Promise<ClientApiKeyRecord>;
};

export type ClientsResource = {
  list(options?: ClientsListOptions): Promise<ClientsListResult>;
  get(clientId: string, options?: ClientsRequestOptions): Promise<ClientRecord>;
  create(input: ClientsCreateInput, options?: ClientsRequestOptions): Promise<ClientRecord>;
  update(
    clientId: string,
    input: ClientsUpdateInput,
    options?: ClientsRequestOptions,
  ): Promise<ClientRecord>;
  disable(clientId: string, options?: ClientsRequestOptions): Promise<ClientRecord>;
  enable(clientId: string, options?: ClientsRequestOptions): Promise<ClientRecord>;
  apiKeys: ClientApiKeysResource;
};

export function createClientsResource(client: TransportClient): ClientsResource {
  const apiKeys = createClientApiKeysResource(client);

  return {
    apiKeys,
    async list(options: ClientsListOptions = {}): Promise<ClientsListResult> {
      const query = buildQueryString(
        compactObject({
          status: options.status,
          kind: options.kind,
          limit: options.limit,
          cursor: options.cursor,
        }),
      );
      const pathname = query ? `/clients?${query}` : "/clients";
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers:buildAccountHeaders(options.accountId),
        method: "GET",
      });
      const body = readRecord(response.body);
      return {
        items: readArray(body?.items)
          .map(mapClientRecord)
          .filter((item): item is ClientRecord => item !== null),
        nextCursor: readNullableString(body?.next_cursor),
      };
    },
    async get(clientId, options: ClientsRequestOptions = {}): Promise<ClientRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/clients/${encodeURIComponent(clientId)}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );
      return readClientResponse(response.body);
    },
    async create(input, options: ClientsRequestOptions = {}): Promise<ClientRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/clients", {
        body: compactObject({
          name: input.name,
          kind: input.kind,
          metadata: input.metadata,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });
      return readClientResponse(response.body);
    },
    async update(clientId, input, options: ClientsRequestOptions = {}): Promise<ClientRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/clients/${encodeURIComponent(clientId)}`,
        {
          body: compactObject({
            name: input.name,
            kind: input.kind,
            metadata: input.metadata,
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "PATCH",
        },
      );
      return readClientResponse(response.body);
    },
    async disable(clientId, options: ClientsRequestOptions = {}): Promise<ClientRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/clients/${encodeURIComponent(clientId)}/disable`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      return readClientResponse(response.body);
    },
    async enable(clientId, options: ClientsRequestOptions = {}): Promise<ClientRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/clients/${encodeURIComponent(clientId)}/enable`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      return readClientResponse(response.body);
    },
  };
}

function createClientApiKeysResource(client: TransportClient): ClientApiKeysResource {
  return {
    async list(clientId, options: ClientApiKeysListOptions = {}): Promise<ClientApiKeysListResult> {
      const query = buildQueryString(
        compactObject({
          status: options.status,
          limit: options.limit,
          cursor: options.cursor,
        }),
      );
      const pathname = query
        ? `/clients/${encodeURIComponent(clientId)}/api-keys?${query}`
        : `/clients/${encodeURIComponent(clientId)}/api-keys`;
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });
      const body = readRecord(response.body);
      return {
        items: readArray(body?.items)
          .map(mapClientApiKeyRecord)
          .filter((item): item is ClientApiKeyRecord => item !== null),
        nextCursor: readNullableString(body?.next_cursor),
      };
    },
    async create(
      clientId,
      input: ClientApiKeysCreateInput = {},
      options: ClientsRequestOptions = {},
    ): Promise<CreatedClientApiKey> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/clients/${encodeURIComponent(clientId)}/api-keys`,
        {
          body: compactObject({
            name: input.name,
            expires_at: input.expiresAt,
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      const body = readRecord(response.body);
      const apiKey = mapClientApiKeyRecord(body?.item);
      const secret = readString(body?.secret, "");
      if (!apiKey || secret.length === 0) {
        throw new Error("Client API key create returned an invalid payload");
      }
      return { apiKey, secret };
    },
    async revoke(
      clientId,
    apiKeyId,
      options:ClientsRequestOptions = {},
    ): Promise<ClientApiKeyRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/clients/${encodeURIComponent(clientId)}/api-keys/${encodeURIComponent(apiKeyId)}/revoke`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      return readClientApiKeyResponse(response.body);
    },
  };
}

function readClientResponse(value: unknown): ClientRecord {
  const record = mapClientRecord(readRecord(value)?.item);
  if (!record) {
    throw new Error("Client payload is missing");
  }
  return record;
}

function readClientApiKeyResponse(value:unknown): ClientApiKeyRecord {
  const record = mapClientApiKeyRecord(readRecord(value)?.item);
  if (!record) {
    throw new Error("Client API key payload is missing");
  }
  return record;
}

function mapClientRecord(value: unknown): ClientRecord | null {
  const record = readRecord(value);
  if (!record) return null;
  const kind = readString(record.kind) as ClientKind;
  if (!isClientKind(kind)) return null;
  const status = readString(record.status) as ClientStatus;
  if (status !== "active" && status !== "disabled") return null;
  return {
    id: readString(record.id),
    accountId: readString(record.account_id),
    name: readString(record.name),
    kind,
    status,
    isDefault: readBoolean(record.is_default, false),
    metadata: record.metadata ?? null,
    createdAt: readNumber(record.created_at),
    updatedAt: readNumber(record.updated_at),
  };
}

function mapClientApiKeyRecord(value: unknown): ClientApiKeyRecord | null {
  const record = readRecord(value);
  if (!record) return null;
  const status = readString(record.status) as ClientApiKeyStatus;
  if (status !== "active" && status !== "revoked")return null;
  return {
    id: readString(record.id),
    accountId: readString(record.account_id),
    clientId: readString(record.client_id),
    name: readNullableString(record.name),
    keyPrefix: readString(record.key_prefix),
    status,
    lastUsedAt: readNullableNumber(record.last_used_at),
    expiresAt: readNullableNumber(record.expires_at),
    createdAt: readNumber(record.created_at),
    updatedAt: readNumber(record.updated_at),
  };
}

function isClientKind(value: string): value is ClientKind {
  return (
    value === "basic"
    || value === "advanced"
    || value === "deriver"
    || value === "worker"
    || value === "custom"
);
}

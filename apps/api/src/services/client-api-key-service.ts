import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { accounts, clientApiKeys, clients } from "../db/schema.js";
import { ClientServiceError } from "./client-service.js";

export type ClientApiKeyStatus = "active" | "revoked";

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

export type ClientApiKeyListResult = {
  items: ClientApiKeyRecord[];
  nextCursor: string | null;
};

export type ClientApiKeyAuthResult = {
  accountId: string;
  clientId: string;
  apiKeyId: string;
  clientKind: string;
  isDefaultClient: boolean;
};

export type ClientApiKeyServiceErrorCode =
  | "client_api_key_invalid"
  | "client_api_key_not_found"
  | "client_api_key_expires_at_invalid"
  | "client_api_key_name_too_long"
  | "client_not_found"
  | "client_disabled"
  | "client_api_key_cursor_invalid";

export class ClientApiKeyServiceError extends Error {
constructor(
    public readonly statusCode: 400 | 401 | 404 | 409,
    public readonly code: ClientApiKeyServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ClientApiKeyServiceError";
  }
}

export type CreateClientApiKeyInput = {
  accountId: string;
  clientId: string;
  name?: string | null;
  expiresAt?: number | null;
  now?: number;
};

export type ListClientApiKeysInput = {
  accountId: string;
  clientId: string;
  status?: ClientApiKeyStatus;
  limit?: number;
  cursor?: string;
};

export type RevokeClientApiKeyInput = {
  accountId: string;
  clientId: string;
  apiKeyId: string;
  now?: number;
};

const KEY_PREFIX_LENGTH = 18;
const SECRET_PREFIX ="tvk_live_";
const HASH_VERSION_PREFIX = "tavern-client-api-key:v1:";
const MAX_NAME_LENGTH = 120;
const LAST_USED_THROTTLE_MS = 60 * 1000;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * Issues, lists, revokes and verifies Client API keys.
 *
 * The plaintext secret is onlyreturned at creation time. The database stores
 * `key_prefix` (for display) and a SHA-256 hash of a versioned input string.
 * Authentication is timing-safe and intentionally does not differentiate between
 * unknown key, revoked key, expired key, disabled client and disabled account.
 */
export class ClientApiKeyService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  create(input:CreateClientApiKeyInput): CreatedClientApiKey {
    const accountId = requireNonEmpty(input.accountId);
    const clientId = requireNonEmpty(input.clientId);
    const now = input.now ?? Date.now();
    const name = normalizeOptionalName(input.name ?? null);
    const expiresAt = normalizeExpiration(input.expiresAt ?? null, now);

    this.ensureActiveClient(accountId, clientId);

    const { secret, prefix, hash } = generateSecretBundle();

    const inserted = this.db
      .insert(clientApiKeys)
      .values({
        id: `cak_${nanoid()}`,
        accountId,
        clientId,
        name,
        keyPrefix: prefix,
        keyHash: hash,
        status: "active",
        lastUsedAt: null,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    return{ apiKey: mapApiKeyRow(inserted), secret };
  }

  list(input: ListClientApiKeysInput): ClientApiKeyListResult {
    const accountId = requireNonEmpty(input.accountId);
    const clientId = requireNonEmpty(input.clientId);
    const limit = clampInteger(input.limit ?? DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
   const cursor = decodeCursor(input.cursor);

    this.ensureClientOwnership(accountId, clientId);

 const filters: SQL[] = [
      eq(clientApiKeys.accountId, accountId),
      eq(clientApiKeys.clientId, clientId),
    ];
    if (input.status) {
      filters.push(eq(clientApiKeys.status, input.status));
}
    if (cursor) {
      filters.push(
        or(
          lt(clientApiKeys.createdAt, cursor.createdAt),
          and(eq(clientApiKeys.createdAt, cursor.createdAt), lt(clientApiKeys.id, cursor.id)),
   ) as SQL,
      );
    }

    const rows = this.db
      .select()
      .from(clientApiKeys)
      .where(and(...filters))
      .orderBy(desc(clientApiKeys.createdAt), desc(clientApiKeys.id))
      .limit(limit + 1)
      .all();

    const hasMore = rows.length> limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;
    const items = visible.map(mapApiKeyRow);
    const last = visible[visible.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null;

    return { items, nextCursor };
  }

  revoke(input: RevokeClientApiKeyInput): ClientApiKeyRecord {
    const accountId = requireNonEmpty(input.accountId);
    const clientId = requireNonEmpty(input.clientId);
    const apiKeyId = requireNonEmpty(input.apiKeyId);
   const now = input.now ?? Date.now();

    this.ensureClientOwnership(accountId, clientId);

    const existing = this.db
      .select()
      .from(clientApiKeys)
      .where(and(
        eq(clientApiKeys.id, apiKeyId),
     eq(clientApiKeys.accountId, accountId),
        eq(clientApiKeys.clientId, clientId),
      ))
      .limit(1)
      .get();

    if (!existing) {
      throw new ClientApiKeyServiceError(404, "client_api_key_not_found", "Client API key not found");
    }

    if (existing.status === "revoked") {
      return mapApiKeyRow(existing);
    }

    const updated = this.db
      .update(clientApiKeys)
      .set({ status: "revoked", updatedAt: now })
      .where(eq(clientApiKeys.id, existing.id))
      .returning()
      .get();

    return mapApiKeyRow(updated);
  }

  authenticate(secret: string, now: number = Date.now()): ClientApiKeyAuthResult {
    if (typeof secret !== "string" || !secret.startsWith(SECRET_PREFIX)) {
      throw invalidApiKey();
    }

    const hash = computeHash(secret);
    const row = this.db
      .select({
        id: clientApiKeys.id,
        accountId:clientApiKeys.accountId,
        clientId: clientApiKeys.clientId,
        keyHash: clientApiKeys.keyHash,
        status: clientApiKeys.status,
        lastUsedAt: clientApiKeys.lastUsedAt,
        expiresAt: clientApiKeys.expiresAt,
      })
      .from(clientApiKeys)
      .where(eq(clientApiKeys.keyHash, hash))
      .limit(1)
      .get();

    if (!row) {
      throw invalidApiKey();
    }

    if (!timingSafeStringEqual(row.keyHash, hash)) {
      throw invalidApiKey();
    }

    if (row.status !== "active") {
      throw invalidApiKey();
    }

    if (row.expiresAt !== null && row.expiresAt <= now) {
      throw invalidApiKey();
    }

    const clientRow = this.db
      .select({
        id: clients.id,
        accountId: clients.accountId,
        status: clients.status,
        kind: clients.kind,
        isDefault: clients.isDefault,
      })
      .from(clients)
      .where(eq(clients.id, row.clientId))
      .limit(1)
      .get();

    if (!clientRow || clientRow.status !== "active") {
      throw invalidApiKey();
    }

    if (clientRow.accountId !== row.accountId) {
      throw invalidApiKey();
    }

    const accountRow = this.db
      .select({ id: accounts.id, status: accounts.status })
      .from(accounts)
      .where(eq(accounts.id, row.accountId))
      .limit(1)
      .get();

    if (!accountRow || accountRow.status !== "active") {
      throw invalidApiKey();
    }

    if (row.lastUsedAt === null || now - row.lastUsedAt >= LAST_USED_THROTTLE_MS) {
      this.db
        .update(clientApiKeys)
        .set({ lastUsedAt: now })
        .where(eq(clientApiKeys.id, row.id))
        .run();
    }

    return {
      accountId: row.accountId,
    clientId: row.clientId,
      apiKeyId: row.id,
      clientKind: clientRow.kind,
      isDefaultClient: clientRow.isDefault,
    };
  }

  private ensureActiveClient(accountId: string, clientId: string): void {
    const row = this.db
      .select({ id: clients.id, accountId: clients.accountId, status: clients.status })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1)
      .get();

    if (!row || row.accountId !== accountId) {
      throw new ClientApiKeyServiceError(404, "client_not_found", `Client not found: ${clientId}`);
    }

    if (row.status !== "active") {
      throw new ClientApiKeyServiceError(409, "client_disabled", `Client is disabled: ${clientId}`);
    }
  }

  private ensureClientOwnership(accountId: string, clientId: string): void{
    const row = this.db
      .select({ id: clients.id, accountId: clients.accountId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1)
      .get();

 if (!row || row.accountId!== accountId) {
      throw new ClientApiKeyServiceError(404, "client_not_found", `Client not found: ${clientId}`);
    }
  }
}

function generateSecretBundle(): { secret: string; prefix: string; hash: string } {
  const random = randomBytes(32).toString("base64url");
  const secret = `${SECRET_PREFIX}${random}`;
  const prefix = secret.slice(0, KEY_PREFIX_LENGTH);
  const hash = computeHash(secret);
  return { secret, prefix, hash };
}

function computeHash(secret: string): string{
  return createHash("sha256").update(`${HASH_VERSION_PREFIX}${secret}`).digest("hex");
}

function mapApiKeyRow(row: typeof clientApiKeys.$inferSelect): ClientApiKeyRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    clientId: row.clientId,
    name: row.name,
    keyPrefix: row.keyPrefix,
    status: row.status as ClientApiKeyStatus,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeOptionalName(name: string | null): string | null {
  if (name === null || name === undefined) {
    return null;
  }
  if (typeof name !== "string") {
    return null;
  }
  const trimmed= name.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new ClientApiKeyServiceError(
      400,
      "client_api_key_name_too_long",
      `Client API key name must notexceed ${MAX_NAME_LENGTH} characters`,
  );
  }
  return trimmed;
}

function normalizeExpiration(value: number | null, now: number): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ClientApiKeyServiceError(
      400,
   "client_api_key_expires_at_invalid",
      "Client API key expires_at must be an integer timestamp",
    );
  }
  if (value <= now) {
    throw new ClientApiKeyServiceError(
      400,
      "client_api_key_expires_at_invalid",
      "Client API key expires_at must be greater than the creation timestamp",
    );
  }
  return value;
}

function requireNonEmpty(value: string): string {
  if (typeof value !== "string") {
    throw new ClientApiKeyServiceError(400,"client_api_key_not_found", "Field is required");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ClientApiKeyServiceError(400, "client_api_key_not_found", "Field is required");
  }
 return trimmed;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  const integer = Math.trunc(value);
  return Math.min(max, Math.max(min, integer));
}

function invalidApiKey(): ClientApiKeyServiceError {
  return new ClientApiKeyServiceError(401, "client_api_key_invalid", "Client API key is invalid");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export type ClientApiKeyListCursor = { createdAt: number; id: string };

export function encodeCursor(value: ClientApiKeyListCursor): string {
  return Buffer.from(JSON.stringify({ created_at:value.createdAt, id: value.id }), "utf-8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined | null): ClientApiKeyListCursor | null {
  if (!cursor) {
    return null;
  }
  const normalized = cursor.trim();
  if (normalized.length === 0) {
    return null;
  }
  try {
    const raw = JSON.parse(Buffer.from(normalized, "base64url").toString("utf-8")) as Record<string, unknown>;
    const createdAt = raw.created_at;
    const id = raw.id;
    if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || typeof id !== "string" || id.length === 0) {
      throw new ClientApiKeyServiceError(400, "client_api_key_cursor_invalid", "Client API key cursor is invalid");
    }
    return { createdAt: Math.trunc(createdAt), id };
  } catch (error){
    if (error instanceof ClientApiKeyServiceError) {
      throw error;
    }
    throw new ClientApiKeyServiceError(400, "client_api_key_cursor_invalid", "Client API key cursor is invalid");
  }
}

export { ClientServiceError as ClientReferenceError };

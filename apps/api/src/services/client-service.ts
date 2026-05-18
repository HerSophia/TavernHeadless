import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { clients } from "../db/schema.js";

export type ClientKind = "basic" | "advanced" | "deriver" | "worker" | "custom";
export type ClientStatus = "active" | "disabled";

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

export type ClientListResult = {
  items: ClientRecord[];
  nextCursor: string | null;
};

export type ClientServiceErrorCode =
  | "client_name_required"
  | "client_name_too_long"
  | "client_kind_invalid"
  | "client_metadata_invalid"
  | "client_metadata_too_large"
  | "client_not_found"
  | "client_default_disable_not_supported"
  | "client_cursor_invalid"
  | "client_account_required";

export class ClientServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409 | 413,
    public readonly code: ClientServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ClientServiceError";
  }
}

export type EnsureDefaultClientInput = {
  accountId: string;
  name?: string;
  metadata?: unknown;
  now?: number;
};

export type CreateClientInput = {
  accountId: string;
  name: string;
  kind?: ClientKind;
  metadata?: unknown;
  now?: number;
};

export type ListClientsInput = {
  accountId: string;
  status?:ClientStatus;
  kind?: ClientKind;
  limit?: number;
  cursor?: string;
};

export type GetClientInput = {
  accountId: string;
  clientId: string;
};

export type UpdateClientInput = {
  accountId: string;
  clientId: string;
  name?: string;
  kind?: ClientKind;
  metadata?: unknown;
  now?: number;
};

export type DisableClientInput = {
  accountId: string;
  clientId: string;
  now?: number;
};

export type EnableClientInput = {
  accountId: string;
  clientId: string;
  now?: number;
};

const MAX_NAME_LENGTH = 120;
const MAX_METADATA_BYTES = 16 * 1024;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const CLIENT_KINDS: ReadonlyArray<ClientKind> = [
  "basic",
  "advanced",
  "deriver",
  "worker",
  "custom",
];

/**
 * Manages Client identity records.
 *
 * Clients represent first-party callers (UI,scripts, downstream services) inside
 * a single account. A Client is notan Account; permissions and quotas are tracked
 * separately. Default Clients are seeded by startup repair using deterministic IDs.
 */
export class ClientService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  ensureDefaultClient(input: EnsureDefaultClientInput): ClientRecord {
    const accountId = requireNonEmpty(input.accountId, "client_account_required");
    const now = input.now ?? Date.now();
    const defaultId = buildDefaultClientId(accountId);

    const existing = this.db
      .select()
      .from(clients)
      .where(eq(clients.id, defaultId))
      .limit(1)
      .get();

    if (existing) {
      return mapClientRow(existing);
    }

   const name = normalizeName(input.name ?? "默认Client");
    const metadata = serializeMetadata(input.metadata ?? {});

    const inserted = this.db
      .insert(clients)
      .values({
        id: defaultId,
        accountId,
        name,
        kind: "custom",
        status: "active",
        isDefault: true,
        metadataJson: metadata,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    return mapClientRow(inserted);
  }

  create(input: CreateClientInput): ClientRecord {
    const accountId = requireNonEmpty(input.accountId, "client_account_required");
    const now = input.now ?? Date.now();
    const name = normalizeName(input.name);
    const kind = normalizeKind(input.kind ?? "custom");
    const metadata = serializeMetadata(input.metadata ?? {});

    const inserted = this.db
      .insert(clients)
      .values({
        id: `cli_${nanoid()}`,
        accountId,
        name,
        kind,
        status: "active",
        isDefault: false,
        metadataJson: metadata,
        createdAt: now,
        updatedAt: now,
      })
 .returning()
      .get();

    return mapClientRow(inserted);
  }

  list(input: ListClientsInput): ClientListResult {
    const accountId = requireNonEmpty(input.accountId, "client_account_required");
    const limit = clampInteger(input.limit ?? DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
    const cursor = decodeCursor(input.cursor);

    const filters: SQL[] = [eq(clients.accountId, accountId)];
    if (input.status) {
      filters.push(eq(clients.status, input.status));
    }
    if (input.kind) {
      filters.push(eq(clients.kind, normalizeKind(input.kind)));
    }
    if (cursor) {
      filters.push(
        or(
          lt(clients.createdAt, cursor.createdAt),
          and(eq(clients.createdAt, cursor.createdAt), lt(clients.id, cursor.id)),
        ) as SQL,
      );
    }

    const rows = this.db
      .select()
      .from(clients)
      .where(and(...filters))
      .orderBy(desc(clients.createdAt), desc(clients.id))
   .limit(limit + 1)
      .all();

    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;
    const items = visible.map(mapClientRow);
    const last = visible[visible.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

    return { items, nextCursor };
  }

  getById(input: GetClientInput): ClientRecord {
    const row = this.loadOwnedClient(input.accountId, input.clientId);
    return mapClientRow(row);
  }

  update(input: UpdateClientInput): ClientRecord {
    const now = input.now ?? Date.now();
    const existing = this.loadOwnedClient(input.accountId, input.clientId);

    const patch: Partial<typeof clients.$inferInsert> ={ updatedAt: now };
    let touched = false;
    if (input.name !== undefined) {
    patch.name = normalizeName(input.name);
      touched = true;
    }
    if (input.kind !== undefined) {
      patch.kind = normalizeKind(input.kind);
      touched = true;
    }
    if (input.metadata !== undefined) {
      patch.metadataJson = serializeMetadata(input.metadata);
      touched = true;
    }

    if (!touched) {
      return mapClientRow(existing);
    }

    const updated = this.db
      .update(clients)
      .set(patch)
      .where(eq(clients.id, existing.id))
      .returning()
      .get();

    return mapClientRow(updated);
  }

  disable(input: DisableClientInput): ClientRecord {
    const now = input.now ?? Date.now();
    const existing = this.loadOwnedClient(input.accountId, input.clientId);

    if (existing.isDefault) {
      throw new ClientServiceError(
       409,
        "client_default_disable_not_supported",
        "Default client cannot be disabled",
      );
    }

    if (existing.status === "disabled") {
      return mapClientRow(existing);
   }

    const updated = this.db
      .update(clients)
      .set({ status: "disabled", updatedAt: now })
      .where(eq(clients.id, existing.id))
      .returning()
      .get();
    return mapClientRow(updated);
  }

  enable(input: EnableClientInput): ClientRecord {
    const now = input.now ?? Date.now();
    const existing = this.loadOwnedClient(input.accountId, input.clientId);

    if (existing.status === "active") {
      return mapClientRow(existing);
    }

    const updated = this.db
      .update(clients)
      .set({status: "active", updatedAt: now })
      .where(eq(clients.id, existing.id))
      .returning()
      .get();
    return mapClientRow(updated);
  }

  private loadOwnedClient(accountId: string, clientId: string): typeof clients.$inferSelect {
    const normalizedAccountId = requireNonEmpty(accountId, "client_account_required");
    const normalizedClientId = requireNonEmpty(clientId, "client_not_found");

    const row = this.db
      .select()
      .from(clients)
      .where(and(eq(clients.id, normalizedClientId), eq(clients.accountId, normalizedAccountId)))
      .limit(1)
      .get();

    if (!row) {
      throw new ClientServiceError(404, "client_not_found", `Client not found: ${normalizedClientId}`);
    }
    return row;
  }
}

export function buildDefaultClientId(accountId: string): string {
  return `cli_default_${accountId}`;
}

export function mapClientRow(row:typeof clients.$inferSelect): ClientRecord {
  return {
    id: row.id,
   accountId: row.accountId,
    name: row.name,
    kind: row.kind as ClientKind,
    status: row.status as ClientStatus,
    isDefault: row.isDefault,
    metadata: parseMetadata(row.metadataJson),
    createdAt:row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeName(name: string): string{
  if (typeof name !== "string") {
    throw new ClientServiceError(400, "client_name_required", "Client name must be a string");
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ClientServiceError(400, "client_name_required", "Client name must not be empty");
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
 throw new ClientServiceError(
      400,
    "client_name_too_long",
   `Client name must not exceed${MAX_NAME_LENGTH} characters`,
    );
  }
return trimmed;
}

function normalizeKind(kind: ClientKind | string): ClientKind {
  if (typeof kind !== "string") {
    throw new ClientServiceError(400, "client_kind_invalid", "Client kind is invalid");
}
  const trimmed = kind.trim() as ClientKind;
  if (!CLIENT_KINDS.includes(trimmed)) {
    throw new ClientServiceError(400, "client_kind_invalid", `Unsupported client kind: ${kind}`);
  }
  return trimmed;
}

function serializeMetadata(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value ?? {});
  } catch {
    throw new ClientServiceError(400, "client_metadata_invalid", "Client metadata is notJSON serializable");
  }
  const byteCount = Buffer.byteLength(json, "utf-8");
  if (byteCount > MAX_METADATA_BYTES) {
    throw new ClientServiceError(
      413,
      "client_metadata_too_large",
      `Client metadata exceeds ${MAX_METADATA_BYTES} bytes`,
    );
  }
  return json;
}

function parseMetadata(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

function requireNonEmpty(value: string, code: ClientServiceErrorCode): string {
  if (typeof value !== "string") {
    throw new ClientServiceError(400, code, `Field is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ClientServiceError(400, code, `Field is required`);
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

export type ClientListCursor = { createdAt: number; id: string };

export function encodeCursor(value: ClientListCursor): string {
  return Buffer.from(JSON.stringify({ created_at: value.createdAt, id: value.id }), "utf-8").toString("base64url");
}

export function decodeCursor(cursor: string| undefined | null): ClientListCursor | null {
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
    if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || typeof id !== "string" || id.length === 0){
      throw new ClientServiceError(400, "client_cursor_invalid", "Client list cursor is invalid");
    }
    return { createdAt: Math.trunc(createdAt), id };
  } catch (error) {
    if (error instanceof ClientServiceError) {
      throw error;
    }
    throw new ClientServiceError(400, "client_cursor_invalid", "Client list cursor is invalid");
  }
}

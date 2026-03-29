import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import { compactObject, readArray, readBoolean, readNumber, readRecord, readString } from "./utils.js";

export type AccountRole = "admin" | "user";
export type AccountStatus = "active" | "disabled";

export type AccountRecord = {
  createdAt: number;
  id: string;
  isDefault: boolean;
  name: string;
  role: AccountRole;
  status: AccountStatus;
  updatedAt: number;
};

export type AccountDetail = AccountRecord;

export type AccountsResource = {
  create(options: {
    accountId?: AccountIdHint;
    id?: string;
    name: string;
    role?: AccountRole;
  }): Promise<AccountRecord>;
  getDetail(options: { accountId?: AccountIdHint; accountRecordId: string }): Promise<AccountDetail>;
  list(options?: { accountId?: AccountIdHint }): Promise<AccountRecord[]>;
  remove(options: { accountId?: AccountIdHint; accountRecordId: string }): Promise<boolean>;
  update(options: {
    accountId?: AccountIdHint;
    accountRecordId: string;
    name?: string;
    role?: AccountRole;
    status?: AccountStatus;
  }): Promise<AccountDetail>;
};

export function createAccountsResource(client: TransportClient): AccountsResource {
  return {
    async create(options): Promise<AccountRecord> {
      const response = await client.fetchJson<Record<string, unknown>>("/accounts", {
        body: compactObject({
          id: options.id,
          name: options.name,
          role: options.role,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "POST",
      });

      const payload = mapAccountRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Account create returned an invalid payload");
      }

      return payload;
    },
    async getDetail(options): Promise<AccountDetail> {
      const response = await client.fetchJson<Record<string, unknown>>(`/accounts/${encodeURIComponent(options.accountRecordId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapAccountRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Account detail returned an invalid payload");
      }

      return payload;
    },
    async list(options = {}): Promise<AccountRecord[]> {
      const response = await client.fetchJson<Record<string, unknown>>("/accounts", {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      return readArray(readRecord(response.body)?.data)
        .map(mapAccountRecord)
        .filter((item): item is AccountRecord => item !== null);
    },
    async remove(options): Promise<boolean> {
      const response = await client.fetchJson<Record<string, unknown>>(`/accounts/${encodeURIComponent(options.accountRecordId)}`, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      return readBoolean(readRecord(readRecord(response.body)?.data)?.deleted, response.status === 200);
    },
    async update(options): Promise<AccountDetail> {
      const response = await client.fetchJson<Record<string, unknown>>(`/accounts/${encodeURIComponent(options.accountRecordId)}`, {
        body: compactObject({
          name: options.name,
          role: options.role,
          status: options.status,
        }),
        headers: buildAccountHeaders(options.accountId),
        method: "PATCH",
      });

      const payload = mapAccountRecord(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Account update returned an invalid payload");
      }

      return payload;
    },
  };
}

function mapAccountRecord(value: unknown): AccountRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    createdAt: readNumber(record.created_at),
    id: readString(record.id),
    isDefault: readBoolean(record.is_default),
    name: readString(record.name),
    role: readString(record.role, "user") as AccountRole,
    status: readString(record.status, "active") as AccountStatus,
    updatedAt: readNumber(record.updated_at),
  };
}

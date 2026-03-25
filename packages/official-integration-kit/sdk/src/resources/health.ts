import type { TransportClient } from "../client/transport.js";
import { readRecord, readString } from "./utils.js";

export type HealthStatus = {
  database: string | null;
  service: string | null;
};

export type HealthResource = {
  get(): Promise<HealthStatus>;
};

export function createHealthResource(client: TransportClient): HealthResource {
  return {
    async get(): Promise<HealthStatus> {
      const response = await client.get("/health");
      const body = readRecord(response.body);

      return {
        database: body ? readString(body.database, "") || null : null,
        service: body ? readString(body.service, "") || null : null,
      };
    },
  };
}

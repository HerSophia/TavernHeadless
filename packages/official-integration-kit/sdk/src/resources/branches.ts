import { buildAccountHeaders, type TransportClient } from "../client/transport.js";
import { buildQueryString, readNumber, readRecord, readString } from "./utils.js";

export type BranchDeleteResult = {
  branchId: string;
  deletedFloorCount: number;
  sessionId: string;
};

export type BranchesRemoveOptions = {
  accountId?: string;
  branchId: string;
  sessionId?: string;
};

export type BranchesResource = {
  remove(options: BranchesRemoveOptions): Promise<BranchDeleteResult>;
};

export function createBranchesResource(client: TransportClient): BranchesResource {
  return {
    async remove(options): Promise<BranchDeleteResult> {
      const query = buildQueryString({
        session_id: options.sessionId,
      });
      const pathname = query
        ? `/branches/${encodeURIComponent(options.branchId)}?${query}`
        : `/branches/${encodeURIComponent(options.branchId)}`;
      const response = await client.fetchJson<Record<string, unknown>>(pathname, {
        headers: buildAccountHeaders(options.accountId),
        method: "DELETE",
      });

      const data = readRecord(readRecord(response.body)?.data);

      return {
        branchId: readString(data?.branch_id),
        deletedFloorCount: readNumber(data?.deleted_floor_count),
        sessionId: readString(data?.session_id),
      };
    },
  };
}

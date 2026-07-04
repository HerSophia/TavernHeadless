import { describe, expect, it } from "vitest";

import type {
  NodeGraphRunEnqueueResponse,
  NodeGraphRunRecordResponse,
} from "../../../lib/nodegraph-api/types";
import {
  createIdleRunState,
  isTerminalRunStatus,
  mapRunRecordStatusToUiStatus,
  mapRunRecordToNodeStatusById,
  readJobIdFromRunResponse,
  readRunIdFromRunResponse,
  readRunRecord,
  summarizeNodeRunStatuses,
} from "./graph-run-view";

function makeRunRecordResponse(
  overrides: Partial<NodeGraphRunRecordResponse> = {},
): NodeGraphRunRecordResponse {
  return {
    run: {
      id: "ngrun_1",
      graph_id: "g1",
      graph_version_id: "v1",
      status: "succeeded",
      intent: "dry_run",
      session_id: null,
      floor_id: null,
      page_id: null,
      trace: null,
      cleaned_at: null,
      created_at: 1,
      updated_at: 2,
    },
    node_runs: [],
    restricted: true,
    ...overrides,
  };
}

describe("graph-run-view", () => {
  describe("createIdleRunState", () => {
    it("returns an idle state with empty node status map", () => {
      const state = createIdleRunState();
      expect(state.status).toBe("idle");
      expect(state.nodeStatusById).toEqual({});
    });
  });

  describe("readRunIdFromRunResponse / readJobIdFromRunResponse", () => {
    it("reads job id when run only has job_id (current backend contract)", () => {
      const response: NodeGraphRunEnqueueResponse = {
        job_id: "job_1",
        created: true,
        dedupe_key: null,
        graph_id: "g1",
        graph_version_id: "v1",
        worker_enabled: false,
      };
      expect(readJobIdFromRunResponse(response)).toBe("job_1");
      expect(readRunIdFromRunResponse(response)).toBeNull();
    });

    it("readsrun id when backend provides run_id", () => {
      const response: NodeGraphRunEnqueueResponse = {
        job_id: "job_1",
        created: true,
       dedupe_key: null,
        graph_id: "g1",
        graph_version_id: "v1",
        worker_enabled: true,
        run_id: "ngrun_9",
      };
      expect(readRunIdFromRunResponse(response)).toBe("ngrun_9");
    });

    it("handles null / empty safely", () => {
      expect(readRunIdFromRunResponse(null)).toBeNull();
      expect(readJobIdFromRunResponse(undefined)).toBeNull();
    });
  });

  describe("mapRunRecordToNodeStatusById", () => {
    it("returns empty object for empty response", () => {
      expect(mapRunRecordToNodeStatusById(null)).toEqual({});
      expect(mapRunRecordToNodeStatusById(makeRunRecordResponse())).toEqual({});
    });

    it("maps node_runs arrayto status by node id", () => {
      const response = makeRunRecordResponse({
        node_runs: [
          {
            id: "nr1",
            graph_run_id: "ngrun_1",
            node_id: "n_a",
            phase: "pre_response",
            status: "succeeded",
            input_hash: null,
            output_hash: null,
            started_at: 1,
            finished_at: 2,
          },
          {
            id: "nr2",
            graph_run_id: "ngrun_1",
            node_id: "n_b",
            phase: "commit",
            status: "failed",
            input_hash: null,
            output_hash: null,
            started_at: 3,
            finished_at: 4,
          },
        ],
      });
      expect(mapRunRecordToNodeStatusById(response)).toEqual({
  n_a: "succeeded",
        n_b: "failed",
      });
    });

    it("ignores node runs with invalid status or missing node id", () => {
      const response = makeRunRecordResponse({
        node_runs: [
          {
            id: "nr1",
            graph_run_id: "ngrun_1",
            node_id: "n_a",
            phase: "pre_response",
            status: "bogus",
            input_hash: null,
            output_hash: null,
            started_at: 1,
            finished_at: 2,
          },
          {
            id: "nr2",
            graph_run_id: "ngrun_1",
            node_id: "",
            phase: "commit",
            status: "succeeded",
            input_hash: null,
            output_hash: null,
            started_at: 3,
            finished_at: 4,
          },
          {
            id: "nr3",
            graph_run_id: "ngrun_1",
            node_id: "n_c",
            phase: "commit",
            status: "reused",
            input_hash: null,
            output_hash: null,
            started_at: 5,
            finished_at: 6,
          },
        ],
      });
      expect(mapRunRecordToNodeStatusById(response)).toEqual({ n_c: "reused" });
    });

    it("later node run overrides earlier one for the same nodeid", () => {
      const response = makeRunRecordResponse({
        node_runs: [
          {
            id: "nr1",
            graph_run_id: "ngrun_1",
            node_id: "n_a",
            phase: "pre_response",
            status: "running",
            input_hash: null,
       output_hash: null,
            started_at: 1,
            finished_at: null,
          },
          {
            id: "nr2",
            graph_run_id: "ngrun_1",
            node_id: "n_a",
            phase: "commit",
            status: "succeeded",
            input_hash: null,
            output_hash: null,
            started_at: 2,
            finished_at: 3,
     },
        ],
      });
      expect(mapRunRecordToNodeStatusById(response)).toEqual({ n_a: "succeeded" });
    });

    it("falls back to trace node runs when node_runs is empty", () => {
      const response = makeRunRecordResponse({
        node_runs: [],
        run: {
          ...makeRunRecordResponse().run,
          trace: {
            nodeRuns: [
              { nodeId: "n_x", status: "succeeded" },
              { node_id: "n_y", status: "skipped" },
              { nodeId: "n_z", status: "invalid" },
            ],
          },
        },
      });
      expect(mapRunRecordToNodeStatusById(response)).toEqual({
        n_x: "succeeded",
        n_y: "skipped",
      });
    });

    it("returns empty object for unknown trace shape", () => {
      const response = makeRunRecordResponse({
        node_runs: [],
        run: {
          ...makeRunRecordResponse().run,
          trace: { something: "else" },
        },
      });
      expect(mapRunRecordToNodeStatusById(response)).toEqual({});
    });
  });

  describe("summarizeNodeRunStatuses", () => {
    it("counts statuses", () => {
      const summary = summarizeNodeRunStatuses({
        n_a: "succeeded",
        n_b: "succeeded",
        n_c: "failed",
     n_d: "running",
        n_e: "skipped",
        n_f: "reused",
      });
      expect(summary).toEqual({
        total: 6,
        running: 1,
        succeeded: 2,
        failed: 1,
        skipped: 1,
        reused: 1,
      });
    });

    it("returns zeroed summary for empty map", () => {
      expect(summarizeNodeRunStatuses({})).toEqual({
total: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        reused: 0,
      });
    });
  });

  describe("mapRunRecordStatusToUiStatus", () => {
    it("maps known statuses", () => {
      expect(mapRunRecordStatusToUiStatus("succeeded")).toBe("succeeded");
      expect(mapRunRecordStatusToUiStatus("failed")).toBe("failed");
      expect(mapRunRecordStatusToUiStatus("cancelled")).toBe("cancelled");
      expect(mapRunRecordStatusToUiStatus("running")).toBe("running");
    });

    it("falls back to running for unknown status", () => {
      expect(mapRunRecordStatusToUiStatus("weird")).toBe("running");
      expect(mapRunRecordStatusToUiStatus(null)).toBe("running");
      expect(mapRunRecordStatusToUiStatus(undefined)).toBe("running");
    });
  });

  describe("isTerminalRunStatus", () => {
    it("recognizes terminal statuses", () => {
      expect(isTerminalRunStatus("succeeded")).toBe(true);
      expect(isTerminalRunStatus("failed")).toBe(true);
      expect(isTerminalRunStatus("cancelled")).toBe(true);
      expect(isTerminalRunStatus("running")).toBe(false);
     expect(isTerminalRunStatus(null)).toBe(false);
    });
  });

  describe("readRunRecord", () => {
    it("returns run body when present", () => {
      const response = makeRunRecordResponse();
      expect(readRunRecord(response)?.id).toBe("ngrun_1");
    });

    it("returns null when run is missing", () => {
      expect(readRunRecord(null)).toBeNull();
    });
  });
});

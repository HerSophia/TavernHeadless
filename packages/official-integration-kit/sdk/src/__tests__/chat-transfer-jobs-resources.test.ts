import { describe, expect, it, vi } from "vitest";

import { createTransportClient } from "../client/transport.js";
import { createChatTransferJobsResource } from "../resources/chat-transfer-jobs.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk chat transfer jobs resource", () => {
  it("lists, gets detail, retries, cancels, and downloads artifacts", async () => {
    const jobPayload = {
      id: "ctj-export-1",
      job_kind: "export_chat",
      format: "thchat",
      status: "succeeded",
      phase: "completed",
      requested_session_id: "session-1",
      result_session_id: null,
      request: {
        sessionId: "session-1",
        format: "thchat",
        includeVariables: true,
        includeMemories: true,
      },
      result: {
        fileName: "Campfire Scene.thchat",
        contentType: "application/json; charset=utf-8",
        byteLength: 2048,
      },
      input_artifact_path: null,
      normalized_artifact_path: null,
      output_artifact_path: "ctj-export-1/output.thchat",
      output_expires_at: 300,
      progress_current: 4,
      progress_total: 4,
      progress_message: "completed",
      attempt_count: 1,
      max_attempts: 5,
      available_at: 100,
      lease_owner: null,
      lease_until: null,
      last_error: null,
      created_at: 100,
      updated_at: 200,
      finished_at: 200,
    };

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [jobPayload],
          meta: {
            has_more: false,
            limit: 10,
            offset: 0,
            sort_by: "updated_at",
            sort_order: "asc",
            total: 1,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: jobPayload }))
      .mockResolvedValueOnce(jsonResponse({ data: { job_id: "ctj-dead-1", status: "retry_waiting" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { job_id: "ctj-pending-1", status: "cancelled" } }))
      .mockResolvedValueOnce(
        new Response("artifact-body", {
          headers: {
            "content-disposition": 'attachment; filename="Campfire Scene.thchat"',
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const chatTransferJobs = createChatTransferJobsResource(transport);

    await expect(
      chatTransferJobs.list({
        accountId: "acc-1",
        availableFrom: 50,
        availableTo: 500,
        createdFrom: 10,
        createdTo: 600,
        format: "thchat",
        jobKind: "export_chat",
        limit: 10,
        offset: 0,
        requestedSessionId: "session-1",
        sortBy: "updated_at",
        sortOrder: "asc",
        status: "succeeded",
      }),
    ).resolves.toEqual({
      jobs: [
        {
          attemptCount: 1,
          availableAt: 100,
          createdAt: 100,
          finishedAt: 200,
          format: "thchat",
          id: "ctj-export-1",
          inputArtifactPath: null,
          jobKind: "export_chat",
          lastError: null,
          leaseOwner: null,
          leaseUntil: null,
          maxAttempts: 5,
          normalizedArtifactPath: null,
          outputArtifactPath: "ctj-export-1/output.thchat",
          outputExpiresAt: 300,
          phase: "completed",
          progressCurrent: 4,
          progressMessage: "completed",
          progressTotal: 4,
          request: {
            sessionId: "session-1",
            format: "thchat",
            includeVariables: true,
            includeMemories: true,
          },
          requestedSessionId: "session-1",
          result: {
            fileName: "Campfire Scene.thchat",
            contentType: "application/json; charset=utf-8",
            byteLength: 2048,
          },
          resultSessionId: null,
          status: "succeeded",
          updatedAt: 200,
        },
      ],
      meta: {
        hasMore: false,
        limit: 10,
        offset: 0,
        sortBy: "updated_at",
        sortOrder: "asc",
        total: 1,
      },
    });

    await expect(chatTransferJobs.getDetail({ accountId: "acc-1", jobId: "ctj-export-1" })).resolves.toEqual({
      attemptCount: 1,
      availableAt: 100,
      createdAt: 100,
      finishedAt: 200,
      format: "thchat",
      id: "ctj-export-1",
      inputArtifactPath: null,
      jobKind: "export_chat",
      lastError: null,
      leaseOwner: null,
      leaseUntil: null,
      maxAttempts: 5,
      normalizedArtifactPath: null,
      outputArtifactPath: "ctj-export-1/output.thchat",
      outputExpiresAt: 300,
      phase: "completed",
      progressCurrent: 4,
      progressMessage: "completed",
      progressTotal: 4,
      request: {
        sessionId: "session-1",
        format: "thchat",
        includeVariables: true,
        includeMemories: true,
      },
      requestedSessionId: "session-1",
      result: {
        fileName: "Campfire Scene.thchat",
        contentType: "application/json; charset=utf-8",
        byteLength: 2048,
      },
      resultSessionId: null,
      status: "succeeded",
      updatedAt: 200,
    });

    await expect(chatTransferJobs.retry({ accountId: "acc-1", jobId: "ctj-dead-1" })).resolves.toEqual({
      jobId: "ctj-dead-1",
      status: "retry_waiting",
    });

    await expect(chatTransferJobs.cancel({ accountId: "acc-1", jobId: "ctj-pending-1" })).resolves.toEqual({
      jobId: "ctj-pending-1",
      status: "cancelled",
    });

    const downloadResponse = await chatTransferJobs.downloadFile({ accountId: "acc-1", jobId: "ctj-export-1" });
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-disposition")).toBe('attachment; filename="Campfire Scene.thchat"');
    expect(await downloadResponse.text()).toBe("artifact-body");

    const [listUrl, listInit] = fetchImpl.mock.calls[0]!;
    const listRequestUrl = new URL(listUrl as string);
    expect(listRequestUrl.pathname).toBe("/chat-transfer-jobs");
    expect(listRequestUrl.searchParams.get("available_from")).toBe("50");
    expect(listRequestUrl.searchParams.get("available_to")).toBe("500");
    expect(listRequestUrl.searchParams.get("created_from")).toBe("10");
    expect(listRequestUrl.searchParams.get("created_to")).toBe("600");
    expect(listRequestUrl.searchParams.get("format")).toBe("thchat");
    expect(listRequestUrl.searchParams.get("job_kind")).toBe("export_chat");
    expect(listRequestUrl.searchParams.get("limit")).toBe("10");
    expect(listRequestUrl.searchParams.get("offset")).toBe("0");
    expect(listRequestUrl.searchParams.get("requested_session_id")).toBe("session-1");
    expect(listRequestUrl.searchParams.get("sort_by")).toBe("updated_at");
    expect(listRequestUrl.searchParams.get("sort_order")).toBe("asc");
    expect(listRequestUrl.searchParams.get("status")).toBe("succeeded");
    expect((listInit?.headers as Headers).get("x-account-id")).toBe("acc-1");

    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/chat-transfer-jobs/ctj-export-1");
    expect(String(fetchImpl.mock.calls[2]![0])).toBe("http://localhost:3000/chat-transfer-jobs/ctj-dead-1/retry");
    expect(String(fetchImpl.mock.calls[3]![0])).toBe("http://localhost:3000/chat-transfer-jobs/ctj-pending-1/cancel");
    expect(String(fetchImpl.mock.calls[4]![0])).toBe("http://localhost:3000/chat-transfer-jobs/ctj-export-1/file");
  });
});

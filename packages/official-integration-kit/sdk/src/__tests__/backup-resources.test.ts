import { describe, expect, it, vi } from "vitest";

import { createTransportClient } from "../client/transport.js";
import { createBackupJobsResource } from "../resources/backup-jobs.js";
import { createBackupResource } from "../resources/backup.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function createBackupFile() {
  return {
    spec: "tavern_headless_backup",
    spec_version: "1.0.0",
    backup_kind: "account_core_assets",
    created_at: 1735689600000,
    source: {
      account_id: "account-1",
      app_version: "0.2.0-beta.3",
    },
    included_domains: ["characters", "worldbooks", "sessions"],
    options: {
      include_secrets: false,
    },
    resources: {
      characters: [],
      worldbooks: [],
    },
    sessions: [],
    extensions: {
      secrets: {
        mode: "excluded",
      },
    },
  } as const;
}

function createCounts() {
  return {
    branch_local_variable_snapshots: 1,
    character_versions: 2,
    characters: 1,
    floors: 3,
    memory_edges: 5,
    memory_items: 4,
    messages: 7,
    pages: 6,
    session_branches: 2,
    sessions: 1,
    variables: 8,
    worldbook_entries: 9,
    worldbooks: 1,
  } as const;
}

describe("sdk backup resources", () => {
  it("creates export jobs, previews restore, and creates restore jobs", async () => {
    const backupFile = createBackupFile();
    const counts = createCounts();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            job_id: "backup-job-export-1",
            job_kind: "export_core_assets",
            status: "pending",
            phase: "queued",
          },
        }, 202),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            backup_kind: "account_core_assets",
            restore_mode: "create_copy",
            included_domains: ["characters", "worldbooks", "sessions"],
            counts,
            will_create: {
              characters: 1,
              worldbooks: 1,
              sessions: 1,
            },
            renamed_resources: [
              {
                type: "session",
                old_name: "Story A",
                new_name: "Story A (restored)",
              },
            ],
            dropped_bindings: {
              users: 1,
              presets: 1,
              regex_profiles: 1,
            },
            warnings: [
              {
                code: "restore_drops_user_binding",
                message: "1 个 session 的 user 绑定将在 restore 时清空",
                session_id: "session-1",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            job_id: "backup-job-restore-1",
            job_kind: "restore_core_assets",
            status: "pending",
            phase: "queued",
          },
        }, 202),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const backup = createBackupResource(transport);

    await expect(
      backup.createExportJob({
        accountId: "acc-1",
        includeLinkedAssets: false,
        sessionIds: ["session-1"],
      }),
    ).resolves.toEqual({
      jobId: "backup-job-export-1",
      jobKind: "export_core_assets",
      phase: "queued",
      status: "pending",
    });

    await expect(
      backup.previewRestore({
        accountId: "acc-1",
        data: backupFile,
        mode: "create_copy",
      }),
    ).resolves.toEqual({
      backupKind: "account_core_assets",
      counts: {
        branchLocalVariableSnapshots: 1,
        characterVersions: 2,
        characters: 1,
        floors: 3,
        memoryEdges: 5,
        memoryItems: 4,
        messages: 7,
        pages: 6,
        sessionBranches: 2,
        sessions: 1,
        variables: 8,
        worldbookEntries: 9,
        worldbooks: 1,
      },
      droppedBindings: {
        presets: 1,
        regexProfiles: 1,
        users: 1,
      },
      includedDomains: ["characters", "worldbooks", "sessions"],
      renamedResources: [
        {
          type: "session",
          oldName: "Story A",
          newName: "Story A (restored)",
        },
      ],
      restoreMode: "create_copy",
      warnings: [
        {
          code: "restore_drops_user_binding",
          message: "1 个 session 的 user 绑定将在 restore 时清空",
          sessionId: "session-1",
        },
      ],
      willCreate: {
        characters: 1,
        worldbooks: 1,
        sessions: 1,
      },
    });

    await expect(
      backup.createRestoreJob({
        accountId: "acc-1",
        data: backupFile,
        mode: "create_copy",
      }),
    ).resolves.toEqual({
      jobId: "backup-job-restore-1",
      jobKind: "restore_core_assets",
      phase: "queued",
      status: "pending",
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/backup/jobs/export");
    expect(fetchImpl.mock.calls[0]![1]?.body).toBe(JSON.stringify({
      include_linked_assets: false,
      session_ids: ["session-1"],
    }));

    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/backup/restore/preview");
    expect(fetchImpl.mock.calls[1]![1]?.body).toBe(JSON.stringify({
      data: backupFile,
      mode: "create_copy",
    }));

    expect(String(fetchImpl.mock.calls[2]![0])).toBe("http://localhost:3000/backup/jobs/restore");
    expect(fetchImpl.mock.calls[2]![1]?.body).toBe(JSON.stringify({
      data: backupFile,
      mode: "create_copy",
    }));
  });

  it("lists backup jobs, reads detail, retries, cancels, and downloads export files", async () => {
    const counts = createCounts();
    const restoreCreated = {
      ...counts,
      runtime_scope_states: 3,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "backup-job-export-1",
              job_kind: "export_core_assets",
              status: "succeeded",
              phase: "completed",
              request: {
                domains: null,
                session_ids: ["session-1"],
                character_ids: [],
                worldbook_ids: [],
                include_linked_assets: true,
                include_secrets: false,
              },
              result: {
                file_name: "core-assets-20250101-120000.thbackup",
                content_type: "application/json; charset=utf-8",
                byte_length: 2048,
                included_domains: ["characters", "worldbooks", "sessions"],
                counts,
              },
              output_artifact_path: "backup-job-export-1/output.thbackup",
              output_expires_at: 1735689700000,
              progress_current: 4,
              progress_total: 4,
              progress_message: "completed",
              attempt_count: 1,
              max_attempts: 5,
              available_at: 1735689600000,
              lease_owner: null,
              lease_until: null,
              last_error: null,
              created_at: 1735689600000,
              updated_at: 1735689650000,
              finished_at: 1735689650000,
            },
          ],
          meta: {
            total: 1,
            limit: 50,
            offset: 0,
            has_more: false,
            sort_by: "created_at",
            sort_order: "desc",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: "backup-job-restore-1",
            job_kind: "restore_core_assets",
            status: "dead_letter",
            phase: "finalizing",
            request: {
              mode: "create_copy",
              backup_kind: "account_core_assets",
              included_domains: ["sessions"],
              created_at: 1735689600000,
              source: {
                account_id: "account-1",
                app_version: "0.2.0-beta.3",
              },
            },
            result: {
              mode: "create_copy",
              created: restoreCreated,
              renamed_resources: [
                {
                  type: "character",
                  old_name: "Alice",
                  new_name: "Alice (restored)",
                },
              ],
              dropped_bindings: {
                users: 1,
                presets: 0,
                regex_profiles: 0,
              },
              warnings: [
                {
                  code: "restore_drops_user_binding",
                  message: "1 个 session 的 user 绑定将在 restore 时清空",
                },
              ],
            },
            output_artifact_path: null,
            output_expires_at: null,
            progress_current: 3,
            progress_total: 5,
            progress_message: "finalizing",
            attempt_count: 2,
            max_attempts: 3,
            available_at: 1735689605000,
            lease_owner: null,
            lease_until: null,
            last_error: "last error",
            created_at: 1735689600000,
            updated_at: 1735689660000,
            finished_at: 1735689660000,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            job_id: "backup-job-restore-1",
            status: "retry_waiting",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            job_id: "backup-job-export-1",
            status: "cancelled",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response("backup-payload", {
          headers: {
            "content-disposition": 'attachment; filename="core-assets.thbackup"',
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const backupJobs = createBackupJobsResource(transport);

    await expect(
      backupJobs.list({
        accountId: "acc-1",
        jobKind: "export_core_assets",
      }),
    ).resolves.toEqual({
      jobs: [
        {
          attemptCount: 1,
          availableAt: 1735689600000,
          createdAt: 1735689600000,
          finishedAt: 1735689650000,
          id: "backup-job-export-1",
          jobKind: "export_core_assets",
          lastError: null,
          leaseOwner: null,
          leaseUntil: null,
          maxAttempts: 5,
          outputArtifactPath: "backup-job-export-1/output.thbackup",
          outputExpiresAt: 1735689700000,
          phase: "completed",
          progressCurrent: 4,
          progressMessage: "completed",
          progressTotal: 4,
          request: {
            characterIds: [],
            domains: null,
            includeLinkedAssets: true,
            includeSecrets: false,
            sessionIds: ["session-1"],
            worldbookIds: [],
          },
          result: {
            byteLength: 2048,
            contentType: "application/json; charset=utf-8",
            counts: {
              branchLocalVariableSnapshots: 1,
              characterVersions: 2,
              characters: 1,
              floors: 3,
              memoryEdges: 5,
              memoryItems: 4,
              messages: 7,
              pages: 6,
              sessionBranches: 2,
              sessions: 1,
              variables: 8,
              worldbookEntries: 9,
              worldbooks: 1,
            },
            fileName: "core-assets-20250101-120000.thbackup",
            includedDomains: ["characters", "worldbooks", "sessions"],
          },
          status: "succeeded",
          updatedAt: 1735689650000,
        },
      ],
      meta: {
        hasMore: false,
        limit: 50,
        offset: 0,
        sortBy: "created_at",
        sortOrder: "desc",
        total: 1,
      },
    });

    await expect(
      backupJobs.getDetail({
        accountId: "acc-1",
        jobId: "backup-job-restore-1",
      }),
    ).resolves.toEqual({
      attemptCount: 2,
      availableAt: 1735689605000,
      createdAt: 1735689600000,
      finishedAt: 1735689660000,
      id: "backup-job-restore-1",
      jobKind: "restore_core_assets",
      lastError: "last error",
      leaseOwner: null,
      leaseUntil: null,
      maxAttempts: 3,
      outputArtifactPath: null,
      outputExpiresAt: null,
      phase: "finalizing",
      progressCurrent: 3,
      progressMessage: "finalizing",
      progressTotal: 5,
      request: {
        backupKind: "account_core_assets",
        createdAt: 1735689600000,
        includedDomains: ["sessions"],
        mode: "create_copy",
        source: {
          accountId: "account-1",
          appVersion: "0.2.0-beta.3",
        },
      },
      result: {
        created: {
          branchLocalVariableSnapshots: 1,
          characterVersions: 2,
          characters: 1,
          floors: 3,
          memoryEdges: 5,
          memoryItems: 4,
          messages: 7,
          pages: 6,
          runtimeScopeStates: 3,
          sessionBranches: 2,
          sessions: 1,
          variables: 8,
          worldbookEntries: 9,
          worldbooks: 1,
        },
        droppedBindings: {
          presets: 0,
          regexProfiles: 0,
          users: 1,
        },
        mode: "create_copy",
        renamedResources: [
          {
            type: "character",
            oldName: "Alice",
            newName: "Alice (restored)",
          },
        ],
        warnings: [
          {
            code: "restore_drops_user_binding",
            message: "1 个 session 的 user 绑定将在 restore 时清空",
          },
        ],
      },
      status: "dead_letter",
      updatedAt: 1735689660000,
    });

    await expect(
      backupJobs.retry({
        accountId: "acc-1",
        jobId: "backup-job-restore-1",
      }),
    ).resolves.toEqual({
      jobId: "backup-job-restore-1",
      status: "retry_waiting",
    });

    await expect(
      backupJobs.cancel({
        accountId: "acc-1",
        jobId: "backup-job-export-1",
      }),
    ).resolves.toEqual({
      jobId: "backup-job-export-1",
      status: "cancelled",
    });

    const downloadResponse = await backupJobs.downloadFile({
      accountId: "acc-1",
      jobId: "backup-job-export-1",
    });
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-disposition")).toBe('attachment; filename="core-assets.thbackup"');
    expect(await downloadResponse.text()).toBe("backup-payload");

    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "http://localhost:3000/backup-jobs?job_kind=export_core_assets&limit=50&offset=0&sort_by=created_at&sort_order=desc",
    );
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/backup-jobs/backup-job-restore-1");
    expect(String(fetchImpl.mock.calls[2]![0])).toBe("http://localhost:3000/backup-jobs/backup-job-restore-1/retry");
    expect(String(fetchImpl.mock.calls[3]![0])).toBe("http://localhost:3000/backup-jobs/backup-job-export-1/cancel");
    expect(String(fetchImpl.mock.calls[4]![0])).toBe("http://localhost:3000/backup-jobs/backup-job-export-1/file");
  });
});

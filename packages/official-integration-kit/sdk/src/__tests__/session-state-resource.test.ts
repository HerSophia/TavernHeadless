import { describe, expect, it, vi } from "vitest";

import { createTransportClient } from "../client/transport.js";
import { createSessionStateResource } from "../resources/session-state.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk session-state resource", () => {
  it("maps namespace definitions, resolved values, snapshots, and diff entries", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              namespace: "game_state",
              owner_kind: "built_in",
              slots: [
                {
                  slot: "scene",
                  exposure_lifecycle: "public_stable",
                  visibility_mode: "fork_on_branch",
                  default_write_mode: "commit_bound",
                  default_replay_safety: "safe",
                  schema_version: 1,
                  size_budget_bytes: 262144,
                  capabilities: {
                    client_readable: true,
                    client_writable: false,
                    allowed_write_modes: [],
                    supports_snapshot: true,
                    supports_diff: true,
                  },
                },
                {
                  slot: "world",
                  exposure_lifecycle: "public_stable",
                  visibility_mode: "fork_on_branch",
                  default_write_mode: "commit_bound",
                  default_replay_safety: "safe",
                  schema_version: 1,
                  size_budget_bytes: 524288,
                  capabilities: {
                    client_readable: true,
                    client_writable: false,
                    allowed_write_modes: [],
                    supports_snapshot: true,
                    supports_diff: true,
                  },
                },
              ],
            },
            {
              namespace: "quest_flags",
              owner_kind: "custom",
              logical_owner_type: "plugin",
              logical_owner_id: "quest-plugin",
              default_slot_template: {
                default_visibility_mode: "fork_on_branch",
                default_write_mode: "direct",
                default_replay_safety: "safe",
                client_writable: true,
                allowed_write_modes: ["direct"],
                supports_snapshot: true,
                supports_diff: true,
                replay_policy_source: "system_default",
              },
              slots: [
                {
                  slot: "companion",
                  exposure_lifecycle: "public_stable",
                  visibility_mode: "fork_on_branch",
                  default_write_mode: "direct",
                  default_replay_safety: "safe",
                  schema_version: 1,
                  size_budget_bytes: 1048576,
                  capabilities: {
                    client_readable: true,
                    client_writable: true,
                    allowed_write_modes: ["direct"],
                    supports_snapshot: true,
                    supports_diff: true,
                  },
                },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              namespace: "game_state",
              slot: "scene",
              source: "source_floor_snapshot",
              visibility_mode: "fork_on_branch",
              schema_version: 1,
              present: true,
              value: { scene: "harbor" },
              session_id: "session-1",
              branch_id: "main",
              floor_id: "floor-1",
              source_mutation_ids: ["mut-1"],
              updated_at: 100,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              namespace: "game_state",
              slot: "scene",
              visibility_mode: "fork_on_branch",
              schema_version: 1,
              present: true,
              value: { scene: "harbor" },
              session_id: "session-1",
              branch_id: "main",
              floor_id: "floor-1",
              source_mutation_ids: ["mut-1"],
              committed_at: 100,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              namespace: "game_state",
              slot: "scene",
              change_type: "changed",
              left_floor_id: "floor-2",
              right_floor_id: "floor-1",
              left_present: true,
              right_present: true,
              left_value: { scene: "market" },
              right_value: { scene: "harbor" },
            },
          ],
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const sessionState = createSessionStateResource(transport);

    await expect(
      sessionState.listNamespaces({
        accountId: "account-1",
        sessionId: "session-1",
      }),
    ).resolves.toEqual([
      {
        namespace: "game_state",
        ownerKind: "built_in",
        slots: [
          {
            slot: "scene",
            exposureLifecycle: "public_stable",
            visibilityMode: "fork_on_branch",
            defaultWriteMode: "commit_bound",
            defaultReplaySafety: "safe",
            schemaVersion: 1,
            sizeBudgetBytes: 262144,
            capabilities: {
              clientReadable: true,
              clientWritable: false,
              allowedWriteModes: [],
              supportsSnapshot: true,
              supportsDiff: true,
            },
          },
          {
            slot: "world",
            exposureLifecycle: "public_stable",
            visibilityMode: "fork_on_branch",
            defaultWriteMode: "commit_bound",
            defaultReplaySafety: "safe",
            schemaVersion: 1,
            sizeBudgetBytes: 524288,
            capabilities: {
              clientReadable: true,
              clientWritable: false,
              allowedWriteModes: [],
              supportsSnapshot: true,
              supportsDiff: true,
            },
          },
        ],
      },
      {
        namespace: "quest_flags",
        ownerKind: "custom",
        logicalOwnerType: "plugin",
        logicalOwnerId: "quest-plugin",
        defaultSlotTemplate: {
          defaultVisibilityMode: "fork_on_branch",
          defaultWriteMode: "direct",
          defaultReplaySafety: "safe",
          clientWritable: true,
          allowedWriteModes: ["direct"],
          supportsSnapshot: true,
          supportsDiff: true,
          replayPolicySource: "system_default",
        },
        slots: [
          {
            slot: "companion",
            exposureLifecycle: "public_stable",
            visibilityMode: "fork_on_branch",
            defaultWriteMode: "direct",
            defaultReplaySafety: "safe",
            schemaVersion: 1,
            sizeBudgetBytes: 1048576,
            capabilities: {
              clientReadable: true,
              clientWritable: true,
              allowedWriteModes: ["direct"],
              supportsSnapshot: true,
              supportsDiff: true,
            },
          },
        ],
      },
    ]);

    await expect(
      sessionState.resolve({
        accountId: "account-1",
        sessionId: "session-1",
        branchId: "main",
        namespace: "game_state",
        sourceFloorId: "floor-1",
      }),
    ).resolves.toEqual([
      {
        namespace: "game_state",
        slot: "scene",
        source: "source_floor_snapshot",
        visibilityMode: "fork_on_branch",
        schemaVersion: 1,
        present: true,
        value: { scene: "harbor" },
        sessionId: "session-1",
        branchId: "main",
        floorId: "floor-1",
        sourceMutationIds: ["mut-1"],
        updatedAt: 100,
      },
    ]);

    await expect(
      sessionState.getFloorSnapshots({
        accountId: "account-1",
        sessionId: "session-1",
        floorId: "floor-1",
        namespace: "game_state",
      }),
    ).resolves.toEqual([
      {
        namespace: "game_state",
        slot: "scene",
        visibilityMode: "fork_on_branch",
        schemaVersion: 1,
        present: true,
        value: { scene: "harbor" },
        sessionId: "session-1",
        branchId: "main",
        floorId: "floor-1",
        sourceMutationIds: ["mut-1"],
        committedAt: 100,
      },
    ]);

    await expect(
      sessionState.diff({
        accountId: "account-1",
        sessionId: "session-1",
        floorId: "floor-1",
        namespace: "game_state",
        against: { kind: "live", branchId: "main" },
      }),
    ).resolves.toEqual([
      {
        namespace: "game_state",
        slot: "scene",
        changeType: "changed",
        leftFloorId: "floor-2",
        rightFloorId: "floor-1",
        leftPresent: true,
        rightPresent: true,
        leftValue: { scene: "market" },
        rightValue: { scene: "harbor" },
      },
    ]);

    const [namespacesUrl, namespacesInit] = fetchImpl.mock.calls[0]!;
    const [resolveUrl] = fetchImpl.mock.calls[1]!;
    const [snapshotUrl] = fetchImpl.mock.calls[2]!;
    const [diffUrl] = fetchImpl.mock.calls[3]!;

    expect(String(namespacesUrl)).toBe("http://localhost:3000/sessions/session-1/state/namespaces");
    expect((namespacesInit?.headers as Headers).get("x-account-id")).toBe("account-1");

    const resolveRequestUrl = new URL(resolveUrl as string);
    expect(resolveRequestUrl.pathname).toBe("/sessions/session-1/state/resolve");
    expect(resolveRequestUrl.searchParams.get("branch_id")).toBe("main");
    expect(resolveRequestUrl.searchParams.get("namespace")).toBe("game_state");
    expect(resolveRequestUrl.searchParams.get("source_floor_id")).toBe("floor-1");

    const snapshotRequestUrl = new URL(snapshotUrl as string);
    expect(snapshotRequestUrl.pathname).toBe("/sessions/session-1/state/floors/floor-1/snapshot");
    expect(snapshotRequestUrl.searchParams.get("namespace")).toBe("game_state");

    const diffRequestUrl = new URL(diffUrl as string);
    expect(diffRequestUrl.pathname).toBe("/sessions/session-1/state/diff");
    expect(diffRequestUrl.searchParams.get("floor_id")).toBe("floor-1");
    expect(diffRequestUrl.searchParams.get("against")).toBe("live");
    expect(diffRequestUrl.searchParams.get("branch_id")).toBe("main");
    expect(diffRequestUrl.searchParams.get("namespace")).toBe("game_state");
  });

  it("rejects slot-only filters before issuing requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const transport = createTransportClient({ baseUrl, fetchImpl });
    const sessionState = createSessionStateResource(transport);

    await expect(
      sessionState.resolve({
        sessionId: "session-1",
        branchId: "main",
        slot: "scene",
      }),
    ).rejects.toThrow("sessionState.resolve requires namespace when slot is provided");

    await expect(
      sessionState.getFloorSnapshots({
        sessionId: "session-1",
        floorId: "floor-1",
        slot: "scene",
      }),
    ).rejects.toThrow("sessionState.getFloorSnapshots requires namespace when slot is provided");

    await expect(
      sessionState.diff({
        sessionId: "session-1",
        floorId: "floor-1",
        slot: "scene",
        against: { kind: "live", branchId: "main" },
      }),
    ).rejects.toThrow("sessionState.diff requires namespace when slot is provided");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("registers a custom namespace and maps the returned definition", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          namespace: "quest_flags",
          owner_kind: "custom",
          logical_owner_type: "plugin",
          logical_owner_id: "quest-plugin",
          default_slot_template: {
            default_visibility_mode: "fork_on_branch",
            default_write_mode: "direct",
            default_replay_safety: "safe",
            client_writable: true,
            allowed_write_modes: ["direct"],
            supports_snapshot: true,
            supports_diff: true,
            replay_policy_source: "system_default",
          },
          slots: [],
        },
      }, 201),
    );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const sessionState = createSessionStateResource(transport);

    await expect(
      sessionState.registerNamespace({
        accountId: "account-1",
        sessionId: "session-1",
        namespace: "quest_flags",
        logicalOwnerType: "plugin",
        logicalOwnerId: "quest-plugin",
      }),
    ).resolves.toEqual({
      namespace: "quest_flags",
      ownerKind: "custom",
      logicalOwnerType: "plugin",
      logicalOwnerId: "quest-plugin",
      defaultSlotTemplate: {
        defaultVisibilityMode: "fork_on_branch",
        defaultWriteMode: "direct",
        defaultReplaySafety: "safe",
        clientWritable: true,
        allowedWriteModes: ["direct"],
        supportsSnapshot: true,
        supportsDiff: true,
        replayPolicySource: "system_default",
      },
      slots: [],
    });

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0]!;
    expect(String(requestUrl)).toBe("http://localhost:3000/sessions/session-1/state/namespaces");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe(JSON.stringify({
      namespace: "quest_flags",
      logical_owner_type: "plugin",
      logical_owner_id: "quest-plugin",
    }));
    expect((requestInit?.headers as Headers).get("x-account-id")).toBe("account-1");
  });

  it("writes and deletes a custom namespace value", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            namespace: "quest_flags",
            slot: "companion",
            source: "live_head",
            visibility_mode: "fork_on_branch",
            schema_version: 1,
            present: true,
            value: { mood: "ally" },
            session_id: "session-1",
            branch_id: "main",
            floor_id: null,
            source_mutation_ids: ["mut-1"],
            updated_at: 100,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            namespace: "quest_flags",
            slot: "companion",
            source: "live_head",
            visibility_mode: "fork_on_branch",
            schema_version: 1,
            present: false,
            value: null,
            session_id: "session-1",
            branch_id: "main",
            floor_id: null,
            source_mutation_ids: ["mut-2"],
            updated_at: 200,
          },
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const sessionState = createSessionStateResource(transport);

    await expect(
      sessionState.writeValue({
        accountId: "account-1",
        sessionId: "session-1",
        branchId: "main",
        namespace: "quest_flags",
        slot: "companion",
        value: { mood: "ally" },
      }),
    ).resolves.toEqual(expect.objectContaining({
      namespace: "quest_flags",
      slot: "companion",
      source: "live_head",
      present: true,
      value: { mood: "ally" },
    }));

    await expect(
      sessionState.deleteValue({
        accountId: "account-1",
        sessionId: "session-1",
        branchId: "main",
        namespace: "quest_flags",
        slot: "companion",
      }),
    ).resolves.toEqual(expect.objectContaining({
      namespace: "quest_flags",
      slot: "companion",
      source: "live_head",
      present: false,
      value: null,
    }));

    const [writeUrl, writeInit] = fetchImpl.mock.calls[0]!;
    expect(String(writeUrl)).toBe("http://localhost:3000/sessions/session-1/state/values/write");
    expect(writeInit?.method).toBe("POST");
    expect(writeInit?.body).toBe(JSON.stringify({ branch_id: "main", namespace: "quest_flags", slot: "companion", value: { mood: "ally" } }));
    expect((writeInit?.headers as Headers).get("x-account-id")).toBe("account-1");

    const [deleteUrl, deleteInit] = fetchImpl.mock.calls[1]!;
    expect(String(deleteUrl)).toBe("http://localhost:3000/sessions/session-1/state/values");
    expect(deleteInit?.method).toBe("DELETE");
    expect(deleteInit?.body).toBe(JSON.stringify({ branch_id: "main", namespace: "quest_flags", slot: "companion" }));
    expect((deleteInit?.headers as Headers).get("x-account-id")).toBe("account-1");
  });
});

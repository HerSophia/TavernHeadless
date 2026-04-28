import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  accounts,
  clientDataCollections,
  clientDataManagedDomains,
  sessionStateNamespaceRegistrations,
  sessions,
} from "../../db/schema.js";
import {
  SessionStateCustomNamespaceService,
  SessionStateCustomNamespaceServiceError,
} from "../session-state-custom-namespace-service.js";
import { SessionStateService } from "../session-state-service.js";
import {
  SESSION_STATE_LIVE_COLLECTION,
  SESSION_STATE_SNAPSHOT_COLLECTION,
} from "../session-state-types.js";

const CLIENT_DATA_CONFIG = {
  defaultMaxItemSizeBytes: 1_048_576,
  defaultQuotaMaxEntries: 10_000,
  defaultQuotaMaxBytes: 10_485_760,
  maxDomainsPerAccount: 64,
  maxTotalEntriesPerAccount: 100_000,
  maxTotalBytesPerAccount: 104_857_600,
  domainPurgeGracePeriodMs: 604_800_000,
};

const ACCOUNT_A = "account-a";
const ACCOUNT_B = "account-b";

describe("SessionStateCustomNamespaceService", () => {
  let database: DatabaseConnection;
  let service: SessionStateCustomNamespaceService;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    service = new SessionStateCustomNamespaceService(database.db, { clientData: CLIENT_DATA_CONFIG });
    await seedAccount(database, ACCOUNT_A);
    await seedAccount(database, ACCOUNT_B);
  });

  afterEach(() => {
    database.close();
  });

  it("registers a custom namespace and eagerly creates backing registration and managed binding", async () => {
    const sessionId = nanoid();
    await seedSession(database, sessionId, ACCOUNT_A, 1_000);

    const registered = service.registerNamespace({
      accountId: ACCOUNT_A,
      sessionId,
      namespace: "quest_flags",
      logicalOwnerType: "plugin",
      logicalOwnerId: "quest-plugin",
    });

    expect(registered).toEqual({
      namespace: "quest_flags",
      ownerKind: "custom",
      logicalOwnerType: "plugin",
      logicalOwnerId: "quest-plugin",
      defaultSlotTemplate: {
        defaultVisibilityMode: "fork_on_branch",
        defaultWriteMode: "direct",
        defaultReplaySafety: "safe",
        clientWritable: true,
        allowedWriteModes: ["direct", "commit_bound"],
        supportsSnapshot: true,
        supportsDiff: true,
        replayPolicySource: "system_default",
      },
      slots: [],
    });

    const registrations = await database.db
      .select()
      .from(sessionStateNamespaceRegistrations)
      .where(eq(sessionStateNamespaceRegistrations.sessionId, sessionId));
    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.namespace).toBe("quest_flags");
    expect(registrations[0]!.logicalOwnerType).toBe("plugin");
    expect(registrations[0]!.logicalOwnerId).toBe("quest-plugin");
    expect(registrations[0]!.defaultVisibilityMode).toBe("fork_on_branch");
    expect(registrations[0]!.defaultWriteMode).toBe("direct");
    expect(registrations[0]!.defaultReplaySafety).toBe("safe");
    expect(registrations[0]!.clientWritable).toBe(true);
    expect(registrations[0]!.allowedWriteModesJson).toBe('["direct","commit_bound"]');
    expect(registrations[0]!.supportsSnapshot).toBe(true);
    expect(registrations[0]!.supportsDiff).toBe(true);
    expect(registrations[0]!.replayPolicySource).toBe("system_default");

    const managedBindings = await database.db
      .select()
      .from(clientDataManagedDomains)
      .where(eq(clientDataManagedDomains.hostId, sessionId));
    expect(managedBindings).toHaveLength(1);
    expect(managedBindings[0]!.stateNamespace).toBe("quest_flags");
    expect(managedBindings[0]!.domainId).toBe(registrations[0]!.domainId);

    const collections = await database.db
      .select({ collectionName: clientDataCollections.collectionName })
      .from(clientDataCollections)
      .where(eq(clientDataCollections.domainId, registrations[0]!.domainId));
    expect(collections.map((entry) => entry.collectionName).sort()).toEqual([
      SESSION_STATE_LIVE_COLLECTION,
      SESSION_STATE_SNAPSHOT_COLLECTION,
    ].sort());

    const listed = service.listNamespaces(ACCOUNT_A, sessionId);
    expect(listed).toEqual([registered]);
  });

  it("lists materialized custom slots after the first successful direct write", async () => {
    const sessionId = nanoid();
    const now = 1_500;
    await seedSession(database, sessionId, ACCOUNT_A, now);

    service.registerNamespace({
      accountId: ACCOUNT_A,
      sessionId,
      namespace: "quest_flags",
      logicalOwnerType: "plugin",
      logicalOwnerId: "quest-plugin",
    });

    const stateService = new SessionStateService(database.db, {
      clientData: CLIENT_DATA_CONFIG,
      customNamespaceService: service,
    });
    stateService.writeDirectValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      namespace: "quest_flags",
      slot: "companion",
      value: { mood: "ally" },
    });

    const listed = service.listNamespaces(ACCOUNT_A, sessionId);
    expect(listed).toEqual([
      expect.objectContaining({
        namespace: "quest_flags",
        slots: [expect.objectContaining({ slot: "companion" })],
      }),
    ]);
  });

  it("rejects built-in reserved namespaces and duplicate session registrations", async () => {
    const sessionId = nanoid();
    await seedSession(database, sessionId, ACCOUNT_A, 2_000);

    expect(() => service.registerNamespace({
      accountId: ACCOUNT_A,
      sessionId,
      namespace: "game_state",
      logicalOwnerType: "plugin",
      logicalOwnerId: "plugin-a",
    })).toThrow(SessionStateCustomNamespaceServiceError);
    try {
      service.registerNamespace({
        accountId: ACCOUNT_A,
        sessionId,
        namespace: "game_state",
        logicalOwnerType: "plugin",
        logicalOwnerId: "plugin-a",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SessionStateCustomNamespaceServiceError);
      expect((error as SessionStateCustomNamespaceServiceError).statusCode).toBe(409);
      expect((error as SessionStateCustomNamespaceServiceError).code).toBe("session_state_namespace_reserved");
    }

    service.registerNamespace({
      accountId: ACCOUNT_A,
      sessionId,
      namespace: "quest_flags",
      logicalOwnerType: "plugin",
      logicalOwnerId: "plugin-a",
    });

    expect(() => service.registerNamespace({
      accountId: ACCOUNT_A,
      sessionId,
      namespace: "quest_flags",
      logicalOwnerType: "plugin",
      logicalOwnerId: "plugin-a",
    })).toThrow(SessionStateCustomNamespaceServiceError);
    try {
      service.registerNamespace({
        accountId: ACCOUNT_A,
        sessionId,
        namespace: "quest_flags",
        logicalOwnerType: "plugin",
        logicalOwnerId: "plugin-a",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SessionStateCustomNamespaceServiceError);
      expect((error as SessionStateCustomNamespaceServiceError).statusCode).toBe(409);
      expect((error as SessionStateCustomNamespaceServiceError).code).toBe("session_state_namespace_already_registered");
    }
  });

  it("returns not_found for cross-account access", async () => {
    const sessionId = nanoid();
    await seedSession(database, sessionId, ACCOUNT_A, 3_000);

    expect(() => service.listNamespaces(ACCOUNT_B, sessionId)).toThrow(SessionStateCustomNamespaceServiceError);
    expect(() => service.registerNamespace({
      accountId: ACCOUNT_B,
      sessionId,
      namespace: "quest_flags",
      logicalOwnerType: "plugin",
      logicalOwnerId: "plugin-a",
    })).toThrow(SessionStateCustomNamespaceServiceError);

    try {
      service.registerNamespace({
        accountId: ACCOUNT_B,
        sessionId,
        namespace: "quest_flags",
        logicalOwnerType: "plugin",
        logicalOwnerId: "plugin-a",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SessionStateCustomNamespaceServiceError);
      expect((error as SessionStateCustomNamespaceServiceError).statusCode).toBe(404);
      expect((error as SessionStateCustomNamespaceServiceError).code).toBe("not_found");
    }
  });
});

async function seedAccount(database: DatabaseConnection, accountId: string): Promise<void> {
  await database.db.insert(accounts).values({
    id: accountId,
    name: accountId,
    createdAt: 1,
    updatedAt: 1,
  }).onConflictDoNothing();
}

async function seedSession(
  database: DatabaseConnection,
  sessionId: string,
  accountId: string,
  now: number,
): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Session State Custom Namespace Test",
    accountId,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

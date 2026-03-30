import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../src/db/client";
import { llmProfileBindings, llmProfiles, sessions } from "../src/db/schema";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants";
import { LlmProfileService } from "../src/services/llm-profile-service";
import { eq } from "drizzle-orm";

const MASTER_KEY = "test-master-key";

describe("LlmProfileService", () => {
  let connection: DatabaseConnection;
  let service: LlmProfileService;

  beforeEach(() => {
    connection = createDatabase(":memory:");
    service = new LlmProfileService(connection.db, { masterKey: MASTER_KEY, now: () => 1_700_000_000_000 });
  });

  afterEach(() => {
    connection.close();
  });

  async function createProfile(presetName: string): Promise<string> {
    const created = await service.createProfile({
      presetName,
      provider: "openai-compatible",
      modelId: "gpt-4o-mini",
      apiKey: `sk-${presetName}`,
    });

    return created.id;
  }

  it("rejects session-scoped activation when the target session does not exist", async () => {
    const profileId = await createProfile("missing-session-profile");

    await expect(
      service.activateProfile("session", "missing-session", profileId, "narrator", undefined, DEFAULT_ADMIN_ACCOUNT_ID),
    ).rejects.toMatchObject({ code: "session_scope_not_found" });
  });

  it("unbinds an existing binding by scope and slot", async () => {
    const profileId = await createProfile("unbind-profile");

    await connection.db.insert(sessions).values({
      id: "session-unbind",
      title: "Session Unbind",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });

    await service.activateProfile("session", "session-unbind", profileId, "director", undefined, DEFAULT_ADMIN_ACCOUNT_ID);
    await service.unbindProfile("session", "session-unbind", "director", DEFAULT_ADMIN_ACCOUNT_ID);

    const remaining = await connection.db.select().from(llmProfileBindings).where(eq(llmProfileBindings.profileId, profileId));
    expect(remaining).toHaveLength(0);
  });

  it("cleans stale session bindings before deciding whether a profile can be deleted", async () => {
    const profileId = await createProfile("stale-binding-profile");

    await connection.db.insert(llmProfileBindings).values({
      id: "binding-stale",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "session",
      scopeId: "missing-session",
      instanceSlot: "narrator",
      profileId,
      paramsJson: null,
      createdAt: 1,
      updatedAt: 1,
    });

    const deleted = await service.deleteProfile(profileId, DEFAULT_ADMIN_ACCOUNT_ID);

    expect(deleted.status).toBe("deleted");

    const remainingBindings = await connection.db.select().from(llmProfileBindings).where(eq(llmProfileBindings.profileId, profileId));
    expect(remainingBindings).toHaveLength(0);
  });

  it("returns one success and one profile_conflict when duplicate creates race on the same name", async () => {
    const serviceA = new LlmProfileService(connection.db, { masterKey: MASTER_KEY, now: () => 1_700_000_000_100 });
    const serviceB = new LlmProfileService(connection.db, { masterKey: MASTER_KEY, now: () => 1_700_000_000_200 });

    const [first, second] = await Promise.allSettled([
      serviceA.createProfile({
        presetName: "raced-profile",
        provider: "openai-compatible",
        modelId: "gpt-4o-mini",
        apiKey: "sk-race-a",
      }),
      serviceB.createProfile({
        presetName: "raced-profile",
        provider: "openai-compatible",
        modelId: "gpt-4o-mini",
        apiKey: "sk-race-b",
      }),
    ]);

    const results = [first, second];
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(results.find((item) => item.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ code: "profile_conflict" }),
    });

    const rows = await connection.db.select().from(llmProfiles).where(eq(llmProfiles.presetName, "raced-profile"));
    expect(rows).toHaveLength(1);
  });
});

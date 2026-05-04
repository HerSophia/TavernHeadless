import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp, type BuildAppResult } from "../../app.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { floors, sessions } from "../../db/schema.js";

describe("prompt-runtime mode routes", () => {
  const builtApps: BuildAppResult[] = [];

  afterEach(async () => {
    while (builtApps.length > 0) {
      const built = builtApps.pop();
      if (built) {
        await built.app.close();
      }
    }
  });

  async function buildPromptRuntimeApp(): Promise<BuildAppResult> {
    const built = await buildApp({
      auth: { mode: "off" },
      accountMode: "single",
      databasePath: ":memory:",
      logger: false,
    });
    builtApps.push(built);
    await built.app.ready();
    return built;
  }

  async function insertSessionFixture(
    built: BuildAppResult,
    options: {
      metadata?: unknown;
      promptMode?: "compat_strict" | "compat_plus" | "native" | null;
      withMainFloor?: boolean;
    } = {},
  ): Promise<string> {
    const now = Date.now();
    const sessionId = nanoid();

    await built.database.insert(sessions).values({
      id: sessionId,
      title: "Prompt Runtime Mode Contract",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      promptMode: options.promptMode ?? null,
      metadataJson: options.metadata === undefined ? null : JSON.stringify(options.metadata),
      createdAt: now,
      updatedAt: now,
    });

    if (options.withMainFloor !== false) {
      await built.database.insert(floors).values({
        id: nanoid(),
        sessionId,
        floorNo: 0,
        branchId: "main",
        parentFloorId: null,
        state: "committed",
        metadataJson: null,
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now + 1,
        updatedAt: now + 1,
      });
    }

    return sessionId;
  }

  it("adds mode to the root overview and exposes a dedicated clear-to-null /mode route", async () => {
    const built = await buildPromptRuntimeApp();
    const sessionId = await insertSessionFixture(built, {
      metadata: { prompt_mode: "compat_plus" },
      promptMode: "native",
      withMainFloor: true,
    });

    const rootResponse = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/prompt-runtime`,
    });
    expect(rootResponse.statusCode).toBe(200);
    expect(JSON.parse(rootResponse.body).data.mode).toEqual({
      prompt_mode: "native",
      session_prompt_mode: "native",
      effective_prompt_mode: "native",
      default_prompt_mode: "compat_strict",
      legacy_fallback: false,
      source: "session",
    });

    const getModeResponse = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/prompt-runtime/mode`,
    });
    expect(getModeResponse.statusCode).toBe(200);
    expect(JSON.parse(getModeResponse.body).data).toEqual({
      prompt_mode: "native",
      session_prompt_mode: "native",
      effective_prompt_mode: "native",
      default_prompt_mode: "compat_strict",
      legacy_fallback: false,
      source: "session",
    });

    const patchModeResponse = await built.app.inject({
      method: "PATCH",
      payload: { prompt_mode: null },
      url: `/sessions/${encodeURIComponent(sessionId)}/prompt-runtime/mode`,
    });
    expect(patchModeResponse.statusCode).toBe(200);
    expect(JSON.parse(patchModeResponse.body).data).toEqual({
      prompt_mode: "compat_plus",
      session_prompt_mode: null,
      effective_prompt_mode: "compat_plus",
      default_prompt_mode: "compat_strict",
      legacy_fallback: true,
      source: "legacy_metadata",
    });

    const refreshedRootResponse = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/prompt-runtime`,
    });
    expect(refreshedRootResponse.statusCode).toBe(200);
    expect(JSON.parse(refreshedRootResponse.body).data.mode).toEqual({
      prompt_mode: "compat_plus",
      session_prompt_mode: null,
      effective_prompt_mode: "compat_plus",
      default_prompt_mode: "compat_strict",
      legacy_fallback: true,
      source: "legacy_metadata",
    });

    const [sessionRow] = await built.database
      .select({ promptMode: sessions.promptMode })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    expect(sessionRow?.promptMode).toBeNull();
  });

  it("keeps prompt_mode out of policy patch and does not expose unsupported mode write routes", async () => {
    const built = await buildPromptRuntimeApp();
    const sessionId = await insertSessionFixture(built, {
      promptMode: "compat_strict",
      withMainFloor: false,
    });

    const policyPatchResponse = await built.app.inject({
      method: "PATCH",
      payload: { prompt_mode: "native" },
      url: `/sessions/${encodeURIComponent(sessionId)}/prompt-runtime/policy`,
    });
    expect(policyPatchResponse.statusCode).toBe(400);
    expect(JSON.parse(policyPatchResponse.body).error.code).toBe("validation_error");

    const rootPatchResponse = await built.app.inject({
      method: "PATCH",
      payload: { prompt_mode: "native" },
      url: `/sessions/${encodeURIComponent(sessionId)}/prompt-runtime`,
    });
    expect(rootPatchResponse.statusCode).toBe(404);

    const branchModePatchResponse = await built.app.inject({
      method: "PATCH",
      payload: { prompt_mode: "native" },
      url: `/sessions/${encodeURIComponent(sessionId)}/prompt-runtime/branches/main/mode`,
    });
    expect(branchModePatchResponse.statusCode).toBe(404);
  });
});

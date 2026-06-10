import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { sessions } from "../../db/schema.js";
import type { PromptRuntimeInspectionResult } from "../prompt-runtime-control-service.js";
import { PromptRuntimePreviewService } from "../chat/prompt-runtime-preview-service.js";

describe("PromptRuntimePreviewService injections", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("returns request injections only in runtimeTrace and keeps preview text unchanged", async () => {
    const sessionId = await insertSession(database);
    const targetResolver = {
      resolveRespondBranchContext: vi.fn(async () => ({
        branchExists: false,
        historySourceBranchId: "main",
        historySourceMode: "main_fallback",
        nextFloorNo: 1,
        parentFloorId: null,
      })),
    };
    const promptPreparationService = {
      loadPromptRuntimeConversationWindow: vi.fn(async () => ({
        history: [],
        effectiveTurns: [],
        selectedTurns: [],
        visibilityTrace: { filteredFloorNos: [] },
        historyNormalization: {
          rawEntryCount: 0,
          effectiveTurnCount: 0,
          selectedTurnCount: 0,
          trailingUserSourceFloorIds: [],
          mergedUserGroups: [],
          violations: [],
        },
      })),
      buildPromptRuntimeInspection: vi.fn(async ({
        injections,
      }: {
        injections?: PromptRuntimeInspectionResult["injections"];
      }) => createInspectionResult({
        ...(injections ? { injections } : {}),
      })),
    };
    const modelService = {
      resolveTurnModelsForSession: vi.fn(async () => ({})),
      resolveRequestedTurnConfig: vi.fn(() => undefined),
      resolveMemoryWritePolicy: vi.fn(() => ({
        runtimeMode: "disabled",
        requestedWrite: false,
        effectiveWrite: false,
      })),
      getSlotGenerationParams: vi.fn(() => undefined),
      resolveMaxContextTokensOverride: vi.fn(() => undefined),
      resolveMaxOutputTokensOverride: vi.fn(() => undefined),
      buildSessionPromptInfo: vi.fn(() => ({
        presetId: null,
        worldbookProfileId: null,
        regexProfileId: null,
        metadataJson: null,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        promptMode: "compat_strict",
        userSnapshotJson: JSON.stringify({ name: "Traveler" }),
      })),
    };
    const memoryService = {
      retrieveMemoryInjection: vi.fn(async () => undefined),
    };

    const service = new PromptRuntimePreviewService(
      database.db,
      targetResolver as never,
      promptPreparationService as never,
      modelService as never,
      memoryService as never,
    );

    const result = await service.run(
      sessionId,
      {
        text: "Keep moving north.",
        promptRuntimeInjections: [{
          sourceKind: "client_injection",
          title: "North pass guide",
          content: "Keep the north pass in focus.",
          placement: "before_history",
        }],
      },
      DEFAULT_ADMIN_ACCOUNT_ID,
    );

    const inspectionArgs = promptPreparationService.buildPromptRuntimeInspection.mock.calls[0]?.[0];
    expect(inspectionArgs?.injections).toMatchObject([
      {
        placementRequested: "before_history",
        placementResolved: "history.before",
        title: "North pass guide",
        applied: true,
      },
    ]);
    expect(result.runtimeTrace.injection?.items).toMatchObject([
      {
        placementRequested: "before_history",
        placementResolved: "history.before",
        title: "North pass guide",
        applied: true,
      },
    ]);
    expect(result.text).toBe("Keep moving north.");
    expect(result.text).not.toContain("Keep the north pass in focus.");
  });
});

async function insertSession(database: DatabaseConnection): Promise<string> {
  const sessionId = nanoid();
  const now = Date.now();

  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Prompt Runtime Preview Session",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    promptMode: "compat_strict",
    metadataJson: null,
    createdAt: now,
    updatedAt: now,
  });

  return sessionId;
}

function createInspectionResult(
  overrides: Partial<PromptRuntimeInspectionResult> = {},
): PromptRuntimeInspectionResult {
  return {
    scope: {
      sessionId: "session-1",
      targetBranchId: "main",
      branchExists: true,
      sourceFloorId: null,
      historySourceBranchId: "main",
      historySourceMode: "existing_branch",
    },
    assets: {
      preset: null,
      characterCard: null,
      worldbook: null,
      regexProfile: null,
    },
    resolvedPolicy: {
      structure: {
        mode: "default",
        mergeAdjacentSameRole: true,
        preserveSystemMessages: true,
      },
      delivery: {
        allowAssistantPrefill: true,
        requireLastUser: false,
        noAssistant: false,
      },
      debug: {
        includePromptSnapshot: false,
        includeRuntimeTrace: false,
        includeWorldbookMatches: false,
      },
      budget: {},
      visibility: { mode: "allow_all_except_hidden" },
      sourceSelection: {
        history: { mode: "full" },
        memory: { enabled: true },
        worldbook: { enabled: true },
        examples: { enabled: true },
      },
    },
    sourceMap: {},
    diagnostics: [],
    trimReasons: [],
    excludedSources: [],
    sectionStats: [],
    limitations: [],
    ...overrides,
  } as PromptRuntimeInspectionResult;
}

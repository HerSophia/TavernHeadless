import { describe, expect, it, vi } from "vitest";
import { buildBranchMemoryScopeId } from "@tavern/shared";

import { TurnMemoryInjectionService } from "../../memory/injection/turn-memory-injection-service.js";

describe("TurnMemoryInjectionService", () => {
  it("returns structured memory trace beside the formatted summary text", async () => {
    const service = new TurnMemoryInjectionService({
      memoryStore: {
        prepareInjection: vi.fn(async () => ({
          items: [
            {
              id: "memory-branch-fact-1",
              scope: "branch",
              scopeId: buildBranchMemoryScopeId("session-1", "main"),
              type: "fact",
              content: "Bob still holds the vault key.",
              factKey: "vault_key_owner",
              importance: 0.82,
              confidence: 1,
              status: "active",
              tokenCountEstimate: 18,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          formattedText: "[Memory]\n- Bob still holds the vault key.",
          tokenCount: 18,
          scopeResolution: {
            mode: "visible_refs",
            strict: false,
            scopeRefs: [
              { scope: "global", scopeId: "default-admin" },
              { scope: "branch", scopeId: buildBranchMemoryScopeId("session-1", "main") },
            ],
          },
        })),
      } as never,
      enableDualSummaryInjection: true,
      emitBestEffortEvent: vi.fn(async () => undefined),
    });

    await expect(service.retrieveMemoryInjection({
      sessionId: "session-1",
      accountId: "default-admin",
      branchId: "main",
    })).resolves.toMatchObject({
      memorySummary: "[Memory]\n- Bob still holds the vault key.",
      memoryTrace: {
        strategy: "dual_summary",
        summaryText: "[Memory]\n- Bob still holds the vault key.",
        selectedItems: [
          expect.objectContaining({
            memoryId: "memory-branch-fact-1",
            scope: "branch",
            branchId: "main",
            kind: "fact",
          }),
        ],
        tokenStats: {
          budget: 500,
          used: 18,
          microSummary: 0,
          macroSummary: 0,
          directItems: 18,
        },
        scopeResolution: expect.objectContaining({
          mode: "branch_aware",
          requestedScopes: ["global", "branch"],
          resolvedScopes: ["global", "branch"],
          requestedBranchId: "main",
          resolvedBranchId: "main",
        }),
      },
    });
  });
});
